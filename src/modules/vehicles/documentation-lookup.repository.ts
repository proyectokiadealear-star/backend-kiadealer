import { Injectable, Logger } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';
import { TenantContext } from '../../common/tenant/tenant-context';

export interface DocumentationLookup extends TenantScopedDocument {
  vehicleId?: string;
  clientName?: string;
  clientId?: string;
  clientPhone?: string;
  accessories?: Array<{ key: string; classification: string }>;
  createdAt?: unknown;
}

/**
 * Lectura de `documentations` desde `vehicles`.
 *
 * Copia local, deliberadamente independiente del `DocumentationRepository`
 * real (`src/modules/documentation/`): `DocumentationModule` ya importa
 * `VehiclesModule`, así que importar `DocumentationModule` de vuelta acá
 * crearía un ciclo. Mismo patrón que `DocumentationLookupRepository` en
 * `service-orders/` y `ServiceOrderLookupRepository` en `documentation/`.
 */
@Injectable()
export class DocumentationLookupRepository extends TenantScopedRepository<DocumentationLookup> {
  protected readonly collectionName = 'documentations';

  private readonly logger = new Logger(DocumentationLookupRepository.name);

  /** Caché de accesorios históricos, por tenant — TTL 5 min. */
  private readonly cache = new Map<
    string,
    { data: Array<Array<{ key: string; classification: string }>>; ts: number }
  >();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  /**
   * Batch-fetch de documentaciones por id de vehículo, ya acotado al tenant
   * activo (`findById` hereda el chequeo de pertenencia). Reemplaza al
   * `db.getAll(...refs)` original: sin scope, ese batch-get habría devuelto
   * documentos de cualquier concesionario sin distinción.
   */
  async findManyByVehicleIds(
    vehicleIds: string[],
  ): Promise<Map<string, DocumentationLookup>> {
    const results = await Promise.all(
      vehicleIds.map((id) => this.findById(id)),
    );
    const map = new Map<string, DocumentationLookup>();
    results.forEach((doc, index) => {
      if (doc) map.set(vehicleIds[index], doc);
    });
    return map;
  }

  /**
   * Últimas 500 documentaciones del tenant activo, para predicción de
   * potencial de venta. Cacheada por tenant — el `docsCache` original no
   * tenía scope: bajo multi-tenancy mezclaría el histórico de compra de
   * distintos concesionarios en la misma predicción. Mismo patrón que
   * `service-orders/documentation-lookup.repository.ts`.
   */
  async findRecentForActiveTenant(): Promise<
    Array<{ id: string; accessories: Array<{ key: string; classification: string }> }>
  > {
    const { tenantId } = TenantContext.getOrThrow();
    const cached = this.cache.get(tenantId);
    const now = Date.now();

    if (cached && now - cached.ts < this.cacheTtlMs) {
      return cached.data.map((accessories, index) => ({
        id: `cached-${index}`,
        accessories,
      }));
    }

    const snapshot = await this.scopedQuery()
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const withIds = snapshot.docs.map((doc) => {
      const raw = (doc.data() as DocumentationLookup).accessories;
      return {
        id: doc.id,
        accessories: Array.isArray(raw) ? raw : [],
      };
    });

    this.cache.set(tenantId, {
      data: withIds.map((d) => d.accessories),
      ts: now,
    });
    this.logger.debug(
      `[docsCache:${tenantId}] refrescado — ${withIds.length} docs`,
    );

    return withIds.filter((d) => d.accessories.length > 0);
  }
}
