import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// ── Mock helpers ─────────────────────────────────────────────────────────────

const mockDoc = (data: Record<string, any> | null) => ({
  exists: data !== null,
  id: data?.['id'] ?? 'vehicle-id',
  data: () => data,
});

const mockDocRef = (data: Record<string, any> | null) => {
  const subDocRef = {
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const subCollection = {
    add: jest.fn().mockResolvedValue({ id: 'history-id' }),
    orderBy: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [] }),
    doc: jest.fn().mockReturnValue(subDocRef),
  };
  return {
    get: jest.fn().mockResolvedValue(mockDoc(data)),
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    collection: jest.fn().mockReturnValue(subCollection),
  };
};

const mockQuery = (docs: Record<string, any>[]) => ({
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({
    docs: docs.map((d) => ({ id: d['id'] ?? 'vehicle-id', data: () => d })),
  }),
});

const mockFirebase = () => ({
  firestore: jest.fn().mockReturnValue({
    collection: jest.fn().mockReturnValue(mockQuery([])),
    doc: jest.fn().mockReturnValue(mockDocRef(null)),
  }),
  storage: jest.fn().mockReturnValue({}),
  serverTimestamp: jest.fn().mockReturnValue({ _seconds: 0 }),
  uploadBuffer: jest.fn().mockResolvedValue('gs://bucket/path'),
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.com/photo'),
});

const mockNotifications = () => ({
  notify: jest.fn().mockResolvedValue(undefined),
});

const adminUser: AuthenticatedUser = {
  uid: 'admin-uid',
  role: RoleEnum.JEFE_TALLER,
  sede: SedeEnum.ALL,
  active: true,
  displayName: 'Admin KIA',
  email: 'admin@kia.com',
};

// ── Main describe ─────────────────────────────────────────────────────────────

describe('VehiclesService', () => {
  let service: VehiclesService;
  let firebase: ReturnType<typeof mockFirebase>;
  let notifications: ReturnType<typeof mockNotifications>;

  beforeEach(async () => {
    firebase = mockFirebase();
    notifications = mockNotifications();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehiclesService,
        { provide: FirebaseService, useFactory: () => firebase },
        { provide: NotificationsService, useFactory: () => notifications },
      ],
    }).compile();

    service = module.get<VehiclesService>(VehiclesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create() ────────────────────────────────────────────────────────────────
  describe('create()', () => {
    it('should throw BadRequestException if year is in the past', async () => {
      const dto = {
        chassis: 'ABC123',
        model: 'Sportage',
        year: 2000,
        color: 'Blanco',
        originConcessionaire: 'LogiManta',
        sede: SedeEnum.SURMOTOR,
      };

      // Mock empty chassis query (no duplicate)
      const collection = firebase.firestore().collection('vehicles');
      collection.where = jest.fn().mockReturnThis();
      collection.get = jest.fn().mockResolvedValue({ docs: [] });
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collection),
      });

      await expect(service.create(dto as any, adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException on duplicate chassis', async () => {
      const dto = {
        chassis: 'DUP-CHASSIS',
        model: 'Sportage',
        year: new Date().getFullYear(),
        color: 'Rojo',
        originConcessionaire: 'AsiaAuto',
        sede: SedeEnum.SHYRIS,
      };

      const collection = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs: [{}] }), // duplicate found
        doc: jest.fn().mockReturnValue(mockDocRef(null)),
      };
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collection),
      });

      await expect(service.create(dto as any, adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── assertExists() ───────────────────────────────────────────────────────────
  describe('assertExists()', () => {
    it('should throw NotFoundException if vehicle does not exist', async () => {
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue(mockDocRef(null)),
        }),
      });

      await expect(service.assertExists('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return vehicle data if exists', async () => {
      const vehicleData = {
        id: 'v1',
        chassis: 'XYZ',
        status: VehicleStatus.RECEPCIONADO,
      };
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue(mockDocRef(vehicleData)),
        }),
      });

      const result = await service.assertExists('v1');
      expect(result).toMatchObject({ chassis: 'XYZ' });
    });
  });

  // ── changeStatus() ──────────────────────────────────────────────────────────
  describe('changeStatus()', () => {
    it('should update the vehicle status', async () => {
      const vehicleData = { id: 'v1', status: VehicleStatus.RECEPCIONADO, sede: SedeEnum.SURMOTOR };
      const ref = mockDocRef(vehicleData);
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue(ref),
        }),
      });

      await service.changeStatus('v1', VehicleStatus.CERTIFICADO_STOCK, adminUser);

      expect(ref.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: VehicleStatus.CERTIFICADO_STOCK }),
      );
    });
  });
});
