import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { UserDocument, UsersRepository } from './users.repository';

/**
 * Cubre el contrato de aislamiento multi-tenant del repositorio de usuarios
 * y, sobre todo, el manejo de custom claims — la superficie más delicada del
 * módulo: Firebase Auth es global (no particionado por tenant) y
 * `setCustomUserClaims()` reemplaza el objeto de claims completo en vez de
 * mergearlo.
 */
describe('UsersRepository', () => {
  let repository: UsersRepository;
  let audit: { recordCrossTenantAttempt: jest.Mock };
  let docRef: {
    id: string;
    get: jest.Mock;
    set: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let whereQuery: { get: jest.Mock; where: jest.Mock };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };
  let collectionMock: jest.Mock;
  let authMock: { getUser: jest.Mock; setCustomUserClaims: jest.Mock };
  let firebase: {
    rawFirestore: jest.Mock;
    serverTimestamp: jest.Mock;
    auth: jest.Mock;
  };

  const makeContext = (
    overrides: Partial<TenantContextData> = {},
  ): TenantContextData => ({
    tenantId: 'kia-quito',
    userId: 'admin-1',
    role: RoleEnum.JEFE_TALLER,
    establishmentIds: ['surmotor'],
    platformAdmin: false,
    requestId: 'req-1',
    ...overrides,
  });

  const givenDocument = (data: Partial<UserDocument> | null) => {
    docRef.get.mockResolvedValue(
      data
        ? { exists: true, id: 'user-1', data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    docRef = {
      id: 'user-1',
      get: jest
        .fn()
        .mockResolvedValue({ exists: false, data: () => undefined }),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    whereQuery = {
      get: jest.fn().mockResolvedValue({ docs: [] }),
      where: jest.fn(),
    };
    whereQuery.where.mockReturnValue(whereQuery);
    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn().mockReturnValue(whereQuery),
    };
    collectionMock = jest.fn().mockReturnValue(collectionRef);
    authMock = {
      getUser: jest.fn().mockResolvedValue({ customClaims: undefined }),
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    };
    firebase = {
      rawFirestore: jest.fn().mockReturnValue({ collection: collectionMock }),
      serverTimestamp: jest.fn().mockReturnValue('SERVER_TS'),
      auth: jest.fn().mockReturnValue(authMock),
    };
    audit = {
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };

    repository = new UsersRepository(firebase as never, audit as never);
  });

  describe('fallo cerrado sin contexto', () => {
    it('findById() lanza en vez de consultar Firestore', async () => {
      await expect(repository.findById('user-1')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(docRef.get).not.toHaveBeenCalled();
    });

    it('findFiltered() lanza en vez de consultar Firestore', async () => {
      await expect(repository.findFiltered()).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(whereQuery.get).not.toHaveBeenCalled();
    });

    it('assignClaims() lanza en vez de tocar Firebase Auth', async () => {
      await expect(
        repository.assignClaims('user-1', {
          role: RoleEnum.ASESOR,
          sede: SedeEnum.SURMOTOR,
          active: true,
        }),
      ).rejects.toThrow(InternalServerErrorException);
      expect(authMock.setCustomUserClaims).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento entre concesionarios', () => {
    it('findById() devuelve null ante un usuario de otro concesionario', async () => {
      givenDocument({
        tenantId: 'mazda-guayaquil',
        uid: 'user-1',
      } as UserDocument);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('user-1'),
      );

      expect(result).toBeNull();
      expect(audit.recordCrossTenantAttempt).toHaveBeenCalledWith({
        collection: 'users',
        documentId: 'user-1',
        ownerTenantId: 'mazda-guayaquil',
      });
    });

    it('findById() devuelve el usuario propio', async () => {
      givenDocument({
        tenantId: 'kia-quito',
        uid: 'user-1',
        email: 'a@kia.com',
      } as UserDocument);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('user-1'),
      );

      expect(result).toEqual(
        expect.objectContaining({ tenantId: 'kia-quito', uid: 'user-1' }),
      );
    });
  });

  describe('create() — el tenantId del contexto pisa el del payload', () => {
    it('ignora un tenantId ajeno enviado en el payload y usa el uid como id', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.create(
          {
            uid: 'user-1',
            tenantId: 'mazda-guayaquil',
            displayName: 'Nuevo',
            email: 'a@kia.com',
            role: RoleEnum.ASESOR,
            sede: SedeEnum.SURMOTOR,
            active: true,
            fcmTokens: [],
            createdAt: 'now',
            updatedAt: 'now',
            createdBy: 'admin-1',
          } as never,
          'user-1',
        ),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith('user-1');
      expect(docRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
    });
  });

  describe('findFiltered()', () => {
    it('siempre acota por el tenantId del contexto', async () => {
      await TenantContext.run(makeContext(), () => repository.findFiltered());

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
    });

    it('encadena los filtros opcionales de role, sede y active', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.findFiltered({
          role: RoleEnum.ASESOR,
          sede: SedeEnum.SURMOTOR,
          active: true,
        }),
      );

      expect(whereQuery.where).toHaveBeenCalledWith(
        'role',
        '==',
        RoleEnum.ASESOR,
      );
      expect(whereQuery.where).toHaveBeenCalledWith(
        'sede',
        '==',
        SedeEnum.SURMOTOR,
      );
      expect(whereQuery.where).toHaveBeenCalledWith('active', '==', true);
    });

    it('active=false se aplica (no se confunde con "sin filtro")', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.findFiltered({ active: false }),
      );

      expect(whereQuery.where).toHaveBeenCalledWith('active', '==', false);
    });
  });

  describe('addFcmToken()', () => {
    it('devuelve false sin escribir si el usuario no existe o es de otro concesionario', async () => {
      givenDocument(null);

      const result = await TenantContext.run(makeContext(), () =>
        repository.addFcmToken('user-1', 'token-abc'),
      );

      expect(result).toBe(false);
      expect(docRef.update).not.toHaveBeenCalled();
    });

    it('agrega el token con arrayUnion cuando el usuario es propio', async () => {
      givenDocument({ tenantId: 'kia-quito', uid: 'user-1' } as UserDocument);

      const result = await TenantContext.run(makeContext(), () =>
        repository.addFcmToken('user-1', 'token-abc'),
      );

      expect(result).toBe(true);
      expect(docRef.update).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: 'SERVER_TS' }),
      );
    });
  });

  describe('assignClaims() — el tenantId sale SIEMPRE del contexto', () => {
    it('incluye el tenantId del contexto activo en los claims emitidos', async () => {
      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.assignClaims('user-1', {
          role: RoleEnum.ASESOR,
          sede: SedeEnum.SURMOTOR,
          active: true,
        }),
      );

      expect(authMock.setCustomUserClaims).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
    });

    it('usa el tenantId del contexto aunque cambie entre llamadas — nunca queda pegado a un valor previo', async () => {
      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.assignClaims('user-1', {
          role: RoleEnum.ASESOR,
          sede: SedeEnum.SURMOTOR,
          active: true,
        }),
      );
      await TenantContext.run(
        makeContext({ tenantId: 'mazda-guayaquil' }),
        () =>
          repository.assignClaims('user-2', {
            role: RoleEnum.ASESOR,
            sede: SedeEnum.SURMOTOR,
            active: true,
          }),
      );

      expect(authMock.setCustomUserClaims).toHaveBeenNthCalledWith(
        1,
        'user-1',
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
      expect(authMock.setCustomUserClaims).toHaveBeenNthCalledWith(
        2,
        'user-2',
        expect.objectContaining({ tenantId: 'mazda-guayaquil' }),
      );
    });

    it('preserva claims existentes (p.ej. establishmentIds) en vez de pisarlos', async () => {
      authMock.getUser.mockResolvedValue({
        customClaims: {
          tenantId: 'kia-quito',
          establishmentIds: ['surmotor', 'shyris'],
          role: RoleEnum.ASESOR,
          sede: SedeEnum.SURMOTOR,
          active: true,
        },
      });

      await TenantContext.run(makeContext(), () =>
        repository.assignClaims('user-1', {
          role: RoleEnum.JEFE_TALLER,
          sede: SedeEnum.SURMOTOR,
          active: true,
        }),
      );

      expect(authMock.setCustomUserClaims).toHaveBeenCalledWith('user-1', {
        tenantId: 'kia-quito',
        establishmentIds: ['surmotor', 'shyris'],
        role: RoleEnum.JEFE_TALLER,
        sede: SedeEnum.SURMOTOR,
        active: true,
      });
    });

    it('funciona si el usuario todavía no tiene ningún claim (alta nueva)', async () => {
      authMock.getUser.mockResolvedValue({ customClaims: undefined });

      await TenantContext.run(makeContext(), () =>
        repository.assignClaims('user-1', {
          role: RoleEnum.ASESOR,
          sede: SedeEnum.SURMOTOR,
          active: true,
        }),
      );

      expect(authMock.setCustomUserClaims).toHaveBeenCalledWith('user-1', {
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SURMOTOR,
        active: true,
        tenantId: 'kia-quito',
      });
    });
  });
});
