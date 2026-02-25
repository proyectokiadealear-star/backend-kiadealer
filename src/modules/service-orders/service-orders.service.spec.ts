import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const jefeTaller: AuthenticatedUser = {
  uid: 'jefe-uid',
  role: RoleEnum.JEFE_TALLER,
  sede: SedeEnum.SURMOTOR,
  active: true,
  displayName: 'Jefe Taller',
  email: 'jefe@kia.com',
};

describe('ServiceOrdersService', () => {
  let service: ServiceOrdersService;
  let vehiclesService: jest.Mocked<Partial<VehiclesService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;
  let firebase: any;

  const makeDoc = (id: string, data: any) => ({
    exists: true,
    id,
    data: () => data,
  });

  const makeMissingDoc = () => ({ exists: false, data: () => null });

  beforeEach(async () => {
    vehiclesService = {
      assertExists: jest.fn(),
      changeStatus: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
    firebase = {
      firestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(makeMissingDoc()),
            set: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
      serverTimestamp: jest.fn().mockReturnValue({ _seconds: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceOrdersService,
        { provide: FirebaseService, useFactory: () => firebase },
        { provide: VehiclesService, useFactory: () => vehiclesService },
        { provide: NotificationsService, useFactory: () => notificationsService },
      ],
    }).compile();

    service = module.get<ServiceOrdersService>(ServiceOrdersService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create() ──────────────────────────────────────────────────────────────────
  describe('create()', () => {
    it('should throw BadRequestException if vehicle status is not DOCUMENTADO', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v1',
        status: VehicleStatus.RECEPCIONADO,
        sede: SedeEnum.SURMOTOR,
      });

      await expect(
        service.create({ vehicleId: 'v1' } as any, jefeTaller),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if documentation not found', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v1',
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'XYZ123',
      });
      // doc().get() returns not-found
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: false }),
            set: jest.fn(),
          }),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        }),
      });

      await expect(
        service.create({ vehicleId: 'v1' } as any, jefeTaller),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getPredictions() ──────────────────────────────────────────────────────────
  describe('getPredictions()', () => {
    it('should return empty array when documentation does not exist', async () => {
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: false }),
          }),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        }),
      });

      const result = await service.getPredictions('unknown-vehicle');
      expect(result).toEqual([]);
    });

    it('should return empty array when no sold accessories in documentation', async () => {
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                accessories: [
                  { key: 'radio', classification: 'NO_APLICA' },
                  { key: 'laminado', classification: 'NO_APLICA' },
                ],
              }),
            }),
          }),
          // No historical documents
          get: jest.fn().mockResolvedValue({ docs: [] }),
        }),
      });

      const result = await service.getPredictions('v1');
      expect(result).toEqual([]);
    });

    it('should return predictions above threshold', async () => {
      // v1 has laminas=VENDIDO, alarma=NO_APLICA (unclassified)
      // 3 historical docs: all have laminas=VENDIDO and alarma=VENDIDO → alarma 100% probability
      const historicalDocs = [
        makeDoc('hist-1', {
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'alarma', classification: 'VENDIDO' },
          ],
        }),
        makeDoc('hist-2', {
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'alarma', classification: 'VENDIDO' },
          ],
        }),
        makeDoc('hist-3', {
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'alarma', classification: 'VENDIDO' },
          ],
        }),
      ];

      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                accessories: [
                  { key: 'laminas', classification: 'VENDIDO' },
                  { key: 'alarma', classification: 'NO_APLICA' },
                ],
              }),
            }),
          }),
          get: jest.fn().mockResolvedValue({
            docs: historicalDocs.map((d) => ({ id: d.id, data: d.data })),
          }),
        }),
      });

      process.env.PREDICTION_THRESHOLD = '40';
      const result = await service.getPredictions('v1');

      // alarma appeared 3/3 = 100% > 40% threshold
      expect(Array.isArray(result)).toBe(true);
      const alarmaPrediction = (result as any[]).find((p) => p.key === 'alarma');
      expect(alarmaPrediction).toBeDefined();
      expect(alarmaPrediction.probability).toBeGreaterThanOrEqual(40);
    });
  });
});
