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
        { provide: NotificationsService, useFactory: () => notificationsService },
      ],
    }).compile();

    service = module.get<CertificationsService>(CertificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should throw BadRequestException if vehicle is not RECEPCIONADO', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.DOCUMENTADO, // wrong status
      sede: SedeEnum.SURMOTOR,
    });

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rims: { status: 'ORIGINAL', photoBase64: 'base64==' },
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 5,
      imprints: 'CON_IMPRONTAS',
    };

    await expect(service.create('v1', dto as any, asesorUser)).rejects.toThrow(BadRequestException);
  });

  it('should send KILOMETRAJE_ALTO notification when mileage > 10', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.RECEPCIONADO,
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
      status: VehicleStatus.RECEPCIONADO,
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
});
