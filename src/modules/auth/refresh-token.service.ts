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

export interface RefreshTokenDocument {
  tokenId: string;
  uid: string;
  firebaseRefreshToken: string; // NEVER returned to client
  active: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  lastUsedAt: FirebaseFirestore.Timestamp | null;
  userAgent?: string;
}

interface FirebaseTokenResponse {
  id_token: string;
  expires_in: string;
}

interface FirebaseTokenError {
  error: { message: string };
}

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly COLLECTION = 'refresh_tokens';
  private readonly TTL_SECONDS = 43200; // 12h

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a new refresh token document in Firestore.
   * Returns the opaque tokenId (UUID v4) to be sent to the client.
   */
  async createToken(
    uid: string,
    firebaseRefreshToken: string,
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
    };

    await this.firebase
      .firestore()
      .collection(this.COLLECTION)
      .doc(tokenId)
      .set(doc);

    this.logger.log(`Refresh token creado para uid=${uid}`);
    return tokenId;
  }

  /**
   * Validates a refresh token.
   * Throws UnauthorizedException if invalid, revoked, or expired.
   * Returns the full RefreshTokenDocument on success.
   */
  async validateToken(tokenId: string): Promise<RefreshTokenDocument> {
    const snap = await this.firebase
      .firestore()
      .collection(this.COLLECTION)
      .doc(tokenId)
      .get();

    if (!snap.exists) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const doc = snap.data() as RefreshTokenDocument;

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

    // Update lastUsedAt
    await this.firebase
      .firestore()
      .collection(this.COLLECTION)
      .doc(doc.tokenId)
      .update({ lastUsedAt: admin.firestore.Timestamp.now() });

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
    const ref = this.firebase
      .firestore()
      .collection(this.COLLECTION)
      .doc(tokenId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new NotFoundException('Sesión no encontrada');
    }

    const data = snap.data() as RefreshTokenDocument;
    if (!data.active) return; // already revoked — idempotent no-op

    await ref.update({
      active: false,
      revokedAt: admin.firestore.Timestamp.now(),
    });
    this.logger.log(`Token revocado: ${tokenId}`);
  }

  /**
   * Revokes all active sessions for a given uid.
   * Also calls Firebase Auth revokeRefreshTokens to invalidate all Firebase tokens.
   * Returns the number of sessions revoked.
   */
  async revokeAllForUser(uid: string): Promise<number> {
    const snap = await this.firebase
      .firestore()
      .collection(this.COLLECTION)
      .where('uid', '==', uid)
      .where('active', '==', true)
      .get();

    if (!snap.empty) {
      const batch = this.firebase.firestore().batch();
      const revokedAt = admin.firestore.Timestamp.now();
      snap.docs.forEach((docSnap) => {
        batch.update(docSnap.ref, { active: false, revokedAt });
      });
      await batch.commit();
    }

    await this.firebase.auth().revokeRefreshTokens(uid);

    const count = snap.size;
    this.logger.log(`${count} sesión(es) revocadas para uid=${uid}`);
    return count;
  }
}
