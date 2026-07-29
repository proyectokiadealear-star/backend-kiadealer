import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { NotificationRecipientsRepository } from './notification-recipients.repository';

/**
 * `users` ya migró a TenantScopedRepository (ver `UsersRepository`), así que
 * esta lectura de destinatarios no tolera documentos sin `tenantId` como
 * hacía la primera versión de este repositorio (un `MigrationBridgeRepository`
 * pensado para cuando `users` todavía no había migrado). El filtrado por
 * concesionario ahora lo aplica Firestore directamente vía `scopedQuery()`,
 * igual que en notifications.repository.spec.ts.
 */
describe('NotificationRecipientsRepository', () => {
  let repository: NotificationRecipientsRepository;
  let audit: { recordCrossTenantAttempt: jest.Mock };
  let query: { where: jest.Mock; get: jest.Mock };
  let collectionRef: { where: jest.Mock };

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

  const givenUsers = (
    docs: Array<{ id: string; data: Record<string, unknown> }>,
  ) => {
    query.get.mockResolvedValue({
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    });
  };

  beforeEach(() => {
    query = { where: jest.fn(), get: jest.fn() };
    query.where.mockReturnValue(query);
    collectionRef = { where: jest.fn().mockReturnValue(query) };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };
    audit = {
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };

    repository = new NotificationRecipientsRepository(
      firebase as never,
      audit as never,
    );
  });

  describe('fallo cerrado sin contexto', () => {
    it('findActiveByRoleAndSede() lanza en vez de consultar Firestore', async () => {
      await expect(
        repository.findActiveByRoleAndSede(RoleEnum.JEFE_TALLER, SedeEnum.ALL),
      ).rejects.toThrow(InternalServerErrorException);
      expect(collectionRef.where).not.toHaveBeenCalled();
    });
  });

  describe('findActiveByRoleAndSede()', () => {
    it('acota por tenantId, role y active', async () => {
      givenUsers([]);

      await TenantContext.run(makeContext(), () =>
        repository.findActiveByRoleAndSede(RoleEnum.JEFE_TALLER, SedeEnum.ALL),
      );

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
      expect(query.where).toHaveBeenCalledWith(
        'role',
        '==',
        RoleEnum.JEFE_TALLER,
      );
      expect(query.where).toHaveBeenCalledWith('active', '==', true);
    });

    it('agrega el filtro sede-in cuando la sede no es ALL', async () => {
      givenUsers([]);

      await TenantContext.run(makeContext(), () =>
        repository.findActiveByRoleAndSede(
          RoleEnum.JEFE_TALLER,
          SedeEnum.SURMOTOR,
        ),
      );

      expect(query.where).toHaveBeenCalledWith('sede', 'in', [
        SedeEnum.SURMOTOR,
        SedeEnum.ALL,
      ]);
    });

    it('no agrega el filtro de sede cuando el destino es ALL', async () => {
      givenUsers([]);

      await TenantContext.run(makeContext(), () =>
        repository.findActiveByRoleAndSede(RoleEnum.JEFE_TALLER, SedeEnum.ALL),
      );

      expect(query.where).not.toHaveBeenCalledWith(
        'sede',
        'in',
        expect.anything(),
      );
    });

    it('devuelve los documentos que Firestore ya acotó al tenant activo', async () => {
      givenUsers([
        {
          id: 'u1',
          data: {
            tenantId: 'kia-quito',
            role: RoleEnum.JEFE_TALLER,
            active: true,
            fcmTokens: ['t1'],
          },
        },
      ]);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findActiveByRoleAndSede(RoleEnum.JEFE_TALLER, SedeEnum.ALL),
      );

      expect(result).toEqual([
        {
          id: 'u1',
          tenantId: 'kia-quito',
          role: RoleEnum.JEFE_TALLER,
          active: true,
          fcmTokens: ['t1'],
        },
      ]);
    });
  });
});
