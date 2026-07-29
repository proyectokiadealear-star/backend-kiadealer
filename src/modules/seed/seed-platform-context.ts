import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { RoleEnum } from '../../common/enums/role.enum';
import { runAsPlatform } from '../../common/tenant/run-as-platform';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';

/**
 * DECISIÓN DE DISEÑO — por qué el seeder abre su propio TenantContext
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SeedService es, funcionalmente, un módulo de PLATAFORMA, no de negocio de
 * un tenant activo: un desarrollador lo usa para poblar UN concesionario
 * puntual durante setup/testing, no un usuario operando dentro de su propio
 * concesionario. Eso ya se ve en cómo está protegido HOY: `SeedController`
 * no tiene `@UseGuards(FirebaseAuthGuard, ...)` en ningún endpoint — ver
 * seed.controller.ts. Ningún endpoint de /seed exige un Bearer token, solo
 * el `secretKey` compartido que valida `SeedService.validateSeedKey()`.
 *
 * Consecuencia directa, verificada contra el código real (no supuesta):
 * `TenantContextInterceptor` abre el `AsyncLocalStorage` del tenant leyendo
 * `req.user.tenantId`, pero `req.user` solo lo puebla `FirebaseAuthGuard` —
 * que nunca corre en /seed. El interceptor lo maneja como "ruta pública" y
 * deja pasar sin abrir contexto (ver su propio comentario: "si no hay
 * usuario ... deja pasar sin abrir contexto"). Es decir: en cada request a
 * /seed, `TenantContext.get()` es `undefined`. No hay NINGÚN contexto del
 * que derivar un `tenantId` implícito — ni siquiera en teoría.
 *
 * `runAsPlatform()` por sí solo no alcanza para resolver esto: exige un
 * contexto YA ABIERTO con `platformAdmin: true` (lee
 * `TenantContext.get()?.platformAdmin`) — es un escape hatch para cruzar
 * FUERA de un contexto legítimo ya existente, no un mecanismo para crear uno
 * desde cero. Acá no hay ninguno que abrir primero.
 *
 * Alternativa descartada — exigir autenticación real (Bearer + claim
 * platformAdmin) en vez de esto: el caso de uso principal de /seed/users y
 * /seed/run es sembrar los PRIMEROS usuarios de un concesionario recién
 * provisionado, ANTES de que exista ningún usuario capaz de autenticarse
 * contra ese tenant. Exigir un token bloquearía exactamente el escenario
 * que el seeder existe para resolver (huevo y gallina: no podés pedir un
 * token de un tenant cuyos usuarios todavía no existen). El `secretKey`
 * compartido sigue siendo el único gate del endpoint — sin cambio de
 * comportamiento en ese punto. Ver seed.controller.ts para el detalle de
 * qué se reforzó (y qué NO) alrededor de ese gate.
 *
 * La solución adoptada: `tenantId` llega EXPLÍCITO en el payload/query de
 * cada endpoint que escribe en Firestore. Es la ÚNICA excepción real en
 * todo el sistema a "el tenantId nunca sale del payload" (D-102) — y es
 * deliberada: acá no hay ningún actor autenticado del que derivarlo, así
 * que la alternativa sería no poder invocar el seeder en absoluto. Se
 * documenta acá, en los DTOs del controller y en el eslint.config.mjs
 * (`src/modules/seed/**` ya figura en la lista de excepciones de
 * `runAsPlatform`/acceso directo — ver D-106) porque esto es scaffolding de
 * plataforma, no una operación de negocio de un tenant.
 *
 * Con ese `tenantId` explícito ya validado (ver `runSeedPlatformOperation`
 * más abajo), se abre el contexto A MANO — el mismo trabajo que hace
 * `TenantContextInterceptor` para una request real, solo que acá no hay
 * ninguna request autenticada de la que derivarlo — con `platformAdmin:
 * true` (es una operación de plataforma por definición, no un claim que se
 * le esté otorgando a un usuario) y, a partir de ahí, SÍ se llama a
 * `runAsPlatform()`. Esto no es cosmético: obliga a que cada corrida traiga
 * un motivo explícito y deja el registro en `audit_logs` del tenant
 * sembrado, con el mismo formato (`PLATFORM_SCOPE_ESCALATION`) que
 * cualquier otra escalada de plataforma del sistema — así una corrida de
 * seed queda con el mismo rastro de auditoría que cualquier otro acceso
 * cross-tenant, en vez de ser un camino especial sin traza. Ver
 * docs/design/01-multi-tenancy.md D-102, D-106.
 */
export async function runSeedPlatformOperation<T>(
  params: {
    /** tenantId explícito del payload/query — ver el comentario de arriba. */
    tenantId: string | undefined | null;
    /** Motivo de la escalada, exigido y auditado por runAsPlatform(). */
    reason: string;
    tenants: TenantsService;
    audit: AuditService;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) {
    throw new BadRequestException(
      'tenantId es obligatorio para operaciones de seed: el seeder no tiene ' +
        'un usuario autenticado del que derivarlo, así que no existe ningún ' +
        'contexto de tenant implícito posible. Ver seed-platform-context.ts.',
    );
  }

  // El seed no provisiona tenants — solo los puebla. Un tenantId que no
  // existe es casi siempre un typo del desarrollador; fallar rápido acá
  // evita escribir datos "fantasma" bajo un tenantId que nadie va a poder
  // consultar nunca (ninguna query real podría alcanzarlos sin el tenant).
  const tenant = await params.tenants.findById(tenantId);
  if (!tenant) {
    throw new BadRequestException(
      `No existe el concesionario '${tenantId}'. El seed no crea tenants — ` +
        'provisionalo primero y volvé a intentar.',
    );
  }

  // A propósito NO se exige tenant.status === ACTIVE acá: el caso principal
  // de uso es poblar un concesionario recién provisionado, que típicamente
  // arranca en PENDING hasta que el runbook de despliegue lo activa (ver
  // docs/design/06-runbook-migracion.md). Exigir ACTIVE bloquearía sembrar
  // datos de setup/testing antes de ese último paso.

  const syntheticContext: TenantContextData = {
    tenantId,
    userId: 'seed-system',
    role: RoleEnum.SOPORTE,
    establishmentIds: [],
    platformAdmin: true,
    requestId: randomUUID(),
  };

  return TenantContext.run(syntheticContext, () =>
    runAsPlatform(params.reason, params.audit, operation),
  );
}
