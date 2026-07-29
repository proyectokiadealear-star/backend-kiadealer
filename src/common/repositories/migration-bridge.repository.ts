import { Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Base de los accesores puente entre un módulo migrado y una colección de
 * otro módulo que todavía NO migró.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Un módulo migrado que necesita leer o escribir la colección de un módulo
 * hermano sin migrar no puede usar TenantScopedRepository: los documentos de
 * esa colección aún no tienen `tenantId`, así que la comparación de
 * pertenencia sería `undefined !== ctx.tenantId` y TODO devolvería `null`.
 * El fallo cerrado rompería el negocio en vez de protegerlo.
 *
 * ── Qué garantiza ─────────────────────────────────────────────────────────
 * NO es un acceso sin filtrar. Aplica scope cuando el documento YA tiene
 * `tenantId`, y solo tolera su ausencia — el caso pre-migración. Un documento
 * de OTRO concesionario nunca es accesible.
 *
 * La tolerancia vive acá, en un artefacto temporal y acotado, y jamás en
 * TenantScopedRepository: el primitivo de aislamiento se mantiene estricto.
 *
 * ── Deuda con fecha de vencimiento ────────────────────────────────────────
 * Cada subclase debe borrarse cuando su módulo destino migre. Si el paso 2
 * del runbook (asignación de `tenantId` a los datos) ya corrió, la rama de
 * tolerancia queda muerta y el warning deja de emitirse — esa es la señal de
 * que el puente sobra.
 *
 * Ver docs/design/06-runbook-migracion.md y docs/design/01-multi-tenancy.md D-105.
 */
export abstract class MigrationBridgeRepository {
  /** Colección del módulo aún no migrado. */
  protected abstract readonly collectionName: string;

  /** Módulo cuya migración vuelve innecesario este puente. */
  protected abstract readonly supersededBy: string;

  private readonly bridgeLogger = new Logger(MigrationBridgeRepository.name);

  constructor(protected readonly firebase: FirebaseService) {}

  protected collection() {
    return this.firebase.rawFirestore().collection(this.collectionName);
  }

  /**
   * Devuelve los datos del documento si es accesible desde el concesionario
   * activo, o `null` si no existe o pertenece a otro.
   */
  protected async readAccessible(
    documentId: string,
  ): Promise<Record<string, unknown> | null> {
    const snapshot = await this.collection().doc(documentId).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    if (!data) return null;

    return this.isAccessible(documentId, data) ? data : null;
  }

  /**
   * `true` si el documento es del concesionario activo o si todavía no está
   * etiquetado (pre-migración). `false` si pertenece a otro concesionario.
   */
  protected isAccessible(
    documentId: string,
    data: Record<string, unknown>,
  ): boolean {
    const { tenantId } = TenantContext.getOrThrow();
    const documentTenantId = data.tenantId as string | undefined;

    if (documentTenantId === undefined) {
      this.bridgeLogger.warn(
        `${this.collectionName}/${documentId} sin tenantId — documento ` +
          `pre-migración. Correr el paso 2 del runbook; este puente sobra ` +
          `cuando migre ${this.supersededBy}.`,
      );
      return true;
    }

    return documentTenantId === tenantId;
  }

  /**
   * Actualiza el documento solo si es accesible. Devuelve `false` si no lo
   * es, para que el llamador pueda distinguir "no aplicado" de "aplicado".
   */
  protected async updateIfAccessible(
    documentId: string,
    changes: Record<string, unknown>,
  ): Promise<boolean> {
    const data = await this.readAccessible(documentId);
    if (!data) return false;

    await this.collection().doc(documentId).update(changes);
    return true;
  }
}
