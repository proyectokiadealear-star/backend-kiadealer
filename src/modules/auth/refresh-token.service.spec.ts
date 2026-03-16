import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenService } from './refresh-token.service';
import { FirebaseService } from '../../firebase/firebase.service';

// ---------------------------------------------------------------------------
// Firestore mock — supports chained calls and batch operations
// ---------------------------------------------------------------------------

const mockBatch = {
  update: jest.fn(),
  commit: jest.fn().mockResolvedValue(undefined),
};

const mockDocRef = {
  set: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
};

const mockCollectionRef = {
  doc: jest.fn().mockReturnValue(mockDocRef),
  where: jest.fn(),
  get: jest.fn(),
};

// .where().where().get() chain
const mockWhereChain = {
  where: jest.fn(),
  get: jest.fn(),
};
mockCollectionRef.where.mockReturnValue(mockWhereChain);
mockWhereChain.where.mockReturnValue(mockWhereChain);

const mockFirestore = {
  collection: jest.fn().mockReturnValue(mockCollectionRef),
  batch: jest.fn().mockReturnValue(mockBatch),
};

const mockAuth = {
  revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
  verifyIdToken: jest.fn().mockResolvedValue({ active: true }),
};

const mockFirebaseService = {
  firestore: jest.fn().mockReturnValue(mockFirestore),
  auth: jest.fn().mockReturnValue(mockAuth),
};

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue('test-api-key'),
};

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
global.fetch = jest.fn() as jest.Mock;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  beforeEach(async () => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Re-apply default return values after clearAllMocks
    mockFirebaseService.firestore.mockReturnValue(mockFirestore);
    mockFirebaseService.auth.mockReturnValue(mockAuth);
    mockFirestore.collection.mockReturnValue(mockCollectionRef);
    mockFirestore.batch.mockReturnValue(mockBatch);
    mockCollectionRef.doc.mockReturnValue(mockDocRef);
    mockCollectionRef.where.mockReturnValue(mockWhereChain);
    mockWhereChain.where.mockReturnValue(mockWhereChain);
    mockBatch.commit.mockResolvedValue(undefined);
    mockAuth.revokeRefreshTokens.mockResolvedValue(undefined);
    mockAuth.verifyIdToken.mockResolvedValue({ active: true });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: FirebaseService, useValue: mockFirebaseService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  // -------------------------------------------------------------------------
  // TEST 1: createToken() — success
  // -------------------------------------------------------------------------
  it('TEST 1: createToken() returns a UUID v4 and calls set with correct data', async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    const result = await service.createToken('uid-1', 'firebase-rt-1');

    // Should be UUID v4 format
    expect(result).toMatch(/^[0-9a-f-]{36}$/i);

    // set() was called once
    expect(mockDocRef.set).toHaveBeenCalledTimes(1);

    // The document passed to set() contains uid and active: true
    const calledWith = mockDocRef.set.mock.calls[0][0];
    expect(calledWith).toMatchObject({ uid: 'uid-1', active: true });
  });

  // -------------------------------------------------------------------------
  // TEST 2: createToken() — generates unique tokens
  // -------------------------------------------------------------------------
  it('TEST 2: createToken() generates unique tokens on each call', async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    const token1 = await service.createToken('uid-1', 'firebase-rt-1');
    const token2 = await service.createToken('uid-1', 'firebase-rt-2');

    expect(token1).not.toBe(token2);
  });

  // -------------------------------------------------------------------------
  // TEST 3: validateToken() — valid active token
  // -------------------------------------------------------------------------
  it('TEST 3: validateToken() returns doc for a valid active token', async () => {
    const fakeDoc = {
      tokenId: 'tk1',
      uid: 'u1',
      active: true,
      expiresAt: { toMillis: () => Date.now() + 100000 },
      firebaseRefreshToken: 'fbrt',
      lastUsedAt: null,
    };

    mockDocRef.get.mockResolvedValue({
      exists: true,
      data: () => fakeDoc,
    });

    const result = await service.validateToken('tk1');

    expect(result).toBeDefined();
    expect(result.uid).toBe('u1');
  });

  // -------------------------------------------------------------------------
  // TEST 4: validateToken() — token not found
  // -------------------------------------------------------------------------
  it('TEST 4: validateToken() throws UnauthorizedException when token does not exist', async () => {
    mockDocRef.get.mockResolvedValue({ exists: false });

    await expect(service.validateToken('nonexistent')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // -------------------------------------------------------------------------
  // TEST 5: validateToken() — token inactive (revoked)
  // -------------------------------------------------------------------------
  it('TEST 5: validateToken() throws UnauthorizedException when token is inactive', async () => {
    mockDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        active: false,
        expiresAt: { toMillis: () => Date.now() + 100000 },
      }),
    });

    await expect(service.validateToken('tk1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // -------------------------------------------------------------------------
  // TEST 6: validateToken() — token expired
  // -------------------------------------------------------------------------
  it('TEST 6: validateToken() throws UnauthorizedException when token is expired', async () => {
    mockDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        active: true,
        expiresAt: { toMillis: () => Date.now() - 1000 },
      }),
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
      json: async () => ({ id_token: 'new-id-token', expires_in: '3600' }),
    });
    mockAuth.verifyIdToken.mockResolvedValue({ active: true });
    mockDocRef.update.mockResolvedValue(undefined);

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
    expect(mockDocRef.update).toHaveBeenCalledTimes(1);

    const updateArg = mockDocRef.update.mock.calls[0][0];
    expect(updateArg).toHaveProperty('lastUsedAt');
  });

  // -------------------------------------------------------------------------
  // TEST 8: exchangeToken() — Firebase API error
  // -------------------------------------------------------------------------
  it('TEST 8: exchangeToken() throws UnauthorizedException on Firebase API error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'TOKEN_EXPIRED' } }),
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
  it('TEST 9: revokeToken() calls update with active: false when token exists', async () => {
    mockDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({ active: true }),
    });
    mockDocRef.update.mockResolvedValue(undefined);

    await service.revokeToken('tk1');

    expect(mockDocRef.update).toHaveBeenCalledTimes(1);
    const updateArg = mockDocRef.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({ active: false });
  });

  // -------------------------------------------------------------------------
  // TEST 9b: revokeToken() — token not found
  // -------------------------------------------------------------------------
  it('TEST 9b: revokeToken() throws NotFoundException when token does not exist', async () => {
    mockDocRef.get.mockResolvedValue({ exists: false });

    await expect(service.revokeToken('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockDocRef.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 10: revokeAllForUser() — success with active sessions
  // -------------------------------------------------------------------------
  it('TEST 10: revokeAllForUser() returns 2 and calls revokeRefreshTokens when 2 sessions active', async () => {
    const docSnap1 = { id: 'tk1', ref: {} };
    const docSnap2 = { id: 'tk2', ref: {} };

    mockWhereChain.get.mockResolvedValue({
      empty: false,
      size: 2,
      docs: [docSnap1, docSnap2],
    });
    mockBatch.update.mockReturnValue(undefined);
    mockBatch.commit.mockResolvedValue(undefined);

    const result = await service.revokeAllForUser('u1');

    expect(result).toBe(2);
    expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('u1');
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // TEST 11: revokeAllForUser() — no active sessions
  // -------------------------------------------------------------------------
  it('TEST 11: revokeAllForUser() returns 0 and still calls revokeRefreshTokens when no sessions', async () => {
    mockWhereChain.get.mockResolvedValue({
      empty: true,
      size: 0,
      docs: [],
    });

    const result = await service.revokeAllForUser('u1');

    expect(result).toBe(0);
    expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('u1');
    // batch.commit should NOT have been called (snap.empty is true → skip batch)
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 12: exchangeToken() — throws ForbiddenException if user is inactive
  // -------------------------------------------------------------------------
  it('TEST 12: exchangeToken() throws ForbiddenException if user active claim is false', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: 'new-id-token', expires_in: '3600' }),
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
    // update() must NOT have been called since we throw before it
    expect(mockDocRef.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 13: revokeToken() — no-op if already inactive
  // -------------------------------------------------------------------------
  it('TEST 13: revokeToken() is a no-op if token is already inactive', async () => {
    mockDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({ active: false }),
    });
    mockDocRef.update.mockResolvedValue(undefined);

    await service.revokeToken('tk1');

    expect(mockDocRef.update).not.toHaveBeenCalled();
  });
});
