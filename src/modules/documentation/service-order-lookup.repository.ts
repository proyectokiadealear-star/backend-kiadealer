import { Injectable } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';
import { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Acceso a `service-orders` desde Documentation: al completar una
 * documentación en flujo de reapertura, hay que ubicar la OT vigente del
 * vehículo y agregarle al checklist los accesorios nuevos.
 *
 * Puente temporal: `service-orders` todavía no migró (ServiceOrdersService
 * sigue usando Firestore crudo, sin repositorio propio). Ver
 * MigrationBridgeRepository para el porqué y las garantías de aislamiento.
 * Se elimina cuando exista un ServiceOrdersRepository con scope de tenant.
 */
@Injectable()
export class ServiceOrderLookupRepository extends MigrationBridgeRepository {
  protected readonly collectionName = 'service-orders';
  protected readonly supersededBy = 'ServiceOrdersService';

  /**
   * Busca la OT más reciente del vehículo (por `createdAt` descendente),
   * igual que hacía la consulta cruda original. La condición de pertenencia
   * se evalúa por documento (vía `isAccessible`) porque acá no hay un id
   * conocido de antemano para pedir un único `get()`: la búsqueda es por
   * `vehicleId`, así que primero hay que traer candidatos y después
   * filtrar los que no son del concesionario activo — nunca al revés.
   */
  async findLatestByVehicleId(
    vehicleId: string,
  ): Promise<(Record<string, unknown> & { id: string }) | null> {
    // Fallo cerrado explícito: a diferencia de readAccessible/updateIfAccessible
    // (que siempre resuelven un documento y por lo tanto llaman a
    // isAccessible → getOrThrow), esta consulta puede devolver cero
    // candidatos. Sin este chequeo, una consulta fuera de contexto con
    // resultado vacío pasaría de largo en vez de reventar.
    TenantContext.getOrThrow();

    const snapshot = await this.collection()
      .where('vehicleId', '==', vehicleId)
      .get();

    const accessible = snapshot.docs
      .filter((doc) => this.isAccessible(doc.id, doc.data()))
      .map((doc) => ({ id: doc.id, ...doc.data() }));

    if (accessible.length === 0) return null;

    return accessible.sort(
      (a, b) =>
        ((b as any)['createdAt']?._seconds ?? 0) -
        ((a as any)['createdAt']?._seconds ?? 0),
    )[0];
  }

  /**
   * Actualiza la OT solo si es accesible desde el concesionario activo.
   * Devuelve `false` si no lo es, para que el llamador distinga
   * "no aplicado" de "aplicado".
   */
  async updateFields(
    orderId: string,
    changes: Record<string, unknown>,
  ): Promise<boolean> {
    return this.updateIfAccessible(orderId, changes);
  }
}
