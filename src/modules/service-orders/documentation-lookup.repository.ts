import { Injectable, Logger } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';
import { TenantContext } from '../../common/tenant/tenant-context';

export interface DocAccessory {
  key: string;
  classification: string;
}

export interface DocHistoryEntry {
  id: string;
  accessories: DocAccessory[];
}

interface CachedTenantEntry {
  data: DocHistoryEntry[];
  ts: number;
}

/**
 * Acceso a `documentations` desde service-orders: leer la documentación de
 * un vehículo (accesorios vendidos/obsequiados al generar la OT) y escanear
 * el histórico reciente para el algoritmo de predicción.
 *
 * Puente temporal: `documentations` todavía no migró su propio módulo a
 * TenantScopedRepository. Ver MigrationBridgeRepository para el porqué y las
 * garantías de aislamiento del caso de un solo documento.
 *
 * ── Por qué el escaneo histórico NO usa la tolerancia del puente ──────────
 * `findByVehicleId` sí tolera un documento sin `tenantId` (caso
 * pre-migración): es la lectura de UN vehículo puntual, y la tolerancia es
 * temporal mientras corre el paso 2 del runbook.
 *
 * `findRecentForActiveTenant` es distinto: agrega patrones de compra de
 * VARIOS vehículos para alimentar una predicción. Si tolerara documentos sin
 * `tenantId`, un documento de origen ambiguo (podría ser de cualquier
 * concesionario, incluida la competencia) terminaría mezclado en el perfil
 * de comportamiento del concesionario activo. Eso es exactamente la fuga de
 * inteligencia comercial que hay que evitar — así que acá se falla cerrado:
 * se filtra estrictamente por `tenantId == ctx.tenantId` y un documento
 * ambiguo se excluye, no se tolera. Ver docs/design/01-multi-tenancy.md.
 */
@Injectable()
export class DocumentationLookupRepository extends MigrationBridgeRepository {
  protected readonly collectionName = 'documentations';
  protected readonly supersededBy = 'DocumentationsService';

  private readonly historyLogger = new Logger(
    DocumentationLookupRepository.name,
  );

  /**
   * Caché TTL del histórico de documentaciones, indexada por `tenantId`.
   *
   * La caché original era una única entrada compartida por todas las
   * requests del proceso — bajo multi-tenancy eso mezclaría el histórico de
   * concesionarios distintos en el mismo balde. Indexarla por tenant
   * preserva el ahorro (evita re-escanear 500 documentos en cada OT) sin
   * reintroducir la fuga: cada concesionario tiene su propia entrada, con su
   * propio TTL, y nunca lee la del otro.
   */
  private readonly cacheByTenant = new Map<string, CachedTenantEntry>();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutos

  /**
   * Documentación de un vehículo, o `null` si no existe o pertenece a otro
   * concesionario. Tolera documentos pre-migración sin `tenantId` — ver
   * MigrationBridgeRepository.
   */
  async findByVehicleId(
    vehicleId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.readAccessible(vehicleId);
  }

  /**
   * Últimas `limit` documentaciones con accesorios, del concesionario activo
   * ÚNICAMENTE. Ver la nota de la clase sobre por qué esta consulta no
   * tolera documentos sin `tenantId`.
   */
  async findRecentForActiveTenant(limit: number): Promise<DocHistoryEntry[]> {
    const { tenantId } = TenantContext.getOrThrow();

    const now = Date.now();
    const cached = this.cacheByTenant.get(tenantId);
    if (cached && now - cached.ts <= this.cacheTtlMs) {
      return cached.data;
    }

    const snapshot = await this.collection()
      .where('tenantId', '==', tenantId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const data: DocHistoryEntry[] = snapshot.docs
      .map((doc) => {
        const raw = doc.data()?.['accessories'];
        const accessories = Array.isArray(raw) ? (raw as DocAccessory[]) : [];
        return { id: doc.id, accessories };
      })
      .filter((entry) => entry.accessories.length > 0);

    this.cacheByTenant.set(tenantId, { data, ts: now });
    this.historyLogger.debug(
      `[docsCache:${tenantId}] refrescado — ${data.length} docs`,
    );

    return data;
  }
}
