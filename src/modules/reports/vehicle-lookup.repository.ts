import { Injectable } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';

/** Vista de `vehicles` que usa `reports`: siempre trae el id del documento. */
export interface ReportVehicleRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * Acceso de solo lectura a `vehicles` para los tres reportes que este módulo
 * expone: KPIs agregados (`getAnalytics`), trazabilidad de un vehículo
 * puntual (`generateVehicleReport`) y desempeño de un técnico
 * (`getTechnicianPerformance`).
 *
 * Puente temporal: `vehicles` todavía no migró — `VehiclesService` sigue en
 * `this.firebase.firestore()` crudo (ver `vehicles.service.ts`). Ver
 * `MigrationBridgeRepository` para el porqué y las garantías de aislamiento:
 * aplica scope cuando el documento YA tiene `tenantId`, y solo tolera su
 * ausencia (caso pre-migración) — un vehículo de OTRO concesionario nunca es
 * accesible. Se borra cuando migre `VehiclesService` — mismo criterio que
 * `certifications/vehicle-fields.repository.ts` y
 * `service-orders/vehicle-fields.repository.ts`, cada uno con su propio
 * puente independiente a la misma colección física.
 *
 * ── Por qué esto hace un full scan (a diferencia del resto del módulo) ────
 * `vehicles` no tiene `tenantId` en sus documentos todavía, así que Firestore
 * no puede filtrar server-side por concesionario — el campo sobre el que
 * armar el `where` no existe. La única defensa disponible hoy es leer y
 * filtrar en memoria con `isAccessible()`, igual que hace
 * `AppointmentVehicleBridgeRepository.findManyAccessible()`. Es el mismo
 * costo que paga hoy TODO el sistema mientras `vehicles` no migre — no es una
 * regresión de este cambio, y HOY YA es mejor que el código anterior: antes
 * `reports.service.ts` ni siquiera intentaba distinguir tenants (leía la
 * colección entera y filtraba solo por `sede`/rol). Se vuelve `scopedQuery()`
 * + `.get()`/`.count()` normal el día que `VehiclesService` migre.
 */
@Injectable()
export class VehicleLookupRepository extends MigrationBridgeRepository {
  protected readonly collectionName = 'vehicles';
  protected readonly supersededBy = 'VehiclesService';

  /**
   * Vehículo puntual accesible desde el concesionario activo, o `null` si no
   * existe o es de otro concesionario (→ 404, nunca 403 — D-104).
   */
  async findByIdAccessible(
    vehicleId: string,
  ): Promise<ReportVehicleRecord | null> {
    const data = await this.readAccessible(vehicleId);
    return data ? { id: vehicleId, ...data } : null;
  }

  /**
   * TODOS los vehículos accesibles desde el concesionario activo — base de
   * los KPIs agregados de `getAnalytics()`. Ver la nota de clase sobre el
   * costo del full scan.
   */
  async findAllAccessible(): Promise<ReportVehicleRecord[]> {
    const snapshot = await this.collection().get();
    return snapshot.docs
      .filter((doc) => this.isAccessible(doc.id, doc.data() ?? {}))
      .map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Vehículos asignados a un técnico, acotados al concesionario activo.
   *
   * Filtra por `assignedTechnicianUid` server-side (reduce el volumen leído
   * antes de bajarlo) y por accesibilidad de tenant en memoria después —
   * el `uid` de un técnico no alcanza como límite de aislamiento por sí
   * solo: es la corrección al hallazgo más grave de esta migración, ver
   * el resumen de la migración de `reports`.
   */
  async findByAssignedTechnician(uid: string): Promise<ReportVehicleRecord[]> {
    const snapshot = await this.collection()
      .where('assignedTechnicianUid', '==', uid)
      .get();
    return snapshot.docs
      .filter((doc) => this.isAccessible(doc.id, doc.data() ?? {}))
      .map((doc) => ({ id: doc.id, ...doc.data() }));
  }
}
