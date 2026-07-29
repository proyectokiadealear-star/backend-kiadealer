import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';
import {
  AntennaType,
  ImprintsStatus,
  InstalledStatus,
  RimsStatus,
  SeatType,
} from './dto/create-certification.dto';

/**
 * Certificación física del vehículo. Relación 1:1 con el vehículo — el id
 * del documento es el propio `vehicleId` (igual que en DeliveryCeremony:
 * un vehículo tiene a lo sumo una certificación, así que no hace falta un
 * id generado aparte).
 */
export interface CertificationDocument extends TenantScopedDocument {
  vehicleId: string;
  radio: InstalledStatus;
  rims: {
    status: RimsStatus;
    photoUrl: string | null;
  };
  seatType: SeatType;
  antenna: AntennaType;
  trunkCover: InstalledStatus;
  mileage: number;
  imprints: ImprintsStatus;
  notes: string | null;
  certifiedAt: unknown;
  certifiedBy: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

@Injectable()
export class CertificationsRepository extends TenantScopedRepository<CertificationDocument> {
  protected readonly collectionName = 'certifications';
}
