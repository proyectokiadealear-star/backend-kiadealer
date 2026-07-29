import { ForbiddenException } from '@nestjs/common';
import { AuditService } from '../../modules/audit/audit.service';
import { TenantContext } from './tenant-context';

/**
 * Ejecuta una operación que legítimamente cruza concesionarios.
 *
 * Existe porque hay trabajo que sí necesita alcance de plataforma: provisionar
 * un concesionario nuevo, correr una migración, dar soporte. Sin una puerta
 * oficial y auditada, alguien va a saltear el repositorio "solo esta vez" y
 * esa excepción se vuelve permanente.
 *
 * Exige el claim `platformAdmin` y registra SIEMPRE el motivo en audit_logs.
 * Solo se puede invocar desde los directorios permitidos en la regla de
 * ESLint. Ver docs/design/01-multi-tenancy.md D-106.
 */
export async function runAsPlatform<T>(
  reason: string,
  audit: AuditService,
  operation: () => Promise<T>,
): Promise<T> {
  const context = TenantContext.get();

  if (!context?.platformAdmin) {
    throw new ForbiddenException(
      'Operación restringida a administradores de plataforma',
    );
  }

  if (!reason?.trim()) {
    throw new ForbiddenException(
      'runAsPlatform requiere un motivo: queda registrado en la auditoría',
    );
  }

  await audit.append({
    action: 'PLATFORM_SCOPE_ESCALATION',
    entity: 'platform',
    entityId: context.tenantId,
    metadata: { reason },
  });

  return operation();
}
