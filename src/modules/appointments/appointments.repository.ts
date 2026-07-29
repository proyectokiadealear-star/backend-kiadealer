import { Injectable } from '@nestjs/common';
import { Query } from 'firebase-admin/firestore';
import {
  Page,
  PaginateOptions,
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

/** Agendamiento de entrega de un vehículo. */
export interface Appointment extends TenantScopedDocument {
  vehicleId: string;
  chassis: string;
  model: string;
  color: string | null;
  sede: string;
  clientName: string | null;
  clientId: string | null;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  assignedAdvisorId: string;
  assignedAdvisorName: string;
  status: string;
  reminderSentAt?: unknown;
  createdBy: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * Filtros de negocio para listar agendamientos. Nunca incluye `tenantId` —
 * eso lo aplica `scopedQuery()` desde el contexto, no un parámetro que el
 * servicio pueda pasar.
 */
export interface AppointmentQueryFilters {
  vehicleId?: string;
  sede?: string;
  assignedAdvisorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class AppointmentsRepository extends TenantScopedRepository<Appointment> {
  protected readonly collectionName = 'appointments';

  private buildQuery(filters: AppointmentQueryFilters): Query {
    let query = this.scopedQuery();

    if (filters.vehicleId) {
      query = query.where('vehicleId', '==', filters.vehicleId);
    }
    if (filters.sede) {
      query = query.where('sede', '==', filters.sede);
    }
    if (filters.assignedAdvisorId) {
      query = query.where('assignedAdvisorId', '==', filters.assignedAdvisorId);
    }
    if (filters.dateFrom) {
      query = query.where('scheduledDate', '>=', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.where('scheduledDate', '<=', filters.dateTo);
    }

    return query;
  }

  /**
   * Agendamientos de un asesor en una fecha concreta, del concesionario
   * activo. Usado tanto para validar conflictos de horario (`create`/
   * `update`) como para el listado de slots ocupados (`getOccupiedSlots`).
   */
  async findByAdvisorAndDate(
    advisorId: string,
    date: string,
  ): Promise<Appointment[]> {
    const snapshot = await this.scopedQuery()
      .where('assignedAdvisorId', '==', advisorId)
      .where('scheduledDate', '==', date)
      .get();

    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Appointment,
    );
  }

  /**
   * Agendamientos en estado AGENDADO de una fecha dada, del concesionario
   * activo. Lo usa AppointmentReminderService, una vez por tenant activo —
   * ver el encabezado de ese archivo para el porqué.
   */
  async findScheduledForDate(date: string): Promise<Appointment[]> {
    const snapshot = await this.scopedQuery()
      .where('scheduledDate', '==', date)
      .where('status', '==', 'AGENDADO')
      .get();

    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Appointment,
    );
  }

  /**
   * Listado completo sin paginar, ordenado por fecha/hora. Camino que
   * conservan los clientes que no envían `page`/`limit`/`cursor` — el
   * comportamiento pre-migración cuando no se pedía paginación.
   */
  async listAll(filters: AppointmentQueryFilters): Promise<Appointment[]> {
    const snapshot = await this.buildQuery(filters)
      .orderBy('scheduledDate', 'asc')
      .orderBy('scheduledTime', 'asc')
      .orderBy('__name__', 'asc')
      .get();

    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Appointment,
    );
  }

  /**
   * Página de agendamientos vía el cursor genérico de
   * `TenantScopedRepository.paginate()`.
   *
   * Cambio de comportamiento reportado en la migración: `paginate()` solo
   * soporta UN `orderByField` más `__name__` como desempate — no los tres
   * niveles (`scheduledDate`, `scheduledTime`, `__name__`) que usaba la
   * consulta original. Con varios agendamientos en la misma fecha, el orden
   * relativo dentro del día pasa a desempatar por id de documento en vez de
   * por hora. No se reimplementa paginación propia por instrucción explícita
   * de la migración — usar `paginate()` tal cual lo expone la base.
   */
  async paginateFiltered(
    filters: AppointmentQueryFilters,
    options: Pick<PaginateOptions, 'limit' | 'cursor'>,
  ): Promise<Page<Appointment>> {
    return this.paginate(
      { ...options, orderByField: 'scheduledDate', direction: 'asc' },
      this.buildQuery(filters),
    );
  }

  /** Total de agendamientos que matchean los filtros, sin traerlos. */
  async countFiltered(filters: AppointmentQueryFilters): Promise<number> {
    return this.count(this.buildQuery(filters));
  }
}
