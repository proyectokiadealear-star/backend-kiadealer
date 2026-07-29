import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

/**
 * Ceremonia de entrega. El documento se identifica por `vehicleId` — un
 * vehículo tiene a lo sumo una ceremonia, por eso `create()` se llama
 * siempre con `vehicleId` como id explícito en vez de dejar que Firestore
 * genere uno.
 */
export interface DeliveryCeremony extends TenantScopedDocument {
  vehicleId: string;
  appointmentId: string;
  deliveryPhotoUrl: string | null;
  signedActaUrl: string | null;
  clientComment: string | null;
  deliveredBy: string;
  deliveredByName: string;
  createdAt: unknown;
}

@Injectable()
export class DeliveryRepository extends TenantScopedRepository<DeliveryCeremony> {
  protected readonly collectionName = 'deliveryCeremonies';
}
