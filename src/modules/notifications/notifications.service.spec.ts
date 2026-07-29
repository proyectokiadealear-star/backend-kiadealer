import { NotFoundException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';

/**
 * El servicio no conoce Firestore ni TenantContext — solo delega en los
 * repositorios inyectados (NotificationsRepository,
 * NotificationRecipientsRepository) y en FirebaseService para
 * FCM/serverTimestamp. Por eso los mocks acá son objetos planos, igual que
 * en catalogs.service.spec.ts y delivery.service.spec.ts: el aislamiento por
 * tenant se prueba en notifications.repository.spec.ts y
 * notification-recipients.repository.spec.ts, contra el repositorio real.
 */
describe('NotificationsService', () => {
  let service: NotificationsService;
  let firebase: { messaging: jest.Mock; serverTimestamp: jest.Mock };
  let notificationsRepository: {
    create: jest.Mock;
    findByTargetRole: jest.Mock;
    deleteBatch: jest.Mock;
    update: jest.Mock;
  };
  let recipients: { findActiveByRoleAndSede: jest.Mock };

  const mockUsers = [
    {
      uid: 'u1',
      fcmTokens: ['token-A', 'token-B'],
      role: RoleEnum.JEFE_TALLER,
      sede: SedeEnum.ALL,
      active: true,
    },
    {
      uid: 'u2',
      fcmTokens: ['token-C'],
      role: RoleEnum.JEFE_TALLER,
      sede: SedeEnum.ALL,
      active: true,
    },
  ];

  beforeEach(() => {
    firebase = {
      messaging: jest.fn().mockReturnValue({
        sendEachForMulticast: jest.fn().mockResolvedValue({
          responses: [{ success: true }, { success: true }, { success: true }],
          successCount: 3,
          failureCount: 0,
        }),
      }),
      serverTimestamp: jest.fn().mockReturnValue({ _seconds: 0 }),
    };
    notificationsRepository = {
      create: jest.fn().mockResolvedValue({ id: 'notif-id' }),
      findByTargetRole: jest.fn().mockResolvedValue([]),
      deleteBatch: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
    };
    recipients = {
      findActiveByRoleAndSede: jest.fn().mockResolvedValue(mockUsers),
    };

    service = new NotificationsService(
      firebase as never,
      notificationsRepository as never,
      recipients as never,
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('notify()', () => {
    const payload = {
      title: 'Test',
      body: 'Mensaje test',
      type: 'TEST',
      targetRole: RoleEnum.JEFE_TALLER,
      targetSede: SedeEnum.ALL,
      data: { vehicleId: 'v1' },
    };

    it('should call sendEachForMulticast with all collected tokens', async () => {
      await service.notify(payload as never);

      const messaging = firebase.messaging() as {
        sendEachForMulticast: jest.Mock;
      };
      expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: expect.arrayContaining([
            'token-A',
            'token-B',
            'token-C',
          ]) as unknown as string[],
        }),
      );
    });

    it('should not throw when FCM fails', async () => {
      firebase.messaging = jest.fn().mockReturnValue({
        sendEachForMulticast: jest
          .fn()
          .mockRejectedValue(new Error('FCM error')),
      });

      // Should NOT throw — errors are caught internally
      await expect(service.notify(payload as never)).resolves.not.toThrow();
    });

    it('should not send FCM if no tokens found', async () => {
      recipients.findActiveByRoleAndSede.mockResolvedValue([]); // no users

      await service.notify(payload as never);

      const messaging = firebase.messaging() as {
        sendEachForMulticast: jest.Mock;
      };
      expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
      // Igual guarda el historial in-app aunque no haya destinatarios push
      expect(notificationsRepository.create).toHaveBeenCalled();
    });

    it('delega la búsqueda de destinatarios en el repositorio, sin pasar tenantId', async () => {
      await service.notify(payload as never);

      expect(recipients.findActiveByRoleAndSede).toHaveBeenCalledWith(
        RoleEnum.JEFE_TALLER,
        SedeEnum.ALL,
      );
      // El service nunca recibe ni pasa un tenantId: el repositorio lo resuelve del contexto.
      expect(recipients.findActiveByRoleAndSede.mock.calls[0]).toHaveLength(2);
    });
  });

  describe('markAsRead()', () => {
    it('lanza 404 cuando el repositorio devuelve null (ajena o inexistente)', async () => {
      notificationsRepository.update.mockResolvedValue(null);

      await expect(service.markAsRead('notif-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devuelve {id, read:true} cuando el repositorio actualiza', async () => {
      notificationsRepository.update.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'kia-quito',
        read: true,
      });

      const result = await service.markAsRead('notif-1');

      expect(notificationsRepository.update).toHaveBeenCalledWith('notif-1', {
        read: true,
      });
      expect(result).toEqual({ id: 'notif-1', read: true });
    });
  });

  describe('getNotifications()', () => {
    it('delega en findByTargetRole y filtra por sede en memoria', async () => {
      notificationsRepository.findByTargetRole.mockResolvedValue([
        {
          id: 'n1',
          targetSede: SedeEnum.SURMOTOR,
          read: false,
          createdAt: { toDate: () => new Date() },
        },
        {
          id: 'n2',
          targetSede: SedeEnum.SHYRIS,
          read: false,
          createdAt: { toDate: () => new Date() },
        },
      ]);

      const result = await service.getNotifications(
        'uid-1',
        RoleEnum.JEFE_TALLER,
        SedeEnum.SURMOTOR,
        false,
        20,
      );

      expect(notificationsRepository.findByTargetRole).toHaveBeenCalledWith(
        RoleEnum.JEFE_TALLER,
      );
      expect(result).toHaveLength(1);
      expect((result[0] as { id: string }).id).toBe('n1');
    });

    it('limpia en batch las notificaciones vencidas (>24h) y las excluye del resultado', async () => {
      const expired = new Date(Date.now() - 25 * 60 * 60 * 1000);
      notificationsRepository.findByTargetRole.mockResolvedValue([
        {
          id: 'expired-1',
          targetSede: SedeEnum.ALL,
          read: false,
          createdAt: { toDate: () => expired },
        },
      ]);

      const result = await service.getNotifications(
        'uid-1',
        RoleEnum.JEFE_TALLER,
        SedeEnum.SURMOTOR,
        false,
        20,
      );

      expect(result).toHaveLength(0);
      expect(notificationsRepository.deleteBatch).toHaveBeenCalledWith([
        'expired-1',
      ]);
    });

    it('con onlyUnread=true descarta las notificaciones ya leídas', async () => {
      notificationsRepository.findByTargetRole.mockResolvedValue([
        {
          id: 'read-1',
          targetSede: SedeEnum.ALL,
          read: true,
          createdAt: { toDate: () => new Date() },
        },
      ]);

      const result = await service.getNotifications(
        'uid-1',
        RoleEnum.JEFE_TALLER,
        SedeEnum.SURMOTOR,
        true,
        20,
      );

      expect(result).toHaveLength(0);
    });
  });
});
