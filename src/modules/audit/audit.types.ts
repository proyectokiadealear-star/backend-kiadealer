import { RoleEnum } from '../../common/enums/role.enum';

export const AUDIT_LOGS_COLLECTION = 'audit_logs';
export const AUDIT_HEADS_COLLECTION = 'audit_heads';

/**
 * Hash inicial de toda cadena. Una entrada con este `prevHash` es, por
 * definición, la primera de su concesionario — el verificador lo usa para
 * distinguir "inicio de cadena" de "eslabón faltante".
 */
export const GENESIS_HASH = '0'.repeat(64);

/** Acciones auditadas. Se extiende a medida que migran los módulos. */
export enum AuditAction {
  VEHICLE_STATUS_CHANGED = 'VEHICLE_STATUS_CHANGED',
  CROSS_TENANT_ACCESS_ATTEMPT = 'CROSS_TENANT_ACCESS_ATTEMPT',
  PLATFORM_SCOPE_ESCALATION = 'PLATFORM_SCOPE_ESCALATION',
  IMPORT_EXECUTED = 'IMPORT_EXECUTED',
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
}

/** Valor de un campo con datos personales: se guarda la huella, no el dato. */
export interface RedactedValue {
  redacted: true;
  fingerprint: string;
}

export type AuditPayload = Record<string, unknown>;

export interface AuditEntryInput {
  action: AuditAction | string;
  entity: string;
  entityId: string;
  before?: AuditPayload;
  after?: AuditPayload;
  metadata?: AuditPayload;
}

export interface AuditEntry extends AuditEntryInput {
  id?: string;
  tenantId: string;
  actorUid: string;
  actorRole: RoleEnum;
  requestId: string;
  at: string;
  prevHash: string;
  hash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  entriesChecked: number;
  /** Índice (base 1) del primer eslabón roto. Ausente si la cadena es válida. */
  brokenAtPosition?: number;
  reason?: 'HASH_MISMATCH' | 'BROKEN_LINK' | 'BAD_GENESIS';
}
