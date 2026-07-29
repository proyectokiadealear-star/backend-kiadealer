import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';

export interface RefreshTokenDocument {
  tokenId: string;
  uid: string;
  firebaseRefreshToken: string; // NEVER returned to client
  active: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  lastUsedAt: FirebaseFirestore.Timestamp | null;
  userAgent?: string;
  /**
   * tenantId del usuario al momento en que se emitió el token (custom claim
   * verificado, no dato de cliente). Opcional a propósito: es un campo
   * aditivo — los documentos emitidos antes de este cambio no lo tienen y
   * siguen siendo válidos, no se re-emiten en masa. Se usa exclusivamente
   * para detectar incoherencia de tenant al refrescar. Ver
   * RefreshTokenService.exchangeToken().
   */
  tenantId?: string;
}

/**
 * Acceso a Firestore para refresh tokens propios (no confundir con el
 * refresh token de Firebase, que viaja adentro de este documento).
 *
 * ── Por qué NO extiende TenantScopedRepository ────────────────────────────
 *
 * 1. `POST /auth/refresh` se llama SIN idToken vigente — es literalmente el
 *    endpoint que existe para cuando el idToken ya expiró. No hay
 *    `req.user`, no corrió `FirebaseAuthGuard` ni `TenantGuard`, no hay
 *    `TenantContext` abierto. Igual que en AuthRepository: heredar de
 *    TenantScopedRepository haría que `getOrThrow()` reviente esta request
 *    siempre, rompiendo el refresh para todos los usuarios.
 *
 * 2. La búsqueda no es "dame los documentos de mi tenant": es "dame el
 *    documento de ESTE tokenId" (un secreto opaco tipo UUID v4) o "dame los
 *    documentos activos de ESTE uid". Ninguna de las dos es una consulta de
 *    listado con scope de tenant — son lookups puntuales por una clave que
 *    ya identifica a un usuario concreto.
 *
 * El aislamiento entre concesionarios NO depende de un
 * `where('tenantId', ...)` acá. Depende de que:
 *   - El tokenId es un UUID v4 aleatorio ligado 1:1 a un `uid` en el momento
 *     de creación — no hay forma de enumerarlo o adivinar el de otro
 *     usuario, y por lo tanto tampoco el de otro concesionario.
 *   - `revokeAllForUser` y `validateToken` siempre operan sobre el `uid` ya
 *     resuelto del documento, nunca sobre un `uid` que mande el cliente.
 *   - La coherencia de tenant (¿el usuario sigue perteneciendo al mismo
 *     concesionario que cuando se emitió el token?) se valida aparte, en
 *     RefreshTokenService.exchangeToken(), comparando `tenantId` contra la
 *     custom claim vigente — ver ese método para el detalle.
 */
@Injectable()
export class RefreshTokenRepository {
  private readonly COLLECTION = 'refresh_tokens';

  constructor(private readonly firebase: FirebaseService) {}

  private collection() {
    return this.firebase.rawFirestore().collection(this.COLLECTION);
  }

  async save(doc: RefreshTokenDocument): Promise<void> {
    await this.collection().doc(doc.tokenId).set(doc);
  }

  async findById(tokenId: string): Promise<RefreshTokenDocument | null> {
    const snap = await this.collection().doc(tokenId).get();
    return snap.exists ? (snap.data() as RefreshTokenDocument) : null;
  }

  async updateLastUsed(
    tokenId: string,
    lastUsedAt: FirebaseFirestore.Timestamp,
  ): Promise<void> {
    await this.collection().doc(tokenId).update({ lastUsedAt });
  }

  async revoke(
    tokenId: string,
    revokedAt: FirebaseFirestore.Timestamp,
  ): Promise<void> {
    await this.collection().doc(tokenId).update({ active: false, revokedAt });
  }

  async findActiveByUid(uid: string): Promise<RefreshTokenDocument[]> {
    const snap = await this.collection()
      .where('uid', '==', uid)
      .where('active', '==', true)
      .get();

    return snap.docs.map((doc) => doc.data() as RefreshTokenDocument);
  }

  /** Revoca en batch — usado por revokeAllForUser() para cerrar todas las sesiones de un uid. */
  async revokeMany(
    tokenIds: string[],
    revokedAt: FirebaseFirestore.Timestamp,
  ): Promise<void> {
    if (tokenIds.length === 0) return;

    const collection = this.collection();
    const batch = this.firebase.rawFirestore().batch();
    tokenIds.forEach((id) => {
      batch.update(collection.doc(id), { active: false, revokedAt });
    });
    await batch.commit();
  }
}
