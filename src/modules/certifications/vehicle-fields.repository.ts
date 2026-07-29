import { Injectable } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';

/**
 * Acceso a campos sueltos de `vehicles` para las actualizaciones que
 * Certifications hace por fuera de las operaciones de negocio que ya expone
 * VehiclesService (changeStatus/addStatusHistory) — por ejemplo refrescar
 * `photoUrl` tras subir una foto, o limpiar los flags
 * `certifiedWhileNoFacturado`/`certifiedWhileEarlyState` al borrar una
 * certificación.
 *
 * Puente temporal: `vehicles` todavía no migró. Ver MigrationBridgeRepository
 * para el porqué y las garantías de aislamiento.
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
