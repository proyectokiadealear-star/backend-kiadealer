import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CertificationsService } from './certifications.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const asesorUser: AuthenticatedUser = {
  uid: 'asesor-uid',
  role: RoleEnum.ASESOR,
  sede: SedeEnum.SURMOTOR,
  active: true,
  displayName: 'Pedro Asesor',
  email: 'asesor@kia.com',
};

describe('CertificationsService', () => {
  let service: CertificationsService;
  let vehiclesService: jest.Mocked<Partial<VehiclesService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;
  let firebaseService: any;

  const mockDoc = (data: any) => ({
    exists: data !== null,
    data: () => data,
  });

  const mockDocRef = (data: any) => ({
    get: jest.fn().mockResolvedValue(mockDoc(data)),
    set: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(async () => {
    vehiclesService = {
      assertExists: jest.fn(),
      changeStatus: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
    firebaseService = {
      firestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue(mockDocRef(null)),
        }),
      }),
      uploadBuffer: jest.fn().mockResolvedValue('gs://bucket/rims-photo'),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed.url/rims.jpg'),
      serverTimestamp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationsService,
        { provide: FirebaseService, useFactory: () => firebaseService },
        { provide: VehiclesService, useFactory: () => vehiclesService },
        {
          provide: NotificationsService,
          useFactory: () => notificationsService,
        },
      ],
    }).compile();

    service = module.get<CertificationsService>(CertificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should throw BadRequestException if vehicle is not in an allowed certification status', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.DOCUMENTACION_PENDIENTE, // not in allowedStatuses, not post-cert
      sede: SedeEnum.SURMOTOR,
    });

    // No cert doc exists (isUpsert = false)
    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
        }),
      }),
    });

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 5,
      imprints: 'CON_IMPRONTAS',
    };

    await expect(service.create('v1', dto as any, asesorUser)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should send KILOMETRAJE_ALTO notification when mileage > 10', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.DOCUMENTADO,
      sede: SedeEnum.SURMOTOR,
    });

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rims: { status: 'ORIGINAL', photoBase64: 'base64==' },
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 15, // > 10
      imprints: 'CON_IMPRONTAS',
    };

    await service.create('v1', dto as any, asesorUser);

    const notifyCalls = (notificationsService.notify as jest.Mock).mock.calls;
    const types = notifyCalls.map((c: any[]) => c[0].type);
    expect(types).toContain('KILOMETRAJE_ALTO');
  });

  it('should send SIN_IMPRONTAS notification when imprints are missing', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.DOCUMENTADO,
      sede: SedeEnum.SURMOTOR,
    });

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rims: { status: 'ORIGINAL', photoBase64: 'base64==' },
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 3,
      imprints: 'SIN_IMPRONTAS',
    };

    await service.create('v1', dto as any, asesorUser);

    const types = (notificationsService.notify as jest.Mock).mock.calls.map(
      (c: any[]) => c[0].type,
    );
    expect(types).toContain('SIN_IMPRONTAS');
  });

  // ── CEV-1-A: Branch C — POR_ARRIBAR ─────────────────────────────────────
  it('CEV-1-A: should certify vehicle in POR_ARRIBAR without changing status', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v2',
      status: VehicleStatus.POR_ARRIBAR,
      sede: SedeEnum.SURMOTOR,
      chassis: 'ABC123',
    });
    vehiclesService.addStatusHistory = jest.fn().mockResolvedValue(undefined);

    const vehicleUpdateMock = jest.fn().mockResolvedValue(undefined);
    const certSetMock = jest.fn().mockResolvedValue(undefined);

    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockImplementation((col: string) => ({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
          set: col === 'certifications' ? certSetMock : jest.fn(),
          update: col === 'vehicles' ? vehicleUpdateMock : jest.fn(),
        }),
      })),
    });

    const dto = {
      vehicleId: 'v2',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 3,
      imprints: 'CON_IMPRONTAS',
    };

    const result = await service.create('v2', dto as any, asesorUser);

    expect(result.newStatus).toBe(VehicleStatus.POR_ARRIBAR);
    expect(result).toHaveProperty('certifiedWhileEarlyState', true);
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();

    const notifyCalls = (notificationsService.notify as jest.Mock).mock.calls;
    const notifyTitles = notifyCalls.map((c: any[]) => c[0].title);
    expect(
      notifyTitles.some((t: string) => t.includes('estado temprano')),
    ).toBe(true);
  });

  // ── CEV-2-A: Branch C — ENVIADO_A_MATRICULAR ────────────────────────────
  it('CEV-2-A: should certify vehicle in ENVIADO_A_MATRICULAR without changing status', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v3',
      status: VehicleStatus.ENVIADO_A_MATRICULAR,
      sede: SedeEnum.SURMOTOR,
      chassis: 'XYZ789',
    });
    vehiclesService.addStatusHistory = jest.fn().mockResolvedValue(undefined);

    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockImplementation(() => ({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
          set: jest.fn().mockResolvedValue(undefined),
          update: jest.fn().mockResolvedValue(undefined),
        }),
      })),
    });

    const dto = {
      vehicleId: 'v3',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 2,
      imprints: 'CON_IMPRONTAS',
    };

    const result = await service.create('v3', dto as any, asesorUser);

    expect(result.newStatus).toBe(VehicleStatus.ENVIADO_A_MATRICULAR);
    expect(result).toHaveProperty('certifiedWhileEarlyState', true);
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
  });

  // ── CEV-4-A: remove() Branch C — POR_ARRIBAR ────────────────────────────
  it('CEV-4-A: remove() should clear certifiedWhileEarlyState flag without reverting status (POR_ARRIBAR)', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v4',
      status: VehicleStatus.POR_ARRIBAR,
      certifiedWhileEarlyState: true,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'DEF456',
    });
    vehiclesService.addStatusHistory = jest.fn().mockResolvedValue(undefined);

    const vehicleUpdateMock = jest.fn().mockResolvedValue(undefined);
    const certDeleteMock = jest.fn().mockResolvedValue(undefined);

    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockImplementation((col: string) => ({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
          delete: col === 'certifications' ? certDeleteMock : jest.fn(),
          update: col === 'vehicles' ? vehicleUpdateMock : jest.fn(),
        }),
      })),
    });
    firebaseService.deleteFile = jest.fn().mockResolvedValue(undefined);

    const result = await service.remove('v4', asesorUser);

    expect(result).toEqual({ vehicleId: 'v4', deleted: true });
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    expect(vehiclesService.addStatusHistory).toHaveBeenCalledWith(
      'v4',
      VehicleStatus.POR_ARRIBAR,
      VehicleStatus.POR_ARRIBAR,
      asesorUser,
      SedeEnum.SURMOTOR,
      expect.stringContaining('estado temprano'),
    );
  });

  // ── Branch D: remove() — DOCUMENTADO + certifiedWhileEarlyState ─────────
  it('Branch D: remove() should clear certifiedWhileEarlyState flag without reverting status when vehicle is DOCUMENTADO', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v5',
      status: VehicleStatus.DOCUMENTADO,
      certifiedWhileEarlyState: true,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'GHI101',
    });
    vehiclesService.addStatusHistory = jest.fn().mockResolvedValue(undefined);

    const vehicleUpdateMock = jest.fn().mockResolvedValue(undefined);

    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockImplementation((col: string) => ({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
          delete: jest.fn().mockResolvedValue(undefined),
          update: col === 'vehicles' ? vehicleUpdateMock : jest.fn(),
        }),
      })),
    });
    firebaseService.deleteFile = jest.fn().mockResolvedValue(undefined);

    const result = await service.remove('v5', asesorUser);

    expect(result).toEqual({ vehicleId: 'v5', deleted: true });
    // No debe revertir el status — ya está en DOCUMENTADO
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    expect(vehicleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ certifiedWhileEarlyState: false }),
    );
  });
});
