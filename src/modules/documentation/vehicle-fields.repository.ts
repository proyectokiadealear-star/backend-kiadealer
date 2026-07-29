import { Injectable } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';

/**
 * Acceso a campos sueltos de `vehicles` para las actualizaciones que
 * Documentation hace por fuera de las operaciones de negocio que ya expone
 * VehiclesService (changeStatus/addStatusHistory) — por ejemplo guardar
 * `registrationReceivedDate` sin cambiar el estado, o limpiar los flags de
 * reapertura (`isReopening`, `reopenReason`, etc.) al completar una
 * documentación pendiente.
 *
 * Puente temporal: `vehicles` todavía no migró (VehiclesService sigue
 * usando Firestore crudo). Ver MigrationBridgeRepository para el porqué y
 * las garantías de aislamiento. Se elimina cuando VehiclesService migre —
 * en ese punto Documentation debería consumir un método de VehiclesService
 * en vez de escribir campos sueltos directamente.
 *
 * Nota: existe una clase homónima en `certifications/vehicle-fields.repository.ts`.
 * No se reutiliza esa instancia a propósito: cada módulo consumidor es dueño
 * de su propio puente (mismo patrón que AppointmentLookupRepository en
 * delivery), para no acoplar Documentation a CertificationsModule solo por
 * este acceso temporal.
 */
@Injectable()
export class VehicleFieldsRepository extends MigrationBridgeRepository {
  protected readonly collectionName = 'vehicles';
  protected readonly supersededBy = 'VehiclesService';

  /**
   * Devuelve `false` si el vehículo no existe o es de otro concesionario, en
   * vez de escribir a ciegas.
   */
  async updateFields(
    vehicleId: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    return this.updateIfAccessible(vehicleId, fields);
  }
}
