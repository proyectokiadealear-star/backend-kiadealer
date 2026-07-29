import { Injectable } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';

/**
 * Acceso a campos sueltos de `vehicles` para las actualizaciones que
 * service-orders hace por fuera de las operaciones de negocio que ya expone
 * VehiclesService (changeStatus/addStatusHistory) — actualizar el técnico
 * asignado cuando el vehículo ya avanzó de estado, y guardar los datos de
 * una reapertura de OT.
 *
 * Puente temporal: `vehicles` todavía no migró. Ver MigrationBridgeRepository
 * para el porqué y las garantías de aislamiento.
 *
 * Deliberadamente independiente de `certifications/vehicle-fields.repository.ts`
 * aunque apunte a la misma colección: cada módulo migrado mantiene su propio
 * puente para no crear una dependencia service-orders → certifications que
 * hoy no existe. Mismo criterio que la duplicación
 * UsersRepository/NotificationRecipientsRepository documentada en
 * docs/design/01-multi-tenancy.md.
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
