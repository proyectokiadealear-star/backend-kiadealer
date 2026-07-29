import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../firebase/firebase.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { AuthRepository } from './auth.repository';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import {
  RefreshTokenDocument,
  RefreshTokenService,
} from './refresh-token.service';

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
    private readonly refreshTokenService: RefreshTokenService,
    private readonly authRepository: AuthRepository,
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

      const json = (await res.json()) as
        | FirebaseSignInResponse
        | FirebaseSignInError;

      if (!res.ok) {
        const errorMsg =
          (json as FirebaseSignInError).error?.message ?? 'AUTH_ERROR';
        this.logger.warn(`Login fallido para ${dto.email}: ${errorMsg}`);
        throw new UnauthorizedException(this.mapFirebaseError(errorMsg));
      }

      signInData = json as FirebaseSignInResponse;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(
        `Error llamando a Firebase Auth REST API: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Error al conectar con el servicio de autenticación',
      );
    }

    // 2. Verificar el token con Admin SDK para obtener custom claims
    const decoded = await this.firebase
      .auth()
      .verifyIdToken(signInData.idToken);

    if (!decoded.active) {
      throw new UnauthorizedException(
        'Usuario inactivo. Contacte al administrador.',
      );
    }

    // 3. Obtener perfil de Firestore — vía AuthRepository, sin TenantContext
    // (ver docblock de AuthRepository: acá todavía no existe uno)
    const profile = await this.authRepository.findUserProfileById(decoded.uid);

    this.logger.log(`Login exitoso: ${decoded.uid} (${decoded.email})`);

    // El tenantId sale de la custom claim ya verificada por Admin SDK
    // (nunca del payload de la request) y queda guardado en el documento del
    // refresh token para poder validar coherencia al refrescar — ver
    // RefreshTokenService.exchangeToken().
    const customRefreshToken = await this.refreshTokenService.createToken(
      decoded.uid,
      signInData.refreshToken,
      decoded.tenantId as string | undefined,
    );

    return {
      idToken: signInData.idToken,
      refreshToken: customRefreshToken,
      expiresIn: 43200, // 12h en segundos
      user: {
        uid: decoded.uid,
        email: decoded.email,
        displayName:
          (profile?.['displayName'] as string | undefined) ??
          (decoded.name as string | undefined) ??
          '',
        role: decoded.role as RoleEnum,
        sede: decoded.sede as SedeEnum,
        active: decoded.active as boolean,
      },
    };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const apiKey = this.config.getOrThrow<string>('FIREBASE_WEB_API_KEY');
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;

    // Verificar que el usuario existe en Firestore antes de enviar el correo
    // — vía AuthRepository, sin TenantContext (ver docblock de la clase)
    const userDoc = await this.authRepository.findUserByEmail(dto.email);

    if (!userDoc) {
      // Respuesta genérica por seguridad (no revelar si el email existe o no)
      this.logger.warn(
        `Intento de reset para email no registrado: ${dto.email}`,
      );
      return {
        message:
          'Si el correo está registrado, recibirás un enlace de restablecimiento.',
      };
    }

    if (!userDoc['active']) {
      this.logger.warn(`Intento de reset para usuario inactivo: ${dto.email}`);
      return {
        message:
          'Si el correo está registrado, recibirás un enlace de restablecimiento.',
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email: dto.email,
      }),
    });

    if (!res.ok) {
      const json = (await res.json()) as { error?: { message?: string } };
      const errorCode = json.error?.message ?? 'UNKNOWN';
      this.logger.error(
        `Error enviando reset email a ${dto.email}: ${errorCode}`,
      );

      if (errorCode === 'EMAIL_NOT_FOUND') {
        // Por seguridad retornamos el mismo mensaje genérico
        return {
          message:
            'Si el correo está registrado, recibirás un enlace de restablecimiento.',
        };
      }

      throw new InternalServerErrorException(
        'No se pudo enviar el correo de restablecimiento. Intente más tarde.',
      );
    }

    this.logger.log(`📧 Correo de restablecimiento enviado a: ${dto.email}`);
    return {
      message:
        'Si el correo está registrado, recibirás un enlace de restablecimiento.',
    };
  }

  /** Renueva el idToken usando el refresh token almacenado */
  async refresh(
    doc: RefreshTokenDocument,
  ): Promise<{ idToken: string; expiresIn: number }> {
    return this.refreshTokenService.exchangeToken(doc);
  }

  /** Revoca una sesión individual */
  async logout(tokenId: string): Promise<void> {
    return this.refreshTokenService.revokeToken(tokenId);
  }

  /** Revoca todas las sesiones activas del usuario */
  async logoutAll(uid: string): Promise<number> {
    return this.refreshTokenService.revokeAllForUser(uid);
  }

  /** Traduce los códigos de error de Firebase a mensajes legibles */
  private mapFirebaseError(code: string): string {
    const map: Record<string, string> = {
      EMAIL_NOT_FOUND: 'No existe una cuenta con ese email.',
      INVALID_PASSWORD: 'Contraseña incorrecta.',
      INVALID_EMAIL: 'El email ingresado no es válido.',
      USER_DISABLED: 'Esta cuenta ha sido deshabilitada.',
      TOO_MANY_ATTEMPTS_TRY_LATER:
        'Demasiados intentos fallidos. Intente más tarde.',
      INVALID_LOGIN_CREDENTIALS: 'Credenciales inválidas.',
    };
    return map[code] ?? 'Credenciales inválidas.';
  }
}
