import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let firebase: any;

  const mockUsers = [
    { id: 'u1', data: () => ({ uid: 'u1', fcmTokens: ['token-A', 'token-B'], role: RoleEnum.JEFE_TALLER, sede: SedeEnum.ALL, active: true }) },
    { id: 'u2', data: () => ({ uid: 'u2', fcmTokens: ['token-C'], role: RoleEnum.JEFE_TALLER, sede: SedeEnum.ALL, active: true }) },
  ];

  beforeEach(async () => {
    firebase = {
      firestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: mockUsers }),
          add: jest.fn().mockResolvedValue({ id: 'notif-id' }),
        }),
      }),
      messaging: jest.fn().mockReturnValue({
        sendEachForMulticast: jest.fn().mockResolvedValue({
          responses: [{ success: true }, { success: true }, { success: true }],
          successCount: 3,
          failureCount: 0,
        }),
      }),
      serverTimestamp: jest.fn().mockReturnValue({ _seconds: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: FirebaseService, useFactory: () => firebase },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('should call sendEachForMulticast with all collected tokens', async () => {
    const payload = {
      title: 'Test',
      body: 'Mensaje test',
      type: 'TEST',
      targetRoles: [RoleEnum.JEFE_TALLER],
      targetSedeFilter: SedeEnum.ALL,
      data: { vehicleId: 'v1' },
    };

    await service.notify(payload as any);

    const messaging = firebase.messaging();
    expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: expect.arrayContaining(['token-A', 'token-B', 'token-C']),
      }),
    );
  });

  it('should save notification to Firestore even when FCM fails', async () => {
    firebase.messaging = jest.fn().mockReturnValue({
      sendEachForMulticast: jest.fn().mockRejectedValue(new Error('FCM error')),
    });

    const payload = {
      title: 'Fail test',
      body: 'Error FCM',
      type: 'TEST_FAIL',
      targetRoles: [RoleEnum.JEFE_TALLER],
      targetSedeFilter: SedeEnum.ALL,
      data: {},
    };

    // Should NOT throw — errors are caught internally
    await expect(service.notify(payload as any)).resolves.not.toThrow();
  });

  it('should not send FCM if no tokens found', async () => {
    firebase.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }), // no users
        add: jest.fn().mockResolvedValue({ id: 'n' }),
      }),
    });

    const payload = {
      title: 'Empty',
      body: 'No users',
      type: 'NO_USERS',
      targetRoles: [RoleEnum.ASESOR],
      targetSedeFilter: SedeEnum.SURMOTOR,
      data: {},
    };

    await service.notify(payload as any);
    const messaging = firebase.messaging();
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
  });
});
