import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (admin.apps.length > 0) {
      this.app = admin.app();
      return;
    }

    const projectId = this.config.getOrThrow<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.getOrThrow<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config
      .getOrThrow<string>('FIREBASE_PRIVATE_KEY')
      .replace(/\\n/g, '\n');
    const storageBucket = this.config.getOrThrow<string>('FIREBASE_STORAGE_BUCKET');

    this.app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      storageBucket,
    });

    this.logger.log(`Firebase Admin inicializado — proyecto: ${projectId}`);
    this.logger.log(`  → clientEmail: ${clientEmail}`);
    this.logger.log(`  → storageBucket: ${storageBucket}`);

    // Verificación rápida de conectividad con Firestore
    this.app.firestore().listCollections()
      .then((cols) => this.logger.log(`  → Firestore OK — colecciones: ${cols.length}`))
      .catch((err) => this.logger.error(`  → Firestore ERROR: ${err.message} (code: ${err.code})`));
  }

  auth(): admin.auth.Auth {
    return this.app.auth();
  }

  firestore(): admin.firestore.Firestore {
    return this.app.firestore();
  }

  storage(): admin.storage.Storage {
    return this.app.storage();
  }

  messaging(): admin.messaging.Messaging {
    return this.app.messaging();
  }

  get bucket() {
    return this.storage().bucket();
  }

  /**
   * Retorna la URL de descarga permanente del archivo usando el download token
   * embebido en los metadatos.  NO requiere el rol IAM "Token Creator".
   * Si por alguna razón el token no existe (archivo subido antes de esta versión),
   * genera una URL firmada como fallback.
   */
  async getSignedUrl(storagePath: string): Promise<string> {
    const file = this.bucket.file(storagePath);
    const [metadata] = await file.getMetadata();
    const token = metadata.metadata?.firebaseStorageDownloadTokens as string | undefined;

    if (token) {
      const encoded = encodeURIComponent(storagePath);
      return `https://firebasestorage.googleapis.com/v0/b/${this.bucket.name}/o/${encoded}?alt=media&token=${token}`;
    }

    // Fallback (requiere Token Creator IAM) — solo para archivos legacy
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 año
    });
    return url;
  }

  /**
   * Sube un buffer a Firebase Storage.
   * Embebe un firebaseStorageDownloadTokens en los metadatos para que
   * getSignedUrl() pueda construir la URL sin permisos IAM adicionales.
   */
  async uploadBuffer(
    buffer: Buffer,
    storagePath: string,
    contentType: string,
  ): Promise<string> {
    const file = this.bucket.file(storagePath);
    const downloadToken = uuidv4();
    await file.save(buffer, {
      metadata: {
        contentType,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
    return storagePath;
  }

  /** Elimina un archivo de Firebase Storage (silencioso si no existe) */
  async deleteFile(storagePath: string): Promise<void> {
    try {
      await this.bucket.file(storagePath).delete();
    } catch {
      // Ignorar si el archivo ya no existe
    }
  }

  serverTimestamp(): admin.firestore.FieldValue {
    return admin.firestore.FieldValue.serverTimestamp();
  }
}
