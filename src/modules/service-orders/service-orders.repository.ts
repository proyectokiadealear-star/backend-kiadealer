import { Injectable } from '@nestjs/common';
import { Query } from 'firebase-admin/firestore';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

export interface OrderAccessory {
  key: string;
  classification: string;
}

export interface ChecklistItem {
  key: string;
  installed: boolean;
}

export interface OrderPrediction {
  key: string;
  probability: number;
  reason: string;
}

/**
 * Orden de trabajo (OT). Se identifica con un id propio (uuid), a diferencia
 * de CertificationDocument/DeliveryCeremony que usan el vehicleId — un
 * vehículo puede tener varias OTs a lo largo de su vida (reaperturas).
 */
export interface ServiceOrderDocument extends TenantScopedDocument {
  orderNumber: string;
  vehicleId: string;
  sede: string;
  chassis: string;
  accessories: OrderAccessory[];
  predictions: OrderPrediction[];
  checklist: ChecklistItem[];
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  assignedAt: unknown;
  status: string;
  isReopening: boolean;
  previousOrderId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

@Injectable()
export class ServiceOrdersRepository extends TenantScopedRepository<ServiceOrderDocument> {
  protected readonly collectionName = 'service-orders';

  /**
   * Expone la query base ya acotada al concesionario activo para que el
   * servicio encadene los filtros de negocio (sede, técnico asignado,
   * vehículo): ese filtrado depende del rol de quien pregunta y vive en el
   * servicio, no en el repositorio. `scopedQuery()` es protegido en la base
   * justamente para no filtrarse fuera de la capa de repositorios sin pasar
   * por acá.
   */
  query(): Query {
    return this.scopedQuery();
  }
}
