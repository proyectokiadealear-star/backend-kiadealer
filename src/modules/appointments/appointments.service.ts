import { Injectable, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateAppointmentDto,
  QueryAppointmentsDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';
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
      color: vehicle['color'] ?? null,
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

  async findAll(user: AuthenticatedUser, filters: QueryAppointmentsDto) {
    let query: FirebaseFirestore.Query = this.db.collection('appointments');
    const dateFrom = filters.dateFrom;
    const dateTo = filters.dateTo;
    const vehicleId = filters.vehicleId;

    // Si se filtra por vehicleId específico, omitir restricciones de rol/sede
    // para que el asesor que ejecuta la ceremonia pueda encontrar la cita aunque
    // no sea suya (ej: fue creada por otro asesor o desde el web).
    if (vehicleId) {
      query = query.where('vehicleId', '==', vehicleId);
    } else if (user.role === RoleEnum.JEFE_TALLER || user.role === RoleEnum.SOPORTE || user.role === RoleEnum.SUPERVISOR) {
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

    if (dateFrom) query = query.where('scheduledDate', '>=', dateFrom);
    if (dateTo) query = query.where('scheduledDate', '<=', dateTo);

    const pageRaw = filters.page ? Number(filters.page) : 1;
    const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
    const limitRaw = filters.limit ? Number(filters.limit) : undefined;
    const limit = Math.min(Math.max(limitRaw ?? 50, 1), 200);
    const cursorRaw = filters.cursor;
    const usePagination = !!(filters.page || filters.limit || filters.cursor);

    if (page > 1 && !cursorRaw) {
      throw new BadRequestException(
        'La paginación por page>1 está obsoleta en appointments. Use cursor (nextCursor) para continuar.',
      );
    }

    let cursorScheduledDate: string | null = null;
    let cursorScheduledTime: string | null = null;
    let cursorDocId: string | null = null;
    if (cursorRaw) {
      try {
        const parsed = JSON.parse(
          Buffer.from(cursorRaw, 'base64').toString('utf8'),
        ) as {
          scheduledDate?: string;
          scheduledTime?: string;
          id?: string;
        };
        if (
          typeof parsed.scheduledDate === 'string' &&
          typeof parsed.scheduledTime === 'string' &&
          typeof parsed.id === 'string' &&
          parsed.id.trim().length > 0
        ) {
          cursorScheduledDate = parsed.scheduledDate;
          cursorScheduledTime = parsed.scheduledTime;
          cursorDocId = parsed.id;
        } else {
          throw new Error('cursor invalid structure');
        }
      } catch {
        throw new BadRequestException('Cursor inválido para appointments');
      }
    }

    // Q6: orden estable para paginación
    let ordered = query
      .orderBy('scheduledDate', 'asc')
      .orderBy('scheduledTime', 'asc')
      .orderBy('__name__', 'asc');

    if (cursorScheduledDate && cursorScheduledTime && cursorDocId) {
      ordered = ordered.startAfter(
        cursorScheduledDate,
        cursorScheduledTime,
        cursorDocId,
      );
    }

    let total = 0;
    let pageDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let hasMore = false;
    if (usePagination) {
      const [countSnap, snapshot] = await Promise.all([
        query.count().get(),
        ordered.limit(limit + 1).get(),
      ]);
      total = countSnap.data().count;
      hasMore = snapshot.docs.length > limit;
      pageDocs = snapshot.docs.slice(0, limit);
    } else {
      const snapshot = await ordered.get();
      pageDocs = snapshot.docs;
      total = pageDocs.length;
    }

    let docs = pageDocs.map((d) => d.data());

    // ── Retrocompatibilidad: enriquecer docs legacy que les falten campos del vehículo ──
    // Aplica a docs que no tengan clientName O que no tengan color (campo añadido después).
    const missing = docs.filter(
      (d) => (!d['clientName'] || !d['color']) && d['vehicleId'],
    );
    if (missing.length > 0) {
      const vehicleIds = [...new Set(missing.map((d) => d['vehicleId'] as string))];
      const vehicleSnaps = await Promise.all(
        vehicleIds.map((vid) => this.db.collection('vehicles').doc(vid).get()),
      );
      const vehicleMap = new Map(
        vehicleSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]),
      );
      docs = docs.map((d) => {
        if (d['clientName'] && d['color']) return d;
        const v = vehicleMap.get(d['vehicleId'] as string);
        if (!v) return d;
        return {
          ...d,
          clientName: d['clientName'] || (v['clientName'] ?? null),
          clientId:   d['clientId']   || (v['clientId']   ?? null),
          color:      d['color']      || (v['color']      ?? null),
          model:      d['model']      || (v['model']      ?? null),
        };
      });
    }
    // ─────────────────────────────────────────────────────────────────────────────────

    if (!usePagination) {
      return docs;
    }

    let nextCursor: string | null = null;
    const lastDoc = pageDocs.at(-1);
    if (lastDoc && usePagination && pageDocs.length === limit && hasMore) {
      nextCursor = Buffer.from(
        JSON.stringify({
          scheduledDate: lastDoc.get('scheduledDate') as string,
          scheduledTime: lastDoc.get('scheduledTime') as string,
          id: lastDoc.id,
        }),
        'utf8',
      ).toString('base64');
    }

    return {
      data: docs,
      total,
      page: cursorRaw ? 1 : page,
      limit,
      ...(nextCursor ? { nextCursor } : {}),
    };
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
      // Reset reminder if date or time changed, so the cron sends a new one
      ...(dto.scheduledDate !== undefined || dto.scheduledTime !== undefined
        ? { reminderSentAt: null }
        : {}),
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
