import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

/** Un accesorio clasificado por el asesor al documentar el vehículo. */
export interface DocumentationAccessoryItem {
  key: string;
  classification: string;
  notes?: string;
}

/**
 * Documentación del vehículo: asociación con el cliente, PDFs subidos a
 * Storage y clasificación de accesorios (VENDIDO/OBSEQUIADO/NO_APLICA).
 * Relación 1:1 con el vehículo — el id del documento es el propio
 * `vehicleId` (mismo patrón que CertificationDocument y DeliveryCeremony).
 */
export interface DocumentationDocument extends TenantScopedDocument {
  vehicleId: string;
  clientName: string;
  clientId: string;
  clientPhone: string;
  registrationType: string;
  paymentMethod: string;
  vehicleInvoiceUrl: string | null;
  giftEmailUrls: string[];
  accessoryInvoiceUrls: string[];
  // Retrocompat: primer elemento de los arrays de arriba (o null)
  giftEmailUrl: string | null;
  accessoryInvoiceUrl: string | null;
  accessories: DocumentationAccessoryItem[];
  registrationReceivedDate: string | null;
  documentationStatus: 'PENDIENTE' | 'COMPLETO';
  documentedAt: unknown;
  documentedBy: string;
  createdAt: unknown;
  updatedAt?: unknown;
}

@Injectable()
export class DocumentationRepository extends TenantScopedRepository<DocumentationDocument> {
  protected readonly collectionName = 'documentations';
}
