import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../firebase/firebase.service';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import {
  RefreshTokenDocument,
  RefreshTokenRepository,
} from './refresh-token.repository';

export type { RefreshTokenDocument } from './refresh-token.repository';

interface FirebaseTokenResponse {
  id_token: string;
  expires_in: string;
}

interface FirebaseTokenError {
  error: { message: string };
}

/**
 * ── Decisión de arquitectura: por qué este módulo NO usa TenantScopedRepository ──
 *
 * Este servicio es el caso aislado del resto de la migración a multi-tenant
 * (ver docs/design/01-multi-tenancy.md y docs/design/06-runbook-migracion.md).
 * `/auth/refresh` es, por definición, el endpoint que se llama cuando el
 * idToken ya venció: en esa request no hay `req.user`, no corrió
 * `FirebaseAuthGuard`, no corrió `TenantGuard` y no hay `TenantContext`
 * abierto (`TenantContext.getOrThrow()` reventaría siempre). Forzar el uso
 * de TenantScopedRepository acá no sería "más seguro": rompería el refresh
 * para el 100% de los usuarios, todo el tiempo, porque el fallo cerrado que
 * protege al resto de la app no tiene ningún contexto del cual leer.
 *
 * El acceso a Firestore vive en RefreshTokenRepository (acceso crudo vía
 * `rawFirestore()`, documentado ahí). El aislamiento entre concesionarios en
 * este flujo no se logra con `where('tenantId', ...)` — se logra así:
 *
 *  1. El tokenId es un secreto opaco (UUID v4) ligado 1:1 a un `uid` en el
 *     momento de creación. No hay operación de listado: todo lookup es por
 *     ese secreto o por el `uid` ya resuelto del documento encontrado, nunca
 *     por un valor que el cliente pueda inventar para "cruzar" de usuario.
 *  2. `RefreshTokenDocument.tenantId` guarda el tenantId del usuario al
 *     emitir el token (custom claim verificada, ver AuthService.login()).
 *     `exchangeToken()` lo compara contra la custom claim vigente al
 *     refrescar: si un usuario cambió de concesionario (o sus claims fueron
 *     alteradas) entre la emisión del token y su uso, la sesión vieja se
 *     revoca en vez de devolver un idToken para el tenant nuevo con un
 *     documento de sesión que quedó asociado al viejo.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly TTL_SECONDS = 43200; // 12h

  constructor(
    private readonly repository: RefreshTokenRepository,
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a new refresh token document in Firestore.
   * Returns the opaque tokenId (UUID v4) to be sent to the client.
   *
   * `tenantId` es opcional porque durante la transición de la migración
   * (antes de re-emitir custom claims, ver runbook paso 4) un usuario puede
   * autenticarse sin ese claim todavía. El documento queda sin `tenantId` y
   * la validación de coherencia en `exchangeToken()` simplemente no aplica
   * para ese token — es aditivo, no bloqueante.
   */
  async createToken(
    uid: string,
    firebaseRefreshToken: string,
    tenantId?: string,
  ): Promise<string> {
    const tokenId = uuidv4();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + this.TTL_SECONDS * 1000,
    );

    const doc: RefreshTokenDocument = {
      tokenId,
      uid,
      firebaseRefreshToken,
      active: true,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      ...(tenantId ? { tenantId } : {}),
    };

    await this.repository.save(doc);

    this.logger.log(`Refresh token creado para uid=${uid}`);
    return tokenId;
  }

  /**
   * Validates a refresh token.
   * Throws UnauthorizedException if invalid, revoked, or expired.
   * Returns the full RefreshTokenDocument on success.
   */
  async validateToken(tokenId: string): Promise<RefreshTokenDocument> {
    const doc = await this.repository.findById(tokenId);

    if (!doc) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (!doc.active) {
      throw new UnauthorizedException('Sesión revocada');
    }

    const now = admin.firestore.Timestamp.now();
    if (doc.expiresAt.toMillis() < now.toMillis()) {
      throw new UnauthorizedException('Sesión expirada');
    }

    return doc;
  }

  /**
   * Exchanges the stored Firebase refresh token for a new idToken.
   * Updates lastUsedAt on success.
   * Returns { idToken, expiresIn }.
   */
  async exchangeToken(
    doc: RefreshTokenDocument,
  ): Promise<{ idToken: string; expiresIn: number }> {
    const apiKey = this.config.getOrThrow<string>('FIREBASE_WEB_API_KEY');
    const url = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: doc.firebaseRefreshToken,
        }),
      });
    } catch (err) {
      this.logger.error(
        `Error de red al renovar token Firebase: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException('No se pudo renovar la sesión');
    }

    if (!res.ok) {
      const json = (await res.json()) as FirebaseTokenError;
      this.logger.warn(
        `Firebase securetoken error para uid=${doc.uid}: ${json.error?.message ?? 'UNKNOWN'}`,
      );
      throw new UnauthorizedException('No se pudo renovar la sesión');
    }

    const json = (await res.json()) as FirebaseTokenResponse;
    const newIdToken = json.id_token;

    // Re-verify user is still active in Firebase
    const decoded = await this.firebase.auth().verifyIdToken(newIdToken);
    if (!decoded.active) {
      throw new ForbiddenException(
        'Usuario inactivo. Contacte al administrador.',
      );
    }

    // Coherencia de tenant — ver docblock de la clase. Solo aplica cuando
    // AMBOS lados tienen el dato: un token viejo sin `tenantId` (pre-remint
    // de claims) no se bloquea por esto, y una claim todavía sin tenantId
    // tampoco — esos casos ya los rechaza TenantGuard más adelante en la
    // cadena, con el código correcto (401, no acá).
    const claimTenantId = decoded.tenantId as string | undefined;
    if (doc.tenantId && claimTenantId && doc.tenantId !== claimTenantId) {
      await this.repository.revoke(
        doc.tokenId,
        admin.firestore.Timestamp.now(),
      );
      this.logger.warn(
        `Incoherencia de tenant al refrescar uid=${doc.uid}: token emitido para ` +
          `tenantId=${doc.tenantId}, claim actual tenantId=${claimTenantId}. Sesión revocada.`,
      );
      throw new ForbiddenException(
        'La sesión ya no es válida. Volvé a iniciar sesión.',
      );
    }

    // Update lastUsedAt
    await this.repository.updateLastUsed(
      doc.tokenId,
      admin.firestore.Timestamp.now(),
    );

    this.logger.log(`Token renovado para uid=${doc.uid}`);
    return {
      idToken: newIdToken,
      expiresIn: Number(json.expires_in),
    };
  }

  /**
   * Revokes a single refresh token by setting active=false.
   * Throws NotFoundException if the document does not exist.
   */
  async revokeToken(tokenId: string): Promise<void> {
    const doc = await this.repository.findById(tokenId);

    if (!doc) {
      throw new NotFoundException('Sesión no encontrada');
    }

    if (!doc.active) return; // already revoked — idempotent no-op

    await this.repository.revoke(tokenId, admin.firestore.Timestamp.now());
    this.logger.log(`Token revocado: ${tokenId}`);
  }

  /**
   * Revokes all active sessions for a given uid.
   * Also calls Firebase Auth revokeRefreshTokens to invalidate all Firebase tokens.
   * Returns the number of sessions revoked.
   */
  async revokeAllForUser(uid: string): Promise<number> {
    const activeDocs = await this.repository.findActiveByUid(uid);

    if (activeDocs.length > 0) {
      const revokedAt = admin.firestore.Timestamp.now();
      await this.repository.revokeMany(
        activeDocs.map((d) => d.tokenId),
        revokedAt,
      );
    }

    await this.firebase.auth().revokeRefreshTokens(uid);

    const count = activeDocs.length;
    this.logger.log(`${count} sesión(es) revocadas para uid=${uid}`);
    return count;
  }
}
