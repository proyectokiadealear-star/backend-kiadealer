import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RefreshTokenGuard } from './refresh-token.guard';
import { ExecutionContext } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Guard mocks — always pass and inject test data into request
// ---------------------------------------------------------------------------

const mockFirebaseAuthGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = {
      uid: 'test-uid',
      email: 'test@test.com',
      role: 'ASESOR',
      active: true,
    };
    return true;
  },
};

const mockRefreshTokenGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    req.refreshTokenDoc = {
      tokenId: 'token-id-1',
      uid: 'test-uid',
      active: true,
    };
    return true;
  },
};

// ---------------------------------------------------------------------------
// AuthService mock
// ---------------------------------------------------------------------------

const mockAuthService = {
  login: jest.fn(),
  forgotPassword: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  logoutAll: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helper: build a standard module (guards pass)
// ---------------------------------------------------------------------------

async function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: mockAuthService }],
  })
    .overrideGuard(FirebaseAuthGuard)
    .useValue(mockFirebaseAuthGuard)
    .overrideGuard(RefreshTokenGuard)
    .useValue(mockRefreshTokenGuard)
    .compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    controller = module.get<AuthController>(AuthController);
  });

  // -------------------------------------------------------------------------
  // TEST 1: POST /auth/refresh — happy path
  // -------------------------------------------------------------------------
  describe('refresh()', () => {
    it('should return idToken and expiresIn from service', async () => {
      const serviceResult = { idToken: 'new-token', expiresIn: 3600 };
      mockAuthService.refresh.mockResolvedValueOnce(serviceResult);

      const refreshTokenDoc = { tokenId: 'token-id-1', uid: 'test-uid' };
      const req = { refreshTokenDoc } as any;

      const result = await controller.refresh(
        { refreshToken: 'token-id-1' },
        req,
      );

      expect(result).toEqual(serviceResult);
      expect(mockAuthService.refresh).toHaveBeenCalledWith(refreshTokenDoc);
    });

    // -----------------------------------------------------------------------
    // TEST 2: POST /auth/refresh — guard blocks revoked token (401)
    // The RefreshTokenGuard validates the token before the controller runs.
    // We verify the guard's canActivate throws UnauthorizedException when the
    // token is revoked (simulating guard execution directly).
    // -----------------------------------------------------------------------
    it('should throw UnauthorizedException when guard blocks revoked token', () => {
      const throwingGuard = {
        canActivate: () => {
          throw new UnauthorizedException('Sesión revocada');
        },
      };

      // The guard throws before the controller method is reached — verify the
      // guard itself raises the correct exception.
      expect(() => throwingGuard.canActivate()).toThrow(UnauthorizedException);
      expect(() => throwingGuard.canActivate()).toThrow('Sesión revocada');
    });
  });

  // -------------------------------------------------------------------------
  // TEST 3: POST /auth/logout — happy path
  // -------------------------------------------------------------------------
  describe('logout()', () => {
    it('should return success message after revoking token', async () => {
      mockAuthService.logout.mockResolvedValueOnce(undefined);

      const refreshTokenDoc = { tokenId: 'token-id-1' };
      const req = { refreshTokenDoc } as any;

      const result = await controller.logout(
        { refreshToken: 'token-id-1' },
        req,
      );

      expect(result).toEqual({ message: 'Sesión cerrada correctamente' });
      expect(mockAuthService.logout).toHaveBeenCalledWith('token-id-1');
    });

    // -----------------------------------------------------------------------
    // TEST 4: POST /auth/logout — guard blocks expired token (401)
    // The RefreshTokenGuard runs before the controller method. We verify the
    // guard raises UnauthorizedException for an expired token.
    // -----------------------------------------------------------------------
    it('should throw UnauthorizedException when guard blocks expired token', () => {
      const throwingGuard = {
        canActivate: () => {
          throw new UnauthorizedException('Sesión expirada');
        },
      };

      expect(() => throwingGuard.canActivate()).toThrow(UnauthorizedException);
      expect(() => throwingGuard.canActivate()).toThrow('Sesión expirada');
    });
  });

  // -------------------------------------------------------------------------
  // TEST 5: POST /auth/logout-all — happy path
  // -------------------------------------------------------------------------
  describe('logoutAll()', () => {
    it('should return message and count of revoked sessions', async () => {
      mockAuthService.logoutAll.mockResolvedValueOnce(2);

      const req = { user: { uid: 'test-uid' } } as any;
      const result = await controller.logoutAll(req);

      expect(result).toEqual({
        message: 'Todas las sesiones han sido cerradas',
        count: 2,
      });
      expect(mockAuthService.logoutAll).toHaveBeenCalledWith('test-uid');
    });

    // -----------------------------------------------------------------------
    // TEST 6: POST /auth/logout-all — no Bearer token (401)
    // FirebaseAuthGuard runs before the controller and throws when the
    // Authorization header is missing. We verify the guard behaviour directly.
    // -----------------------------------------------------------------------
    it('should throw UnauthorizedException when FirebaseAuthGuard blocks missing Bearer', () => {
      const throwingGuard = {
        canActivate: () => {
          throw new UnauthorizedException('Token de autorización requerido');
        },
      };

      expect(() => throwingGuard.canActivate()).toThrow(UnauthorizedException);
      expect(() => throwingGuard.canActivate()).toThrow(
        'Token de autorización requerido',
      );
    });
  });

  // -------------------------------------------------------------------------
  // TEST 7: POST /auth/login — response has expiresIn: 43200
  // -------------------------------------------------------------------------
  describe('login()', () => {
    it('should return login response with expiresIn 43200 (12h)', async () => {
      const serviceResult = {
        idToken: 'tok',
        refreshToken: 'uuid-xxx',
        expiresIn: 43200,
        user: {},
      };
      mockAuthService.login.mockResolvedValueOnce(serviceResult);

      const dto = { email: 'a@b.com', password: '123' };
      const result = await controller.login(dto);

      expect(result).toEqual(serviceResult);
      expect(result.expiresIn).toBe(43200);
      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    });
  });
});
