import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DocumentationService } from './documentation.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// ─── Test user ───────────────────────────────────────────────────────────────
const docUser: AuthenticatedUser = {
  uid: 'doc-uid',
  role: RoleEnum.DOCUMENTACION,
  sede: SedeEnum.SURMOTOR,
  active: true,
  displayName: 'Laura Doc',
  email: 'doc@kia.com',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const buildFirebaseMock = () => ({
  firestore: jest.fn().mockReturnValue({
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.url/invoice.pdf'),
  serverTimestamp: jest.fn().mockReturnValue('mock-timestamp'),
});

const buildVehiclesServiceMock = () => ({
  assertExists: jest.fn(),
  changeStatus: jest.fn().mockResolvedValue(undefined),
  addStatusHistory: jest.fn().mockResolvedValue(undefined),
});

const buildNotificationsMock = () => ({
  notify: jest.fn().mockResolvedValue(undefined),
});

/** Minimal valid CreateDocumentationDto (non-pending) */
const baseCreateDto = {
  clientName: 'Juan Pérez',
  clientId: '12345678',
  clientPhone: '04241234567',
  registrationType: 'NUEVO',
  paymentMethod: 'FINANCIADO',
  saveAsPending: false,
  accessories: [],
};

/** Minimal vehicleInvoice file mock */
const mockInvoiceFile: Express.Multer.File = {
  fieldname: 'vehicleInvoice',
  originalname: 'invoice.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('fake-pdf'),
  size: 8,
  stream: null as any,
  destination: '',
  filename: '',
  path: '',
};

// ─── Suite ───────────────────────────────────────────────────────────────────
describe('DocumentationService — auto-advance to CERTIFICADO_STOCK', () => {
  let service: DocumentationService;
  let vehiclesService: ReturnType<typeof buildVehiclesServiceMock>;
  let notificationsService: ReturnType<typeof buildNotificationsMock>;
  let firebaseService: ReturnType<typeof buildFirebaseMock>;

  beforeEach(async () => {
    vehiclesService = buildVehiclesServiceMock();
    notificationsService = buildNotificationsMock();
    firebaseService = buildFirebaseMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentationService,
        { provide: FirebaseService, useFactory: () => firebaseService },
        { provide: VehiclesService, useFactory: () => vehiclesService },
        { provide: NotificationsService, useFactory: () => notificationsService },
      ],
    }).compile();

    service = module.get<DocumentationService>(DocumentationService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── DOC-CERT-1: create() with certifiedWhileEarlyState ────────────────────
  it('DOC-CERT-1: create() should auto-advance to CERTIFICADO_STOCK when certifiedWhileEarlyState=true', async () => {
    // GIVEN: vehicle in ENVIADO_A_MATRICULAR with certifiedWhileEarlyState=true
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v10',
      status: VehicleStatus.ENVIADO_A_MATRICULAR,
      certifiedWhileEarlyState: true,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'CERT123',
    });

    // WHEN: documentation is created (non-pending, no accessories → DOCUMENTADO normally)
    const result = await service.create(
      'v10',
      baseCreateDto as any,
      docUser,
      { vehicleInvoice: mockInvoiceFile, giftEmails: [], accessoryInvoices: [] },
    );

    // THEN: changeStatus should be called with CERTIFICADO_STOCK, NOT DOCUMENTADO
    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v10',
      VehicleStatus.CERTIFICADO_STOCK,
      docUser,
      expect.any(Object),
    );
    expect(result.newStatus).toBe(VehicleStatus.CERTIFICADO_STOCK);
  });

  // ─── DOC-CERT-2: create() with certifiedWhileNoFacturado ───────────────────
  it('DOC-CERT-2: create() should auto-advance to CERTIFICADO_STOCK when certifiedWhileNoFacturado=true', async () => {
    // GIVEN: vehicle in ENVIADO_A_MATRICULAR with certifiedWhileNoFacturado=true
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v11',
      status: VehicleStatus.ENVIADO_A_MATRICULAR,
      certifiedWhileEarlyState: false,
      certifiedWhileNoFacturado: true,
      sede: SedeEnum.SURMOTOR,
      chassis: 'NOFACT456',
    });

    const result = await service.create(
      'v11',
      baseCreateDto as any,
      docUser,
      { vehicleInvoice: mockInvoiceFile, giftEmails: [], accessoryInvoices: [] },
    );

    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v11',
      VehicleStatus.CERTIFICADO_STOCK,
      docUser,
      expect.any(Object),
    );
    expect(result.newStatus).toBe(VehicleStatus.CERTIFICADO_STOCK);
  });

  // ─── DOC-CERT-3: create() WITHOUT pre-certification stays DOCUMENTADO ──────
  it('DOC-CERT-3: create() should keep DOCUMENTADO when no pre-certification flags are set', async () => {
    // GIVEN: vehicle NOT pre-certified (both flags false)
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v12',
      status: VehicleStatus.ENVIADO_A_MATRICULAR,
      certifiedWhileEarlyState: false,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'NODOC789',
    });

    const result = await service.create(
      'v12',
      baseCreateDto as any,
      docUser,
      { vehicleInvoice: mockInvoiceFile, giftEmails: [], accessoryInvoices: [] },
    );

    // THEN: must stay DOCUMENTADO (regression guard)
    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v12',
      VehicleStatus.DOCUMENTADO,
      docUser,
      expect.any(Object),
    );
    expect(result.newStatus).toBe(VehicleStatus.DOCUMENTADO);
  });

  // ─── DOC-CERT-4: create() pending path is NOT affected ────────────────────
  it('DOC-CERT-4: create() with saveAsPending=true should stay DOCUMENTACION_PENDIENTE even with certifiedWhileEarlyState', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v13',
      status: VehicleStatus.ENVIADO_A_MATRICULAR,
      certifiedWhileEarlyState: true,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'PEND001',
    });

    const result = await service.create(
      'v13',
      { ...baseCreateDto, saveAsPending: true } as any,
      docUser,
      { vehicleInvoice: undefined, giftEmails: [], accessoryInvoices: [] },
    );

    // THEN: pending wins — no auto-advance to CERTIFICADO_STOCK
    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v13',
      VehicleStatus.DOCUMENTACION_PENDIENTE,
      docUser,
      expect.any(Object),
    );
    expect(result.newStatus).toBe(VehicleStatus.DOCUMENTACION_PENDIENTE);
  });

  // ─── DOC-CERT-5: update() isCompleting with certifiedWhileEarlyState ───────
  it('DOC-CERT-5: update() isCompleting should auto-advance to CERTIFICADO_STOCK when certifiedWhileEarlyState=true', async () => {
    // GIVEN: vehicle in DOCUMENTACION_PENDIENTE with certifiedWhileEarlyState=true
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v14',
      status: VehicleStatus.DOCUMENTACION_PENDIENTE,
      certifiedWhileEarlyState: true,
      certifiedWhileNoFacturado: false,
      isReopening: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'PEND-CERT',
    });

    // Mock existing documentation record
    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              vehicleId: 'v14',
              documentationStatus: 'PENDIENTE',
            }),
          }),
          set: jest.fn().mockResolvedValue(undefined),
          update: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    });

    // WHEN: update completing the pending documentation
    const result = await service.update(
      'v14',
      { saveAsPending: false, accessories: [] } as any,
      docUser,
    );

    // THEN: changeStatus should be called with CERTIFICADO_STOCK
    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v14',
      VehicleStatus.CERTIFICADO_STOCK,
      docUser,
      expect.any(Object),
    );
    expect(result.newStatus).toBe(VehicleStatus.CERTIFICADO_STOCK);
  });

  // ─── DOC-CERT-6: update() isCompleting with certifiedWhileNoFacturado ──────
  it('DOC-CERT-6: update() isCompleting should auto-advance to CERTIFICADO_STOCK when certifiedWhileNoFacturado=true', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v15',
      status: VehicleStatus.DOCUMENTACION_PENDIENTE,
      certifiedWhileEarlyState: false,
      certifiedWhileNoFacturado: true,
      isReopening: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'NOFACT-PEND',
    });

    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ vehicleId: 'v15', documentationStatus: 'PENDIENTE' }),
          }),
          set: jest.fn().mockResolvedValue(undefined),
          update: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    });

    const result = await service.update(
      'v15',
      { saveAsPending: false, accessories: [] } as any,
      docUser,
    );

    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v15',
      VehicleStatus.CERTIFICADO_STOCK,
      docUser,
      expect.any(Object),
    );
    expect(result.newStatus).toBe(VehicleStatus.CERTIFICADO_STOCK);
  });

  // ─── DOC-CERT-7: update() isCompleting WITHOUT pre-cert stays DOCUMENTADO ──
  it('DOC-CERT-7: update() isCompleting should stay DOCUMENTADO when no pre-certification flags', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v16',
      status: VehicleStatus.DOCUMENTACION_PENDIENTE,
      certifiedWhileEarlyState: false,
      certifiedWhileNoFacturado: false,
      isReopening: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'NO-CERT-PEND',
    });

    firebaseService.firestore = jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ vehicleId: 'v16', documentationStatus: 'PENDIENTE' }),
          }),
          set: jest.fn().mockResolvedValue(undefined),
          update: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    });

    const result = await service.update(
      'v16',
      { saveAsPending: false, accessories: [] } as any,
      docUser,
    );

    // Regression guard: without flags, must stay DOCUMENTADO
    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v16',
      VehicleStatus.DOCUMENTADO,
      docUser,
      expect.any(Object),
    );
    expect(result.newStatus).toBe(VehicleStatus.DOCUMENTADO);
  });
});
