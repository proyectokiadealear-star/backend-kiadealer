import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import {
  AUDIT_HEADS_COLLECTION,
  AUDIT_LOGS_COLLECTION,
  AuditEntry,
  AuditEntryInput,
  ChainVerificationResult,
  GENESIS_HASH,
} from './audit.types';
import { computeEntryHash } from './hash-chain';
import { redactPii } from './field-redactor';

/**
 * Registro append-only de mutaciones de negocio.
 *
 * Expone `append()` y consultas de lectura. NO expone actualización ni
 * borrado: la ausencia de esos métodos es una de las capas de inmutabilidad
 * del diseño, junto con la cadena de hash y la regla de ESLint que prohíbe
 * tocar `audit_logs` fuera de este módulo.
 * Ver docs/design/02-auditoria.md D-201.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly firebase: FirebaseService) {}

  /**
   * Agrega una entrada a la cadena del concesionario activo.
   *
   * El avance del puntero de cabecera va en una transacción de Firestore: una
   * cadena de hash es secuencial por definición y el backend es concurrente,
   * así que dos escrituras simultáneas que leyeran el mismo `prevHash`
   * producirían una bifurcación. La cadena es POR TENANT, no global, para
   * acotar la contención al volumen de un solo concesionario.
   * Ver docs/design/02-auditoria.md D-205.
   */
  async append(input: AuditEntryInput): Promise<AuditEntry> {
    const context = TenantContext.getOrThrow();
    const firestore = this.firebase.rawFirestore();
    const headRef = firestore
      .collection(AUDIT_HEADS_COLLECTION)
      .doc(context.tenantId);
    const entryRef = firestore.collection(AUDIT_LOGS_COLLECTION).doc();

    return firestore.runTransaction(async (transaction) => {
      const headSnapshot = await transaction.get(headRef);
      const prevHash = headSnapshot.exists
        ? (headSnapshot.data()?.hash as string)
        : GENESIS_HASH;

      const before = redactPii(input.before);
      const after = redactPii(input.after);
      const metadata = redactPii(input.metadata);

      // Los campos ausentes se omiten en vez de escribirse como `undefined`:
      // Firestore rechaza undefined como valor. `canonicalize` ya ignora las
      // claves undefined, así que omitirlas no altera el hash.
      const entry: Omit<AuditEntry, 'id' | 'hash'> = {
        tenantId: context.tenantId,
        actorUid: context.userId,
        actorRole: context.role,
        requestId: context.requestId,
        at: new Date().toISOString(),
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        prevHash,
        ...(before !== undefined && { before }),
        ...(after !== undefined && { after }),
        ...(metadata !== undefined && { metadata }),
      };

      const hash = computeEntryHash(entry);
      const stored: AuditEntry = { ...entry, hash };

      transaction.set(entryRef, stored);
      transaction.set(headRef, { hash, updatedAt: stored.at });

      return { ...stored, id: entryRef.id };
    });
  }

  /**
   * Registra un intento de acceso a datos de otro concesionario.
   *
   * Queda en la cadena del tenant REAL del token, no en la del dueño del
   * recurso: es el atacante quien queda registrado, no la víctima.
   */
  async recordCrossTenantAttempt(params: {
    collection: string;
    documentId: string;
    ownerTenantId: string;
  }): Promise<void> {
    const context = TenantContext.getOrThrow();
    this.logger.warn(
      `Acceso entre concesionarios bloqueado — tenant ${context.tenantId} ` +
        `intentó leer ${params.collection}/${params.documentId} de ${params.ownerTenantId}`,
    );

    await this.append({
      action: 'CROSS_TENANT_ACCESS_ATTEMPT',
      entity: params.collection,
      entityId: params.documentId,
      metadata: { ownerTenantId: params.ownerTenantId },
    });
  }

  /** Entradas de un concesionario, de la más antigua a la más reciente. */
  async listChain(tenantId: string): Promise<AuditEntry[]> {
    const snapshot = await this.firebase
      .rawFirestore()
      .collection(AUDIT_LOGS_COLLECTION)
      .where('tenantId', '==', tenantId)
      .orderBy('at', 'asc')
      .get();

    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as AuditEntry,
    );
  }

  /**
   * Recalcula la cadena y reporta la primera posición rota.
   *
   * Detecta tanto la alteración del contenido de una entrada (el hash deja de
   * corresponder) como la desaparición de una entrada intermedia (el
   * `prevHash` de la siguiente ya no apunta a nada).
   */
  async verifyChain(tenantId: string): Promise<ChainVerificationResult> {
    const entries = await this.listChain(tenantId);

    let expectedPrevHash = GENESIS_HASH;

    for (const [index, entry] of entries.entries()) {
      const position = index + 1;

      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          entriesChecked: entries.length,
          brokenAtPosition: position,
          reason: position === 1 ? 'BAD_GENESIS' : 'BROKEN_LINK',
        };
      }

      const { id: _id, hash: storedHash, ...hashable } = entry;
      if (computeEntryHash(hashable) !== storedHash) {
        return {
          valid: false,
          entriesChecked: entries.length,
          brokenAtPosition: position,
          reason: 'HASH_MISMATCH',
        };
      }

      expectedPrevHash = storedHash;
    }

    return { valid: true, entriesChecked: entries.length };
  }
}
