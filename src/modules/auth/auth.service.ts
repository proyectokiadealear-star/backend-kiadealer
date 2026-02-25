import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../firebase/firebase.service';
import { LoginDto } from './dto/login.dto';

interface FirebaseSignInResponse {
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
}

interface FirebaseSignInError {
  error: { message: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const apiKey = this.config.getOrThrow<string>('FIREBASE_WEB_API_KEY');
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

    // 1. Autenticar con Firebase Auth REST API
    let signInData: FirebaseSignInResponse;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: dto.email,
          password: dto.password,
          returnSecureToken: true,
        }),
      });

      const json = (await res.json()) as FirebaseSignInResponse | FirebaseSignInError;

      if (!res.ok) {
        const errorMsg = (json as FirebaseSignInError).error?.message ?? 'AUTH_ERROR';
        this.logger.warn(`Login fallido para ${dto.email}: ${errorMsg}`);
        throw new UnauthorizedException(this.mapFirebaseError(errorMsg));
      }

      signInData = json as FirebaseSignInResponse;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Error llamando a Firebase Auth REST API: ${(err as Error).message}`);
      throw new InternalServerErrorException('Error al conectar con el servicio de autenticación');
    }

    // 2. Verificar el token con Admin SDK para obtener custom claims
    const decoded = await this.firebase.auth().verifyIdToken(signInData.idToken);

    if (!decoded.active) {
      throw new UnauthorizedException('Usuario inactivo. Contacte al administrador.');
    }

    // 3. Obtener perfil de Firestore
    const userDoc = await this.firebase
      .firestore()
      .collection('users')
      .doc(decoded.uid)
      .get();

    const profile = userDoc.exists ? userDoc.data() : null;

    this.logger.log(`Login exitoso: ${decoded.uid} (${decoded.email})`);

    return {
      idToken: signInData.idToken,
      refreshToken: signInData.refreshToken,
      expiresIn: Number(signInData.expiresIn), // segundos
      user: {
        uid: decoded.uid,
        email: decoded.email,
        displayName: profile?.['displayName'] ?? decoded.name ?? '',
        role: decoded.role,
        sede: decoded.sede,
        active: decoded.active,
      },
    };
  }

  /** Traduce los códigos de error de Firebase a mensajes legibles */
  private mapFirebaseError(code: string): string {
    const map: Record<string, string> = {
      EMAIL_NOT_FOUND: 'No existe una cuenta con ese email.',
      INVALID_PASSWORD: 'Contraseña incorrecta.',
      INVALID_EMAIL: 'El email ingresado no es válido.',
      USER_DISABLED: 'Esta cuenta ha sido deshabilitada.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos fallidos. Intente más tarde.',
      INVALID_LOGIN_CREDENTIALS: 'Credenciales inválidas.',
    };
    return map[code] ?? 'Credenciales inválidas.';
  }
}
