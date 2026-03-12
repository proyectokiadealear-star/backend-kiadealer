import { Injectable, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() { return this.firebase.firestore(); }

  /**
   * Shared helper: throws ConflictException if the advisor already has a
   * non-CANCELADO appointment at the given date+time, excluding `excludeAptId`.
   */
  private async assertNoSlotConflict(
    advisorId: string,
    date: string,
    time: string,
    excludeAptId?: string,
  ): Promise<void> {
    const snap = await this.db
      .collection('appointments')
      .where('assignedAdvisorId', '==', advisorId)
      .where('scheduledDate', '==', date)
      .get();

    const slotTaken = snap.docs.some((d) => {
      const data = d.data();
      return (
        data['scheduledTime'] === time &&
        data['status'] !== 'CANCELADO' &&
        d.id !== excludeAptId
      );
    });

    if (slotTaken) {
      throw new ConflictException(
        `El asesor ya tiene una entrega agendada el ${date} a las ${time}. Seleccione otro horario.`,
      );
    }
  }

  async create(dto: CreateAppointmentDto, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(dto.vehicleId);

    if (vehicle['status'] !== VehicleStatus.LISTO_PARA_ENTREGA) {
      throw new BadRequestException(`El vehículo debe estar LISTO_PARA_ENTREGA. Estado: ${vehicle['status']}`);
    }

    if (!vehicle['registrationReceivedDate']) {
      throw new BadRequestException('No se puede agendar sin haber recibido la matrícula del vehículo.');
    }

    // ── Verificar conflicto de horario para el asesor ──────────────────────
    await this.assertNoSlotConflict(dto.assignedAdvisorId, dto.scheduledDate, dto.scheduledTime);
    // ──────────────────────────────────────────────────────────────────────

    const aptId = uuidv4();
    const now = this.firebase.serverTimestamp();

    const aptData = {
      id: aptId,
      vehicleId: dto.vehicleId,
      chassis: vehicle['chassis'],
      model: vehicle['model'],
      sede: vehicle['sede'],
      clientName: vehicle['clientName'] ?? null,
      clientId: vehicle['clientId'] ?? null,
      scheduledDate: dto.scheduledDate,
      scheduledTime: dto.scheduledTime,
      assignedAdvisorId: dto.assignedAdvisorId,
      assignedAdvisorName: dto.assignedAdvisorName,
      status: 'AGENDADO',
      createdBy: user.uid,
      createdByName: user.displayName ?? user.email,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('appointments').doc(aptId).set(aptData);

    await this.vehiclesService.changeStatus(dto.vehicleId, VehicleStatus.AGENDADO, user, {
      notes: `Entrega agendada por ${user.displayName ?? user.email} para el ${dto.scheduledDate} a las ${dto.scheduledTime}. Asesor: ${dto.assignedAdvisorName}`,
      extraFields: { appointmentId: aptId },
    });

    await Promise.all([
      this.notificationsService.notify({
        type: 'AGENDADO',
        targetRole: RoleEnum.ASESOR,
        targetSede: vehicle['sede'],
        title: '📅 Entrega agendada',
        body: `El vehículo ${vehicle['chassis']} fue agendado para el ${dto.scheduledDate} a las ${dto.scheduledTime}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
        data: { advisorId: dto.assignedAdvisorId },
      }),
      this.notificationsService.notify({
        type: 'AGENDADO',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '📅 Entrega agendada',
        body: `El vehículo ${vehicle['chassis']} fue agendado para el ${dto.scheduledDate}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    return { aptId, vehicleId: dto.vehicleId, newStatus: VehicleStatus.AGENDADO };
  }

  /**
   * Retorna los horarios ya ocupados para un asesor en una fecha concreta.
   * Excluye citas CANCELADAS. Usado por el frontend para deshabilitar slots.
   */
  async getOccupiedSlots(advisorId: string, date: string): Promise<string[]> {
    const snap = await this.db
      .collection('appointments')
      .where('assignedAdvisorId', '==', advisorId)
      .where('scheduledDate', '==', date)
      .get();

    return snap.docs
      .map((d) => d.data())
      .filter((d) => d['status'] !== 'CANCELADO')
      .map((d) => d['scheduledTime'] as string);
  }

  async findAll(user: AuthenticatedUser, dateFrom?: string, dateTo?: string, vehicleId?: string) {
    let query: FirebaseFirestore.Query = this.db.collection('appointments');

    // Si se filtra por vehicleId específico, omitir restricciones de rol/sede
    // para que el asesor que ejecuta la ceremonia pueda encontrar la cita aunque
    // no sea suya (ej: fue creada por otro asesor o desde el web).
    if (vehicleId) {
      query = query.where('vehicleId', '==', vehicleId);
    } else if (user.role === RoleEnum.JEFE_TALLER || user.role === RoleEnum.SOPORTE) {
      // Ve todo — sin restricción de sede
    } else if (user.role === RoleEnum.LIDER_TECNICO || user.role === RoleEnum.PERSONAL_TALLER || user.role === RoleEnum.DOCUMENTACION) {
      // Ve todas las citas de su sede
      query = query.where('sede', '==', user.sede);
    } else if (user.role === RoleEnum.ASESOR) {
      // Solo ve sus propias citas asignadas
      query = query.where('assignedAdvisorId', '==', user.uid);
    } else {
      query = query.where('sede', '==', user.sede);
    }

    // Sin orderBy en Firestore para evitar índices compuestos — ordenar en memoria
    const snapshot = await query.get();
    let docs = snapshot.docs
      .map((d) => d.data())
      .sort((a, b) => String(a['scheduledDate'] ?? '').localeCompare(String(b['scheduledDate'] ?? '')));

    if (dateFrom) docs = docs.filter((d) => d['scheduledDate'] >= dateFrom);
    if (dateTo) docs = docs.filter((d) => d['scheduledDate'] <= dateTo);

    // ── Retrocompatibilidad: enriquecer docs legacy que no tienen clientName/clientId ──
    // Sólo se hace una lectura de vehículo por cada apt que le falte el campo.
    const missing = docs.filter((d) => d['clientName'] === undefined && d['vehicleId']);
    if (missing.length > 0) {
      const vehicleIds = [...new Set(missing.map((d) => d['vehicleId'] as string))];
      const vehicleSnaps = await Promise.all(
        vehicleIds.map((vid) => this.db.collection('vehicles').doc(vid).get()),
      );
      const vehicleMap = new Map(
        vehicleSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]),
      );
      docs = docs.map((d) => {
        if (d['clientName'] !== undefined) return d;
        const v = vehicleMap.get(d['vehicleId'] as string);
        if (!v) return d;
        return { ...d, clientName: v['clientName'] ?? null, clientId: v['clientId'] ?? null };
      });
    }
    // ─────────────────────────────────────────────────────────────────────────────────

    return docs;
  }

  async update(aptId: string, dto: UpdateAppointmentDto, user: AuthenticatedUser) {
    const doc = await this.db.collection('appointments').doc(aptId).get();
    if (!doc.exists) throw new NotFoundException('Agendamiento no encontrado');

    const apt = doc.data()!;

    // ── Verificar conflicto de horario al reagendar ────────────────────────
    // Only validate if date or time is actually changing.
    const newDate = dto.scheduledDate ?? apt['scheduledDate'];
    const newTime = dto.scheduledTime ?? apt['scheduledTime'];
    const newAdvisorId = dto.assignedAdvisorId ?? apt['assignedAdvisorId'];

    if (
      dto.scheduledDate !== undefined ||
      dto.scheduledTime !== undefined ||
      dto.assignedAdvisorId !== undefined
    ) {
      await this.assertNoSlotConflict(newAdvisorId, newDate, newTime, aptId);
    }
    // ──────────────────────────────────────────────────────────────────────

    await this.db.collection('appointments').doc(aptId).update({
      ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)),
      updatedAt: this.firebase.serverTimestamp(),
    });

    // Audit trail en statusHistory del vehículo
    const changes: string[] = [];
    if (dto.scheduledDate && dto.scheduledDate !== apt['scheduledDate'])
      changes.push(`fecha: ${apt['scheduledDate']} → ${dto.scheduledDate}`);
    if (dto.scheduledTime && dto.scheduledTime !== apt['scheduledTime'])
      changes.push(`hora: ${apt['scheduledTime']} → ${dto.scheduledTime}`);
    if (dto.assignedAdvisorName && dto.assignedAdvisorName !== apt['assignedAdvisorName'])
      changes.push(`asesor: ${apt['assignedAdvisorName']} → ${dto.assignedAdvisorName}`);

    if (changes.length && apt['vehicleId']) {
      await this.vehiclesService.assertExists(apt['vehicleId']);
      await this.vehiclesService.addStatusHistory(
        apt['vehicleId'],
        VehicleStatus.AGENDADO,
        VehicleStatus.AGENDADO,
        user,
        user.sede,
        `Reagendamiento por ${user.displayName ?? user.email}: ${changes.join(', ')}`,
      );
    }

    return { aptId, updated: true };
  }
}
