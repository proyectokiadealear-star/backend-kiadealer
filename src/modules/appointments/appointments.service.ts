import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateAppointmentDto,
  QueryAppointmentsDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';
import {
  Appointment,
  AppointmentQueryFilters,
  AppointmentsRepository,
} from './appointments.repository';
import { AppointmentVehicleBridgeRepository } from './appointment-vehicle-bridge.repository';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

/**
 * El servicio no conoce `tenantId` ni `TenantContext` — toda lectura y
 * escritura de Firestore pasa por `AppointmentsRepository` (agendamientos,
 * con scope de tenant) o `AppointmentVehicleBridgeRepository` (el único
 * punto donde se toca `vehicles` directamente, todavía sin migrar). Ver
 * docs/design/01-multi-tenancy.md, diagrama C4.
 */
@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
    private readonly appointmentsRepository: AppointmentsRepository,
    private readonly vehicleBridge: AppointmentVehicleBridgeRepository,
  ) {}

  /**
   * Lanza ConflictException si el asesor ya tiene un agendamiento no
   * CANCELADO en esa fecha+hora, excluyendo `excludeAptId` (reagendamiento).
   */
  private async assertNoSlotConflict(
    advisorId: string,
    date: string,
    time: string,
    excludeAptId?: string,
  ): Promise<void> {
    const appointments = await this.appointmentsRepository.findByAdvisorAndDate(
      advisorId,
      date,
    );

    const slotTaken = appointments.some(
      (apt) =>
        apt.scheduledTime === time &&
        apt.status !== 'CANCELADO' &&
        apt.id !== excludeAptId,
    );

    if (slotTaken) {
      throw new ConflictException(
        `El asesor ya tiene una entrega agendada el ${date} a las ${time}. Seleccione otro horario.`,
      );
    }
  }

  async create(dto: CreateAppointmentDto, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(dto.vehicleId);

    if (vehicle['status'] !== VehicleStatus.LISTO_PARA_ENTREGA) {
      throw new BadRequestException(
        `El vehículo debe estar LISTO_PARA_ENTREGA. Estado: ${vehicle['status']}`,
      );
    }

    if (!vehicle['registrationReceivedDate']) {
      throw new BadRequestException(
        'No se puede agendar sin haber recibido la matrícula del vehículo.',
      );
    }

    // ── Verificar conflicto de horario para el asesor ──────────────────────
    await this.assertNoSlotConflict(
      dto.assignedAdvisorId,
      dto.scheduledDate,
      dto.scheduledTime,
    );
    // ──────────────────────────────────────────────────────────────────────

    const now = this.firebase.serverTimestamp();

    // El id se genera acá (no se deja autogenerado) para preservarlo como id
    // determinístico del documento, igual que antes de la migración. El
    // campo `id` ya no se guarda DENTRO del documento: el repositorio base
    // siempre lo inyecta en la respuesta desde el id del doc — mismo criterio
    // documentado para `certifications` en docs/design/06-runbook-migracion.md.
    const aptId = uuidv4();

    const created = await this.appointmentsRepository.create(
      {
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
        model: vehicle['model'] as string,
        color: (vehicle['color'] as string | undefined) ?? null,
        sede: vehicle['sede'] as string,
        clientName: (vehicle['clientName'] as string | undefined) ?? null,
        clientId: (vehicle['clientId'] as string | undefined) ?? null,
        scheduledDate: dto.scheduledDate,
        scheduledTime: dto.scheduledTime,
        assignedAdvisorId: dto.assignedAdvisorId,
        assignedAdvisorName: dto.assignedAdvisorName,
        status: 'AGENDADO',
        createdBy: user.uid,
        createdByName: user.displayName ?? user.email,
        createdAt: now,
        updatedAt: now,
      },
      aptId,
    );

    await this.vehiclesService.changeStatus(
      dto.vehicleId,
      VehicleStatus.AGENDADO,
      user,
      {
        notes: `Entrega agendada por ${user.displayName ?? user.email} para el ${dto.scheduledDate} a las ${dto.scheduledTime}. Asesor: ${dto.assignedAdvisorName}`,
        extraFields: { appointmentId: created.id },
      },
    );

    await Promise.all([
      this.notificationsService.notify({
        type: 'AGENDADO',
        targetRole: RoleEnum.ASESOR,
        targetSede: vehicle['sede'] as string,
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

    return {
      aptId: created.id,
      vehicleId: dto.vehicleId,
      newStatus: VehicleStatus.AGENDADO,
    };
  }

  /**
   * Retorna los horarios ya ocupados para un asesor en una fecha concreta.
   * Excluye citas CANCELADAS. Usado por el frontend para deshabilitar slots.
   */
  async getOccupiedSlots(advisorId: string, date: string): Promise<string[]> {
    const appointments = await this.appointmentsRepository.findByAdvisorAndDate(
      advisorId,
      date,
    );

    return appointments
      .filter((apt) => apt.status !== 'CANCELADO')
      .map((apt) => apt.scheduledTime);
  }

  async findAll(user: AuthenticatedUser, filters: QueryAppointmentsDto) {
    const queryFilters: AppointmentQueryFilters = {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    };

    // Si se filtra por vehicleId específico, omitir restricciones de rol/sede
    // para que el asesor que ejecuta la ceremonia pueda encontrar la cita
    // aunque no sea suya (ej: fue creada por otro asesor o desde el web).
    if (filters.vehicleId) {
      queryFilters.vehicleId = filters.vehicleId;
    } else if (
      user.role === RoleEnum.JEFE_TALLER ||
      user.role === RoleEnum.SOPORTE ||
      user.role === RoleEnum.SUPERVISOR
    ) {
      // Ve todo — sin restricción de sede
    } else if (
      user.role === RoleEnum.LIDER_TECNICO ||
      user.role === RoleEnum.PERSONAL_TALLER ||
      user.role === RoleEnum.DOCUMENTACION
    ) {
      // Ve todas las citas de su sede
      queryFilters.sede = user.sede;
    } else if (user.role === RoleEnum.ASESOR) {
      // Solo ve sus propias citas asignadas
      queryFilters.assignedAdvisorId = user.uid;
    } else {
      queryFilters.sede = user.sede;
    }

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

    let docs: Appointment[];
    let total: number;
    let nextCursor: string | null = null;

    if (usePagination) {
      const [countTotal, pageResult] = await Promise.all([
        this.appointmentsRepository.countFiltered(queryFilters),
        this.appointmentsRepository.paginateFiltered(queryFilters, {
          limit,
          cursor: cursorRaw,
        }),
      ]);
      total = countTotal;
      docs = pageResult.items;
      nextCursor = pageResult.nextCursor;
    } else {
      docs = await this.appointmentsRepository.listAll(queryFilters);
      total = docs.length;
    }

    docs = await this.enrichLegacyDocs(docs);

    if (!usePagination) {
      return docs;
    }

    return {
      data: docs,
      total,
      page: cursorRaw ? 1 : page,
      limit,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  /**
   * Retrocompatibilidad: enriquece agendamientos legacy a los que les falte
   * `clientName` o `color` (campos añadidos después de que ya existieran
   * agendamientos viejos sin ellos), leyendo el vehículo asociado.
   *
   * Usa `AppointmentVehicleBridgeRepository` — el único punto donde este
   * servicio toca `vehicles`, que todavía no migró a scope de tenant.
   */
  private async enrichLegacyDocs(docs: Appointment[]): Promise<Appointment[]> {
    const missing = docs.filter(
      (d) => (!d.clientName || !d.color) && d.vehicleId,
    );
    if (missing.length === 0) return docs;

    const vehicleIds = [...new Set(missing.map((d) => d.vehicleId))];
    const vehicleMap = await this.vehicleBridge.findManyAccessible(vehicleIds);

    return docs.map((d) => {
      if (d.clientName && d.color) return d;
      const v = vehicleMap.get(d.vehicleId);
      if (!v) return d;
      return {
        ...d,
        clientName: d.clientName || ((v['clientName'] as string) ?? null),
        clientId: d.clientId || ((v['clientId'] as string) ?? null),
        color: d.color || ((v['color'] as string) ?? null),
        model: d.model || ((v['model'] as string) ?? null),
      };
    });
  }

  async update(
    aptId: string,
    dto: UpdateAppointmentDto,
    user: AuthenticatedUser,
  ) {
    const existing = await this.appointmentsRepository.findById(aptId);
    if (!existing) throw new NotFoundException('Agendamiento no encontrado');

    // ── Verificar conflicto de horario al reagendar ────────────────────────
    // Only validate if date or time is actually changing.
    const newDate = dto.scheduledDate ?? existing.scheduledDate;
    const newTime = dto.scheduledTime ?? existing.scheduledTime;
    const newAdvisorId = dto.assignedAdvisorId ?? existing.assignedAdvisorId;

    if (
      dto.scheduledDate !== undefined ||
      dto.scheduledTime !== undefined ||
      dto.assignedAdvisorId !== undefined
    ) {
      await this.assertNoSlotConflict(newAdvisorId, newDate, newTime, aptId);
    }
    // ──────────────────────────────────────────────────────────────────────

    const changes = {
      ...Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
      // Reset reminder if date or time changed, so the cron sends a new one
      ...(dto.scheduledDate !== undefined || dto.scheduledTime !== undefined
        ? { reminderSentAt: null }
        : {}),
      updatedAt: this.firebase.serverTimestamp(),
    } as Partial<Omit<Appointment, 'tenantId' | 'id'>>;

    const updated = await this.appointmentsRepository.update(aptId, changes);
    if (!updated) throw new NotFoundException('Agendamiento no encontrado');

    // Audit trail en statusHistory del vehículo
    const changesLog: string[] = [];
    if (dto.scheduledDate && dto.scheduledDate !== existing.scheduledDate)
      changesLog.push(
        `fecha: ${existing.scheduledDate} → ${dto.scheduledDate}`,
      );
    if (dto.scheduledTime && dto.scheduledTime !== existing.scheduledTime)
      changesLog.push(`hora: ${existing.scheduledTime} → ${dto.scheduledTime}`);
    if (
      dto.assignedAdvisorName &&
      dto.assignedAdvisorName !== existing.assignedAdvisorName
    )
      changesLog.push(
        `asesor: ${existing.assignedAdvisorName} → ${dto.assignedAdvisorName}`,
      );

    if (changesLog.length && existing.vehicleId) {
      await this.vehiclesService.assertExists(existing.vehicleId);
      await this.vehiclesService.addStatusHistory(
        existing.vehicleId,
        VehicleStatus.AGENDADO,
        VehicleStatus.AGENDADO,
        user,
        user.sede,
        `Reagendamiento por ${user.displayName ?? user.email}: ${changesLog.join(', ')}`,
      );
    }

    return { aptId, updated: true };
  }
}
