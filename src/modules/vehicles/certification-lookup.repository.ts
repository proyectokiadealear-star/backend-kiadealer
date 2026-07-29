import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

export interface CertificationLookup extends TenantScopedDocument {
  [key: string]: unknown;
}

/**
 * Lectura/borrado de `certifications` desde `vehicles`. Relación 1:1: el id
 * del documento es el propio vehicleId.
 *
 * Copia local — `CertificationsModule` ya importa `VehiclesModule`, así que
 * importarlo de vuelta acá crearía un ciclo. Ver
 * `documentation-lookup.repository.ts` en este mismo módulo para el
 * razonamiento completo.
 */
@Injectable()
export class CertificationLookupRepository extends TenantScopedRepository<CertificationLookup> {
  protected readonly collectionName = 'certifications';
}
