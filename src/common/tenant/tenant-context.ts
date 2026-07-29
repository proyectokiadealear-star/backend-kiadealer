import { AsyncLocalStorage } from 'node:async_hooks';
import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../enums/role.enum';

/**
 * Datos del concesionario y del actor que ejecutan la request en curso.
 *
 * Se poblan UNA sola vez, desde los custom claims del token ya verificado
 * (ver TenantContextMiddleware). Ningún valor de aquí puede provenir del body,
 * del query string ni de un parámetro de ruta — ver docs/design/01-multi-tenancy.md D-102.
 */
export interface TenantContextData {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: RoleEnum;
  readonly establishmentIds: readonly string[];
  readonly platformAdmin: boolean;
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<TenantContextData>();

/**
 * Transporta el contexto del tenant a través de la cadena de llamadas
 * asíncronas de una request.
 *
 * Se usa AsyncLocalStorage en lugar de providers request-scoped de NestJS
 * porque estos últimos contaminan: cualquier servicio que inyecte uno se
 * vuelve request-scoped también, y Nest reconstruye ese subárbol de inyección
 * en cada request. Con 14 módulos interconectados el costo es real.
 * Ver docs/design/01-multi-tenancy.md D-101.
 */
export const TenantContext = {
  /** Ejecuta `fn` con el contexto dado activo durante toda su cadena async. */
  run<T>(data: TenantContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  /** Contexto activo, o `undefined` si se llamó fuera de una request. */
  get(): TenantContextData | undefined {
    return storage.getStore();
  },

  /**
   * Contexto activo, o excepción si no lo hay.
   *
   * Este es el mecanismo de fallo cerrado del sistema: una consulta ejecutada
   * fuera de contexto revienta en vez de devolver datos de todos los tenants.
   */
  getOrThrow(): TenantContextData {
    const context = storage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'Operación ejecutada fuera de un contexto de tenant. ' +
          'Toda consulta debe originarse en una request autenticada o dentro de runAsPlatform().',
      );
    }
    return context;
  },

  /** Identificador del tenant activo. Atajo de `getOrThrow().tenantId`. */
  currentTenantId(): string {
    return TenantContext.getOrThrow().tenantId;
  },
} as const;
