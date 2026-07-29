import { Injectable } from '@nestjs/common';
import { MigrationBridgeRepository } from '../../common/repositories/migration-bridge.repository';

/**
 * Acceso de solo lectura a `vehicles` para el único punto donde
 * AppointmentsService toca esa colección directamente: enriquecer
 * agendamientos legacy que no tengan `clientName` o `color` guardados en el
 * propio documento (campos añadidos después de que ya existieran
 * agendamientos viejos sin ellos). Ver `AppointmentsService.enrichLegacyDocs`.
 *
 * Puente temporal: `vehicles` todavía no migró. Ver MigrationBridgeRepository
 * para el porqué y las garantías de aislamiento (aplica scope cuando el
 * documento YA tiene `tenantId`, solo tolera su ausencia — nunca expone un
 * vehículo de otro concesionario).
 *
 * Se borra cuando migre VehiclesService. Agregar esta fila a la tabla de
 * "Puentes vigentes" de docs/design/06-runbook-migracion.md queda fuera del
 * alcance de este cambio (ese archivo vive fuera de
 * src/modules/appointments/) — reportado como pendiente en el resumen de
 * esta migración.
 */
@Injectable()
export class AppointmentVehicleBridgeRepository extends MigrationBridgeRepository {
  protected readonly collectionName = 'vehicles';
  protected readonly supersededBy = 'VehiclesService';

  /**
   * Devuelve un mapa `vehicleId → datos` con SOLO los vehículos accesibles
   * desde el concesionario activo (propios, o pre-migración sin `tenantId`
   * todavía). Un vehículo de otro concesionario no aparece en el mapa — el
   * llamador no puede distinguir "no existe" de "es de otro tenant".
   */
  async findManyAccessible(
    vehicleIds: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const entries = await Promise.all(
      vehicleIds.map(
        async (id) => [id, await this.readAccessible(id)] as const,
      ),
    );

    return new Map(
      entries.filter(
        (entry): entry is [string, Record<string, unknown>] =>
          entry[1] !== null,
      ),
    );
  }
}
