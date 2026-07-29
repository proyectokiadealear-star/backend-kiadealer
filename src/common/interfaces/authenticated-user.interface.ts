import { RoleEnum } from '../enums/role.enum';
import { SedeEnum } from '../enums/sede.enum';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: RoleEnum;
  active: boolean;
  displayName?: string;

  /**
   * Concesionario al que pertenece el usuario. Proviene del custom claim
   * `tenantId` del token ya verificado — nunca del payload de la request.
   *
   * Opcional durante la migración: los tokens emitidos antes de re-emitir los
   * claims no lo traen. TenantGuard rechaza esas requests con 401.
   */
  tenantId?: string;

  /**
   * Sucursales del concesionario a las que el usuario tiene acceso. Reemplaza
   * a `sede` con soporte multi-sucursal nativo.
   */
  establishmentIds?: string[];

  /**
   * Habilita operaciones entre concesionarios vía runAsPlatform(). Reservado
   * para soporte de plataforma y migraciones; nunca se otorga a un usuario de
   * un concesionario.
   */
  platformAdmin?: boolean;

  /**
   * @deprecated Sustituido por `establishmentIds`. SedeEnum es un enum de
   * valores fijos y no sobrevive a multi-tenancy: cada concesionario define
   * sus propias sucursales. Ver docs/design/01-multi-tenancy.md D-107.
   * Se mantiene hasta que los 14 módulos migren al repositorio con scope.
   */
  sede: SedeEnum;
}
