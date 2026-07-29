import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenService } from './refresh-token.service';
import {
  RefreshTokenDocument,
  RefreshTokenRepository,
} from './refresh-token.repository';
import { FirebaseService } from '../../firebase/firebase.service';
import { TenantContext } from '../../common/tenant/tenant-context';

// ---------------------------------------------------------------------------
// RefreshTokenRepository mock — RefreshTokenService no toca Firestore
// directamente: todo el acceso pasa por el repositorio (ver refresh-token.
// repository.ts). Mockear el repositorio en vez de FirebaseService/Firestore
// es deliberado: el contrato que este spec valida es el del SERVICE (reglas
// de negocio: expiración, revocación, coherencia de tenant), no el de
// Firestore, que ya tiene su propio spec en refresh-token.repository.spec.ts.
// ---------------------------------------------------------------------------

const mockRepository = {
  save: jest.fn(),
  findById: jest.fn(),
  updateLastUsed: jest.fn(),
  revoke: jest.fn(),
  findActiveByUid: jest.fn(),
  revokeMany: jest.fn(),
};

const mockAuth = {
  revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
  verifyIdToken: jest.fn().mockResolvedValue({ active: true }),
};

const mockFirebaseService = {
  auth: jest.fn().mockReturnValue(mockAuth),
};

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue('test-api-key'),
};

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
global.fetch = jest.fn();

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFirebaseService.auth.mockReturnValue(mockAuth);
    mockAuth.revokeRefreshTokens.mockResolvedValue(undefined);
    mockAuth.verifyIdToken.mockResolvedValue({ active: true });
    mockRepository.save.mockResolvedValue(undefined);
    mockRepository.updateLastUsed.mockResolvedValue(undefined);
    mockRepository.revoke.mockResolvedValue(undefined);
    mockRepository.revokeMany.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: RefreshTokenRepository, useValue: mockRepository },
        { provide: FirebaseService, useValue: mockFirebaseService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  // -------------------------------------------------------------------------
  // TEST 1: createToken() — success
  // -------------------------------------------------------------------------
  it('TEST 1: createToken() returns a UUID v4 and calls repository.save with correct data', async () => {
    const result = await service.createToken('uid-1', 'firebase-rt-1');

    // Should be UUID v4 format
    expect(result).toMatch(/^[0-9a-f-]{36}$/i);

    expect(mockRepository.save).toHaveBeenCalledTimes(1);

    const saveCalls = mockRepository.save.mock.calls as [
      RefreshTokenDocument,
    ][];
    const savedDoc = saveCalls[0][0];
    expect(savedDoc).toMatchObject({ uid: 'uid-1', active: true });
  });

  // -------------------------------------------------------------------------
  // TEST 2: createToken() — generates unique tokens
  // -------------------------------------------------------------------------
  it('TEST 2: createToken() generates unique tokens on each call', async () => {
    const token1 = await service.createToken('uid-1', 'firebase-rt-1');
    const token2 = await service.createToken('uid-1', 'firebase-rt-2');

    expect(token1).not.toBe(token2);
  });

  // -------------------------------------------------------------------------
  // TEST 3: validateToken() — valid active token
  // -------------------------------------------------------------------------
  it('TEST 3: validateToken() returns doc for a valid active token', async () => {
    mockRepository.findById.mockResolvedValue({
      tokenId: 'tk1',
      uid: 'u1',
      active: true,
      expiresAt: { toMillis: () => Date.now() + 100000 },
      firebaseRefreshToken: 'fbrt',
      lastUsedAt: null,
    });

    const result = await service.validateToken('tk1');

    expect(result).toBeDefined();
    expect(result.uid).toBe('u1');
  });

  // -------------------------------------------------------------------------
  // TEST 4: validateToken() — token not found
  // -------------------------------------------------------------------------
  it('TEST 4: validateToken() throws UnauthorizedException when token does not exist', async () => {
    mockRepository.findById.mockResolvedValue(null);

    await expect(service.validateToken('nonexistent')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // -------------------------------------------------------------------------
  // TEST 5: validateToken() — token inactive (revoked)
  // -------------------------------------------------------------------------
  it('TEST 5: validateToken() throws UnauthorizedException when token is inactive', async () => {
    mockRepository.findById.mockResolvedValue({
      active: false,
      expiresAt: { toMillis: () => Date.now() + 100000 },
    });

    await expect(service.validateToken('tk1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // -------------------------------------------------------------------------
  // TEST 6: validateToken() — token expired
  // -------------------------------------------------------------------------
  it('TEST 6: validateToken() throws UnauthorizedException when token is expired', async () => {
    mockRepository.findById.mockResolvedValue({
      active: true,
      expiresAt: { toMillis: () => Date.now() - 1000 },
    });

    await expect(service.validateToken('tk1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // -------------------------------------------------------------------------
  // TEST 7: exchangeToken() — success
  // -------------------------------------------------------------------------
  it('TEST 7: exchangeToken() returns idToken and expiresIn, updates lastUsedAt', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => ({ id_token: 'new-id-token', expires_in: '3600' }),
    });
    mockAuth.verifyIdToken.mockResolvedValue({ active: true });

    const fakeDoc = {
      tokenId: 'tk1',
      uid: 'u1',
      firebaseRefreshToken: 'fbrt',
      active: true,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
    };

    const result = await service.exchangeToken(fakeDoc as any);

    expect(result).toEqual({ idToken: 'new-id-token', expiresIn: 3600 });
    expect(mockRepository.updateLastUsed).toHaveBeenCalledTimes(1);
    expect(mockRepository.updateLastUsed).toHaveBeenCalledWith(
      'tk1',
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // TEST 8: exchangeToken() — Firebase API error
  // -------------------------------------------------------------------------
  it('TEST 8: exchangeToken() throws UnauthorizedException on Firebase API error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: () => ({ error: { message: 'TOKEN_EXPIRED' } }),
    });

    const fakeDoc = {
      tokenId: 'tk1',
      uid: 'u1',
      firebaseRefreshToken: 'fbrt',
      active: true,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
    };

    await expect(service.exchangeToken(fakeDoc as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // -------------------------------------------------------------------------
  // TEST 9: revokeToken() — success
  // -------------------------------------------------------------------------
  it('TEST 9: revokeToken() calls repository.revoke when token exists', async () => {
    mockRepository.findById.mockResolvedValue({ tokenId: 'tk1', active: true });

    await service.revokeToken('tk1');

    expect(mockRepository.revoke).toHaveBeenCalledTimes(1);
    expect(mockRepository.revoke).toHaveBeenCalledWith(
      'tk1',
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // TEST 9b: revokeToken() — token not found
  // -------------------------------------------------------------------------
  it('TEST 9b: revokeToken() throws NotFoundException when token does not exist', async () => {
    mockRepository.findById.mockResolvedValue(null);

    await expect(service.revokeToken('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockRepository.revoke).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 10: revokeAllForUser() — success with active sessions
  // -------------------------------------------------------------------------
  it('TEST 10: revokeAllForUser() returns 2 and calls revokeRefreshTokens when 2 sessions active', async () => {
    mockRepository.findActiveByUid.mockResolvedValue([
      { tokenId: 'tk1', uid: 'u1', active: true },
      { tokenId: 'tk2', uid: 'u1', active: true },
    ]);

    const result = await service.revokeAllForUser('u1');

    expect(result).toBe(2);
    expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('u1');
    expect(mockRepository.revokeMany).toHaveBeenCalledWith(
      ['tk1', 'tk2'],
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // TEST 11: revokeAllForUser() — no active sessions
  // -------------------------------------------------------------------------
  it('TEST 11: revokeAllForUser() returns 0 and still calls revokeRefreshTokens when no sessions', async () => {
    mockRepository.findActiveByUid.mockResolvedValue([]);

    const result = await service.revokeAllForUser('u1');

    expect(result).toBe(0);
    expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('u1');
    expect(mockRepository.revokeMany).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 12: exchangeToken() — throws ForbiddenException if user is inactive
  // -------------------------------------------------------------------------
  it('TEST 12: exchangeToken() throws ForbiddenException if user active claim is false', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => ({ id_token: 'new-id-token', expires_in: '3600' }),
    });
    mockAuth.verifyIdToken.mockResolvedValue({ active: false });

    const fakeDoc = {
      tokenId: 'tk1',
      uid: 'u1',
      firebaseRefreshToken: 'fbrt',
      active: true,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
    };

    await expect(service.exchangeToken(fakeDoc as any)).rejects.toThrow(
      ForbiddenException,
    );
    // updateLastUsed must NOT have been called since we throw before it
    expect(mockRepository.updateLastUsed).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 13: revokeToken() — no-op if already inactive
  // -------------------------------------------------------------------------
  it('TEST 13: revokeToken() is a no-op if token is already inactive', async () => {
    mockRepository.findById.mockResolvedValue({
      tokenId: 'tk1',
      active: false,
    });

    await service.revokeToken('tk1');

    expect(mockRepository.revoke).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // Tests nuevos — multi-tenancy (ver docblock de RefreshTokenService)
  // ===========================================================================

  // -------------------------------------------------------------------------
  // TEST 14: refresh funciona SIN TenantContext abierto
  //
  // /auth/refresh se llama sin idToken vigente: no hay contexto de tenant
  // posible en esa request. Este test corre exchangeToken() a propósito FUERA
  // de un TenantContext.run(...) — si RefreshTokenService dependiera de
  // TenantContext.getOrThrow() (p. ej. si alguien lo hiciera extender
  // TenantScopedRepository), esto reventaría con InternalServerErrorException
  // en vez de devolver el idToken renovado.
  // -------------------------------------------------------------------------
  it('TEST 14: exchangeToken() funciona sin TenantContext abierto', async () => {
    expect(TenantContext.get()).toBeUndefined();

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => ({ id_token: 'new-id-token', expires_in: '3600' }),
    });
    mockAuth.verifyIdToken.mockResolvedValue({
      active: true,
      tenantId: 'kia-quito',
    });

    const fakeDoc = {
      tokenId: 'tk1',
      uid: 'u1',
      firebaseRefreshToken: 'fbrt',
      active: true,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
      tenantId: 'kia-quito',
    };

    const result = await service.exchangeToken(fakeDoc as any);

    expect(result).toEqual({ idToken: 'new-id-token', expiresIn: 3600 });
  });

  // -------------------------------------------------------------------------
  // TEST 15: coherencia de tenant — el token de un usuario no sirve para
  // renovar sesión con otro concesionario.
  //
  // Simula un documento de refresh token emitido para 'kia-quito' cuya
  // custom claim vigente ahora dice 'mazda-guayaquil' (usuario reasignado
  // de concesionario, o claim alterada). exchangeToken() debe rechazar la
  // renovación Y revocar el token — no debe devolver un idToken utilizable.
  // -------------------------------------------------------------------------
  it('TEST 15: exchangeToken() rechaza y revoca cuando el tenantId del token no coincide con la claim vigente', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => ({ id_token: 'new-id-token', expires_in: '3600' }),
    });
    mockAuth.verifyIdToken.mockResolvedValue({
      active: true,
      tenantId: 'mazda-guayaquil',
    });

    const fakeDoc = {
      tokenId: 'tk1',
      uid: 'u1',
      firebaseRefreshToken: 'fbrt',
      active: true,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
      tenantId: 'kia-quito',
    };

    await expect(service.exchangeToken(fakeDoc as any)).rejects.toThrow(
      ForbiddenException,
    );

    // El token queda revocado — no solo rechazado esta vez, sino inutilizable
    // para intentos futuros.
    expect(mockRepository.revoke).toHaveBeenCalledWith(
      'tk1',
      expect.anything(),
    );
    // No se devuelve ni se sella un idToken renovado para el tenant ajeno.
    expect(mockRepository.updateLastUsed).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 16: coherencia de tenant — un token sin tenantId (pre-remint de
  // claims, ver runbook de migración paso 4) no se bloquea por esta
  // validación: es aditiva, no retroactiva.
  // -------------------------------------------------------------------------
  it('TEST 16: exchangeToken() no bloquea un token legado sin tenantId', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => ({ id_token: 'new-id-token', expires_in: '3600' }),
    });
    mockAuth.verifyIdToken.mockResolvedValue({
      active: true,
      tenantId: 'kia-quito',
    });

    const fakeDoc = {
      tokenId: 'tk1',
      uid: 'u1',
      firebaseRefreshToken: 'fbrt',
      active: true,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
      // sin tenantId — documento emitido antes del remint de claims
    };

    const result = await service.exchangeToken(fakeDoc as any);

    expect(result).toEqual({ idToken: 'new-id-token', expiresIn: 3600 });
    expect(mockRepository.revoke).not.toHaveBeenCalled();
  });
});
