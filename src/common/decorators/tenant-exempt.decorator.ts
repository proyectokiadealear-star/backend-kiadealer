import { SetMetadata } from '@nestjs/common';

export const IS_TENANT_EXEMPT = 'isTenantExempt';

/**
 * Exime a un endpoint de la validación de TenantGuard.
 *
 * Reservado para rutas que por definición operan sin concesionario:
 * autenticación, health checks y provisioning de plataforma. Todo uso nuevo
 * debe justificarse en revisión — es la única puerta que deja pasar una
 * request sin tenant asignado.
 */
export const TenantExempt = () => SetMetadata(IS_TENANT_EXEMPT, true);
