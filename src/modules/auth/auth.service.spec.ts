import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { RefreshTokenService } from './refresh-token.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { TenantContext } from '../../common/tenant/tenant-context';

// ---------------------------------------------------------------------------
// No existía suite dedicada para AuthService antes de esta migración — se
// agrega acá junto con la migración a AuthRepository. Cubre login() y
// forgotPassword(), con foco en el caso que justifica que este módulo NO use
// TenantScopedRepository: login() debe funcionar sin ningún TenantContext
// abierto.
// ---------------------------------------------------------------------------

const mockAuthRepository = {
  findUserProfileById: jest.fn(),
  findUserByEmail: jest.fn(),
};

const mockRefreshTokenService = {
  createToken: jest.fn(),
  exchangeToken: jest.fn(),
  revokeToken: jest.fn(),
  revokeAllForUser: jest.fn(),
};

const mockAuth = {
  verifyIdToken: jest.fn(),
};

const mockFirebaseService = {
  auth: jest.fn().mockReturnValue(mockAuth),
};

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue('test-api-key'),
};

global.fetch = jest.fn();

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFirebaseService.auth.mockReturnValue(mockAuth);
    mockConfigService.getOrThrow.mockReturnValue('test-api-key');
    mockRefreshTokenService.createToken.mockResolvedValue(
      'opaque-refresh-token',
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: mockAuthRepository },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
        { provide: FirebaseService, useValue: mockFirebaseService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login()', () => {
    const mockSuccessfulSignIn = () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => ({
          idToken: 'firebase-id-token',
          email: 'user@kia.com',
          refreshToken: 'firebase-refresh-token',
          expiresIn: '3600',
          localId: 'uid-1',
        }),
      });
    };

    // -----------------------------------------------------------------------
    // TEST: login() funciona SIN TenantContext abierto
    //
    // Es la garantía central de la decisión de arquitectura: login() es la
    // request que autentica por primera vez, así que NUNCA hay un
    // TenantContext abierto en ese momento. Este test corre login() a
    // propósito fuera de TenantContext.run(...) — si AuthRepository
    // extendiera TenantScopedRepository, esto reventaría con
    // InternalServerErrorException en vez de devolver el login exitoso.
    // -----------------------------------------------------------------------
    it('login() funciona sin TenantContext abierto', async () => {
      expect(TenantContext.get()).toBeUndefined();

      mockSuccessfulSignIn();
      mockAuth.verifyIdToken.mockResolvedValue({
        uid: 'uid-1',
        email: 'user@kia.com',
        active: true,
        role: 'ASESOR',
        sede: 'SURMOTOR',
        tenantId: 'kia-quito',
      });
      mockAuthRepository.findUserProfileById.mockResolvedValue({
        displayName: 'Usuario de Prueba',
      });

      const result = await service.login({
        email: 'user@kia.com',
        password: '123456',
      });

      expect(result.idToken).toBe('firebase-id-token');
      expect(result.refreshToken).toBe('opaque-refresh-token');
      expect(result.user.uid).toBe('uid-1');
      expect(mockAuthRepository.findUserProfileById).toHaveBeenCalledWith(
        'uid-1',
      );
    });

    it('login() pasa el tenantId de la claim verificada a createToken, no uno del cliente', async () => {
      mockSuccessfulSignIn();
      mockAuth.verifyIdToken.mockResolvedValue({
        uid: 'uid-1',
        email: 'user@kia.com',
        active: true,
        role: 'ASESOR',
        sede: 'SURMOTOR',
        tenantId: 'kia-quito',
      });
      mockAuthRepository.findUserProfileById.mockResolvedValue(null);

      await service.login({ email: 'user@kia.com', password: '123456' });

      expect(mockRefreshTokenService.createToken).toHaveBeenCalledWith(
        'uid-1',
        'firebase-refresh-token',
        'kia-quito',
      );
    });

    it('login() lanza UnauthorizedException si Firebase Auth rechaza las credenciales', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }),
      });

      await expect(
        service.login({ email: 'user@kia.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('login() lanza UnauthorizedException si el usuario está inactivo', async () => {
      mockSuccessfulSignIn();
      mockAuth.verifyIdToken.mockResolvedValue({
        uid: 'uid-1',
        email: 'user@kia.com',
        active: false,
      });

      await expect(
        service.login({ email: 'user@kia.com', password: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword()', () => {
    it('devuelve el mensaje genérico sin llamar a Firebase si el email no existe', async () => {
      mockAuthRepository.findUserByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'nadie@kia.com' });

      expect(result.message).toContain('Si el correo está registrado');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('devuelve el mensaje genérico sin llamar a Firebase si el usuario está inactivo', async () => {
      mockAuthRepository.findUserByEmail.mockResolvedValue({ active: false });

      const result = await service.forgotPassword({
        email: 'inactivo@kia.com',
      });

      expect(result.message).toContain('Si el correo está registrado');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('envía el correo de reset cuando el usuario existe y está activo', async () => {
      mockAuthRepository.findUserByEmail.mockResolvedValue({ active: true });
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await service.forgotPassword({ email: 'activo@kia.com' });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result.message).toContain('Si el correo está registrado');
    });
  });
});
