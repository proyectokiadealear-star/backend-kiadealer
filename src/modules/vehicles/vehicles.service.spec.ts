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

const mockQuery = (docs: Record<string, any>[]) => {
  const query: any = {
    where: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: docs.map((d) => ({
        id: d['id'] ?? 'vehicle-id',
        data: () => d,
        get: (field: string) => d[field],
      })),
    }),
    count: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: () => ({ count: docs.length }) }),
    }),
  };
  query.where.mockReturnValue(query);
  return query;
};

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

  // ── findAll() ──────────────────────────────────────────────────────────────
  describe('findAll()', () => {
    it('clientId aplica where() nativo en vez de traer todo a memoria', async () => {
      const query = mockQuery([]);
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(query),
      });

      await service.findAll({ clientId: 'cliente-1' } as any, adminUser);

      expect(query.where).toHaveBeenCalledWith('clientId', '==', 'cliente-1');
      // Camino Firestore-side: usa count() + orderBy(), no un get() plano
      // sobre toda la colección para filtrar clientId en memoria después.
      expect(query.count).toHaveBeenCalled();
      expect(query.orderBy).toHaveBeenCalledWith('statusChangedAt', 'desc');
    });

    it('chassis sigue exigiendo el camino en memoria (substring, no soportado por Firestore)', async () => {
      const query = mockQuery([
        { chassis: 'ABC123', id: 'v1' },
        { chassis: 'XYZ999', id: 'v2' },
      ]);
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(query),
      });

      const result = await service.findAll(
        { chassis: 'abc' } as any,
        adminUser,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].chassis).toBe('ABC123');
      // No debe intentar count() en el camino de memoria: ese branch calcula
      // el total a partir del arreglo ya filtrado, no de un agregado.
      expect(query.count).not.toHaveBeenCalled();
    });

    it('clientId + chassis combinados: el where() acota antes del filtro en memoria', async () => {
      const query = mockQuery([
        { chassis: 'ABC123', clientId: 'cliente-1', id: 'v1' },
      ]);
      firebase.firestore = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(query),
      });

      await service.findAll(
        { chassis: 'abc', clientId: 'cliente-1' } as any,
        adminUser,
      );

      expect(query.where).toHaveBeenCalledWith('clientId', '==', 'cliente-1');
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
        status: VehicleStatus.POR_ARRIBAR,
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
      const vehicleData = { id: 'v1', status: VehicleStatus.POR_ARRIBAR, sede: SedeEnum.SURMOTOR };
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
