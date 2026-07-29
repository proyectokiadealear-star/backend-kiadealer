import { Injectable } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';

/**
 * Acceso a `appointments` desde delivery: leer un agendamiento y marcarlo
 * como completado tras la ceremonia.
 *
 * Puente temporal: `appointments` todavía no migró. Ver
 * MigrationBridgeRepository para el porqué y las garantías de aislamiento.
 */
@Injectable()
export class AppointmentLookupRepository extends MigrationBridgeRepository {
  protected readonly collectionName = 'appointments';
  protected readonly supersededBy = 'AppointmentsService';

  async findById(appointmentId: string): Promise<Record<string, any> | null> {
    return this.readAccessible(appointmentId);
  }

  /**
   * Revalida la pertenencia antes de escribir: `findById` y `markStatus` son
   * llamadas separadas y una escritura no debe escapar al scope.
   */
  async markStatus(
    appointmentId: string,
    status: string,
    updatedAt: unknown,
  ): Promise<void> {
    await this.updateIfAccessible(appointmentId, { status, updatedAt });
  }
}
