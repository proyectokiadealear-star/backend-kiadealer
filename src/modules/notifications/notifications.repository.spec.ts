import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { NotificationsRepository } from './notifications.repository';

/**
 * NotificationsRepository no agrega lógica de aislamiento propia — es una
 * instanciación de TenantScopedRepository para `notifications`, más
 * `findByTargetRole` y `deleteBatch`. Estos tests cubren el contrato de
 * aislamiento multi-tenant sobre ESE repositorio concreto (no duplican la
 * suite completa de tenant-scoped.repository.spec.ts), igual que hace
 * delivery.repository.spec.ts para DeliveryRepository.
 */
describe('NotificationsRepository', () => {
  let repository: NotificationsRepository;
  let audit: { recordCrossTenantAttempt: jest.Mock };
  let docRef: {
    get: jest.Mock;
    set: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    id: string;
  };
  let whereQuery: { where: jest.Mock; get: jest.Mock };
  let batchRef: { delete: jest.Mock; commit: jest.Mock };
  let collectionRef: {
    doc: jest.Mock;
    where: jest.Mock;
    firestore: { batch: jest.Mock };
  };

  const makeContext = (
    overrides: Partial<TenantContextData> = {},
  ): TenantContextData => ({
    tenantId: 'kia-quito',
    userId: 'user-1',
    role: RoleEnum.ASESOR,
    establishmentIds: ['surmotor'],
    platformAdmin: false,
    requestId: 'req-1',
    ...overrides,
  });

  const givenDocument = (data: Record<string, unknown> | null) => {
    docRef.get.mockResolvedValue(
      data
        ? { exists: true, id: 'notif-1', data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    docRef = {
      id: 'notif-1',
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    batchRef = {
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };
    whereQuery = { where: jest.fn(), get: jest.fn() };
    whereQuery.where.mockReturnValue(whereQuery);

    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn().mockReturnValue(whereQuery),
      firestore: { batch: jest.fn().mockReturnValue(batchRef) },
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };
    audit = {
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };

    repository = new NotificationsRepository(firebase as never, audit as never);
  });

  describe('fallo cerrado sin contexto', () => {
    it('findById() lanza en vez de consultar Firestore', async () => {
      await expect(repository.findById('notif-1')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(docRef.get).not.toHaveBeenCalled();
    });

    it('findByTargetRole() lanza en vez de consultar Firestore', async () => {
      await expect(
        repository.findByTargetRole(RoleEnum.JEFE_TALLER),
      ).rejects.toThrow(InternalServerErrorException);
      expect(collectionRef.where).not.toHaveBeenCalled();
    });

    it('create() lanza en vez de escribir', async () => {
      await expect(repository.create({ type: 'X' } as never)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(docRef.set).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento entre concesionarios', () => {
    it('findById() devuelve null ante una notificación de otro concesionario', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil', type: 'ESTADO_CAMBIADO' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('notif-1'),
      );

      expect(result).toBeNull();
      expect(audit.recordCrossTenantAttempt).toHaveBeenCalledWith({
        collection: 'notifications',
        documentId: 'notif-1',
        ownerTenantId: 'mazda-guayaquil',
      });
    });

    it('update() (usado por markAsRead) devuelve null ante una notificación ajena', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil', read: false });

      const result = await TenantContext.run(makeContext(), () =>
        repository.update('notif-1', { read: true }),
      );

      expect(result).toBeNull();
      expect(docRef.update).not.toHaveBeenCalled();
    });

    it('update() marca como leída una notificación propia', async () => {
      givenDocument({ tenantId: 'kia-quito', read: false });

      const result = await TenantContext.run(makeContext(), () =>
        repository.update('notif-1', { read: true }),
      );

      expect(docRef.update).toHaveBeenCalledWith({ read: true });
      expect(result).toEqual({
        id: 'notif-1',
        tenantId: 'kia-quito',
        read: true,
      });
    });
  });

  describe('el tenantId del contexto pisa el del payload', () => {
    it('create() ignora un tenantId ajeno enviado en el payload', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.create({
          type: 'ESTADO_CAMBIADO',
          tenantId: 'mazda-guayaquil',
        } as never),
      );

      expect(docRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
    });
  });

  describe('findByTargetRole()', () => {
    it('acota por tenantId y targetRole', async () => {
      whereQuery.get.mockResolvedValue({
        docs: [
          {
            id: 'notif-1',
            data: () => ({
              tenantId: 'kia-quito',
              targetRole: RoleEnum.JEFE_TALLER,
            }),
          },
        ],
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByTargetRole(RoleEnum.JEFE_TALLER),
      );

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
      expect(whereQuery.where).toHaveBeenCalledWith(
        'targetRole',
        '==',
        RoleEnum.JEFE_TALLER,
      );
      expect(result).toEqual([
        {
          id: 'notif-1',
          tenantId: 'kia-quito',
          targetRole: RoleEnum.JEFE_TALLER,
        },
      ]);
    });
  });

  describe('deleteBatch()', () => {
    it('borra cada id en el batch de Firestore', async () => {
      await repository.deleteBatch(['n1', 'n2']);

      expect(collectionRef.doc).toHaveBeenCalledWith('n1');
      expect(collectionRef.doc).toHaveBeenCalledWith('n2');
      expect(batchRef.delete).toHaveBeenCalledTimes(2);
      expect(batchRef.commit).toHaveBeenCalledTimes(1);
    });

    it('no hace nada si la lista de ids está vacía', async () => {
      await repository.deleteBatch([]);
      expect(collectionRef.firestore.batch).not.toHaveBeenCalled();
    });
  });
});
