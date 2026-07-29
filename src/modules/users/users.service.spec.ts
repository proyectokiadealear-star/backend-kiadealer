import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

/**
 * El servicio no conoce Firestore ni TenantContext — solo delega en
 * UsersRepository, que es quien lee el contexto y asigna el tenantId. Por
 * eso el mock del repositorio es un objeto plano (mismo criterio que
 * catalogs.service.spec.ts). El aislamiento propiamente dicho (usuario de
 * otro concesionario → null/404, fallo cerrado sin contexto, tenantId en los
 * claims) se cubre en users.repository.spec.ts; acá se verifica que el
 * servicio TRADUCE correctamente lo que el repositorio le devuelve.
 */
describe('UsersService', () => {
  let service: UsersService;
  let firebase: {
    auth: jest.Mock;
    serverTimestamp: jest.Mock;
  };
  let authApi: {
    createUser: jest.Mock;
    generatePasswordResetLink: jest.Mock;
    revokeRefreshTokens: jest.Mock;
  };
  let config: { getOrThrow: jest.Mock };
  let usersRepository: {
    findFiltered: jest.Mock;
    findByIdOrThrow: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    addFcmToken: jest.Mock;
    assignClaims: jest.Mock;
  };
  let fetchMock: jest.Mock;

  const creator: AuthenticatedUser = {
    uid: 'admin-1',
    email: 'admin@kia.com',
    role: RoleEnum.JEFE_TALLER,
    active: true,
    sede: SedeEnum.SURMOTOR,
    tenantId: 'kia-quito',
  };

  const createDto: CreateUserDto = {
    displayName: 'Nuevo Asesor',
    email: 'nuevo@kia.com',
    role: RoleEnum.ASESOR,
    sede: SedeEnum.SURMOTOR,
  };

  beforeEach(() => {
    authApi = {
      createUser: jest.fn().mockResolvedValue({ uid: 'new-uid' }),
      generatePasswordResetLink: jest
        .fn()
        .mockResolvedValue('https://reset-link'),
      revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
    };
    firebase = {
      auth: jest.fn().mockReturnValue(authApi),
      serverTimestamp: jest.fn().mockReturnValue('SERVER_TS'),
    };
    config = {
      getOrThrow: jest.fn().mockReturnValue('fake-api-key'),
    };
    usersRepository = {
      findFiltered: jest.fn().mockResolvedValue([]),
      findByIdOrThrow: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'new-uid' }),
      addFcmToken: jest.fn(),
      assignClaims: jest.fn().mockResolvedValue(undefined),
    };

    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    service = new UsersService(
      firebase as never,
      config as never,
      usersRepository as never,
    );
  });

  describe('create()', () => {
    it('crea el usuario en Auth, asigna claims y crea el documento con el uid como id', async () => {
      const result = await service.create(createDto, creator);

      expect(authApi.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: createDto.email }),
      );
      expect(usersRepository.assignClaims).toHaveBeenCalledWith('new-uid', {
        role: createDto.role,
        sede: createDto.sede,
        active: true,
      });
      expect(usersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: 'new-uid',
          email: createDto.email,
          createdBy: creator.uid,
        }),
        'new-uid',
      );
      expect(result).toEqual(
        expect.objectContaining({
          uid: 'new-uid',
          resetLink: 'https://reset-link',
        }),
      );
    });

    it('nunca pasa tenantId al pedir los claims — el repositorio lo saca del contexto', async () => {
      await service.create(createDto, creator);

      const [, claims] = usersRepository.assignClaims.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(claims).not.toHaveProperty('tenantId');
    });

    it('si falla la generación del reset link, continúa con resetLink=null', async () => {
      authApi.generatePasswordResetLink.mockRejectedValue(
        new Error('SMTP caído'),
      );

      const result = await service.create(createDto, creator);

      expect(result.resetLink).toBeNull();
    });
  });

  describe('findAll()', () => {
    it('delega en findFiltered, oculta fcmTokens y ordena por displayName', async () => {
      usersRepository.findFiltered.mockResolvedValue([
        { uid: 'b', displayName: 'Zeta', fcmTokens: ['t1'] },
        { uid: 'a', displayName: 'Alfa', fcmTokens: ['t2'] },
      ]);

      const result = await service.findAll({ role: RoleEnum.ASESOR });

      expect(usersRepository.findFiltered).toHaveBeenCalledWith({
        role: RoleEnum.ASESOR,
      });
      expect(result.map((u) => u.displayName)).toEqual(['Alfa', 'Zeta']);
      expect(result[0]).not.toHaveProperty('fcmTokens');
    });
  });

  describe('findOne()', () => {
    it('delega en findByIdOrThrow con un factory de NotFoundException', async () => {
      usersRepository.findByIdOrThrow.mockImplementation(
        (_uid: string, notFound: () => Error) => {
          throw notFound();
        },
      );

      await expect(service.findOne('user-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devuelve el usuario cuando el repositorio lo encuentra', async () => {
      usersRepository.findByIdOrThrow.mockResolvedValue({
        uid: 'user-1',
        tenantId: 'kia-quito',
      });

      const result = await service.findOne('user-1');

      expect(result).toEqual(expect.objectContaining({ uid: 'user-1' }));
    });
  });

  describe('update()', () => {
    it('lanza 404 si el repositorio no encuentra el usuario (incluye el de otro concesionario)', async () => {
      usersRepository.update.mockResolvedValue(null);

      await expect(
        service.update('user-x', { displayName: 'X' }),
      ).rejects.toThrow(NotFoundException);
      expect(usersRepository.assignClaims).not.toHaveBeenCalled();
    });

    it('no reasigna claims si solo cambia displayName', async () => {
      usersRepository.update.mockResolvedValue({
        uid: 'user-1',
        displayName: 'Nuevo Nombre',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SURMOTOR,
        active: true,
      });

      await service.update('user-1', { displayName: 'Nuevo Nombre' });

      expect(usersRepository.assignClaims).not.toHaveBeenCalled();
    });

    it('reasigna claims con los valores mergeados cuando cambia role/sede/active', async () => {
      usersRepository.update.mockResolvedValue({
        uid: 'user-1',
        role: RoleEnum.JEFE_TALLER,
        sede: SedeEnum.SHYRIS,
        active: true,
      });

      await service.update('user-1', { role: RoleEnum.JEFE_TALLER });

      expect(usersRepository.assignClaims).toHaveBeenCalledWith('user-1', {
        role: RoleEnum.JEFE_TALLER,
        sede: SedeEnum.SHYRIS,
        active: true,
      });
    });

    it('revoca refresh tokens al desactivar al usuario', async () => {
      usersRepository.update.mockResolvedValue({
        uid: 'user-1',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SURMOTOR,
        active: false,
      });

      await service.update('user-1', { active: false } as UpdateUserDto);

      expect(authApi.revokeRefreshTokens).toHaveBeenCalledWith('user-1');
    });

    it('no revoca tokens si no se desactiva', async () => {
      usersRepository.update.mockResolvedValue({
        uid: 'user-1',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SURMOTOR,
        active: true,
      });

      await service.update('user-1', { displayName: 'X' });

      expect(authApi.revokeRefreshTokens).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('delega en update(uid, {active:false})', async () => {
      usersRepository.update.mockResolvedValue({
        uid: 'user-1',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SURMOTOR,
        active: false,
      });

      const result = await service.remove('user-1');

      expect(usersRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ active: false }),
      );
      expect(result).toEqual({ uid: 'user-1', deactivated: true });
    });
  });

  describe('resetPassword()', () => {
    it('lanza 404 si el repositorio no encuentra el usuario (aislamiento entre concesionarios)', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await expect(service.resetPassword('user-x')).rejects.toThrow(
        NotFoundException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('envía el correo de reset cuando el usuario es del concesionario activo', async () => {
      usersRepository.findById.mockResolvedValue({
        uid: 'user-1',
        email: 'user@kia.com',
      });

      const result = await service.resetPassword('user-1');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('sendOobCode'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual(
        expect.objectContaining({ uid: 'user-1', email: 'user@kia.com' }),
      );
    });

    it('lanza 500 si la Auth REST API responde con error', async () => {
      usersRepository.findById.mockResolvedValue({
        uid: 'user-1',
        email: 'user@kia.com',
      });
      fetchMock.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: { message: 'EMAIL_NOT_FOUND' } }),
      });

      await expect(service.resetPassword('user-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('registerFcmToken()', () => {
    it('lanza 404 si el repositorio no pudo registrar el token', async () => {
      usersRepository.addFcmToken.mockResolvedValue(false);

      await expect(
        service.registerFcmToken('user-1', 'token-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('devuelve {uid, tokenRegistered:true} cuando el repositorio confirma', async () => {
      usersRepository.addFcmToken.mockResolvedValue(true);

      const result = await service.registerFcmToken('user-1', 'token-1');

      expect(usersRepository.addFcmToken).toHaveBeenCalledWith(
        'user-1',
        'token-1',
      );
      expect(result).toEqual({ uid: 'user-1', tokenRegistered: true });
    });
  });
});
