import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

/**
 * Repositorios de solo lectura para colecciones cuyo módulo dueño YA migró a
 * `TenantScopedRepository`, pero cuyo repositorio no está en los `exports`
 * de su módulo — solo el service (`ServiceOrdersModule`, `DocumentationModule`,
 * `DeliveryModule`, `AppointmentsModule` y `CatalogsModule` exportan
 * únicamente su `*Service`).
 *
 * `reports` es agregación pura de solo lectura sobre TODA la colección
 * scopeada al tenant: no necesita la lógica de negocio de esos servicios
 * (validaciones, notificaciones, escrituras), solo `findAll()` acotado al
 * concesionario activo — que ya expone `TenantScopedRepository` sin que haga
 * falta sobreescribir nada. Se replica el mismo criterio documentado en
 * `notifications/notification-recipients.repository.ts` sobre `users` (ver
 * docs/design/01-multi-tenancy.md, sección "Sobre la duplicación
 * users/notifications"): un repositorio propio y acotado al módulo que lo
 * necesita es preferible a tocar el módulo ajeno para exportar el suyo.
 *
 * Todas extienden `TenantScopedRepository` DIRECTAMENTE, no
 * `MigrationBridgeRepository`: las colecciones de abajo ya tienen `tenantId`
 * en el 100% de sus documentos (sus módulos migraron), así que no hay nada
 * que tolerar. Ver `vehicle-lookup.repository.ts` para el caso contrario
 * (`vehicles`, todavía sin migrar).
 *
 * ── El hallazgo que motiva este archivo ─────────────────────────────────
 * Antes de esta migración, `reports.service.ts` leía estas CINCO colecciones
 * con `this.firebase.firestore().collection(...).get()` sin ningún
 * `where('tenantId', ...)` — a pesar de que sus módulos dueños YA tienen el
 * aislamiento resuelto puertas adentro. El resultado: cada dashboard de
 * KPIs mezclaba órdenes de trabajo, documentaciones, ceremonias de entrega,
 * agendamientos e ítems de catálogo de TODOS los concesionarios en la misma
 * base compartida. Multi-tenancy rota en silencio — exactamente el patrón
 * que describe docs/design/01-multi-tenancy.md D-103. `findAll()` cierra el
 * agujero sin cambiar ninguna otra semántica de negocio.
 */

interface ReportServiceOrderDocument extends TenantScopedDocument {
  vehicleId: string;
  sede?: string;
  createdBy?: string;
  createdByName?: string;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  assignedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  checklist?: unknown[];
  [key: string]: unknown;
}

/** OTs (`service-orders`) — insumo de topAsesores.ordenesGeneradas, topTaller y OTIF. */
@Injectable()
export class ReportServiceOrdersRepository extends TenantScopedRepository<ReportServiceOrderDocument> {
  protected readonly collectionName = 'service-orders';
}

interface ReportDocumentationDocument extends TenantScopedDocument {
  vehicleId: string;
  createdAt?: unknown;
  accessories?: unknown[];
  documentationStatus?: string;
  [key: string]: unknown;
}

/** Documentaciones — insumo de accesorios vendidos/obsequiados y OTIF. */
@Injectable()
export class ReportDocumentationsRepository extends TenantScopedRepository<ReportDocumentationDocument> {
  protected readonly collectionName = 'documentations';
}

interface ReportDeliveryCeremonyDocument extends TenantScopedDocument {
  vehicleId: string;
  deliveredBy?: string;
  deliveredByName?: string;
  createdAt?: unknown;
  [key: string]: unknown;
}

/** Ceremonias de entrega — insumo de topAsesores.entregas. */
@Injectable()
export class ReportDeliveryCeremoniesRepository extends TenantScopedRepository<ReportDeliveryCeremonyDocument> {
  protected readonly collectionName = 'deliveryCeremonies';
}

interface ReportAppointmentDocument extends TenantScopedDocument {
  vehicleId: string;
  status?: string;
  scheduledDate?: string;
  [key: string]: unknown;
}

/** Agendamientos — insumo del cálculo de OTIF (fecha prometida). */
@Injectable()
export class ReportAppointmentsRepository extends TenantScopedRepository<ReportAppointmentDocument> {
  protected readonly collectionName = 'appointments';
}

interface ReportAccessoryCatalogItem extends TenantScopedDocument {
  key?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Ítems del catálogo de accesorios (`catalogs/accessories/items`) — semilla
 * de `accessories.byKey` para que el frontend siempre reciba todas las keys
 * conocidas, incluso con cero ventas en el período.
 *
 * `collectionName` con slashes apunta a la subcolección física, igual patrón
 * que documenta `catalogs/catalogs.repository.ts`: cualquier path con número
 * impar de segmentos (colección → documento → colección) es una referencia
 * de colección válida para el SDK de Firestore.
 */
@Injectable()
export class ReportAccessoriesCatalogRepository extends TenantScopedRepository<ReportAccessoryCatalogItem> {
  protected readonly collectionName = 'catalogs/accessories/items';
}
