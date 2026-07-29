import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service';
import { ServiceOrdersRepository } from './service-orders.repository';
import { VehicleFieldsRepository } from './vehicle-fields.repository';
import { DocumentationLookupRepository } from './documentation-lookup.repository';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';

const jefeTaller: AuthenticatedUser = {
  uid: 'jefe-uid',
  role: RoleEnum.JEFE_TALLER,
  sede: SedeEnum.SURMOTOR,
  active: true,
  displayName: 'Jefe Taller',
  email: 'jefe@kia.com',
};

const makeContext = (
  overrides: Partial<TenantContextData> = {},
): TenantContextData => ({
  tenantId: 'kia-quito',
  userId: 'user-1',
  role: RoleEnum.JEFE_TALLER,
  establishmentIds: ['surmotor'],
  platformAdmin: false,
  requestId: 'req-1',
  ...overrides,
});

/** Query encadenable falsa para `ServiceOrdersRepository.query()`. */
const makeFakeQuery = (docs: Array<{ id: string; data: () => any }>) => {
  const query: any = {
    where: jest.fn(() => query),
    get: jest.fn().mockResolvedValue({ docs }),
  };
  return query;
};

describe('ServiceOrdersService', () => {
  let service: ServiceOrdersService;
  let vehiclesService: jest.Mocked<Partial<VehiclesService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;
  let firebase: any;
  let serviceOrders: jest.Mocked<
    Pick<
      ServiceOrdersRepository,
      'create' | 'findByIdOrThrow' | 'update' | 'query'
    >
  >;
  let vehicleFields: jest.Mocked<Pick<VehicleFieldsRepository, 'updateFields'>>;
  let documentationLookup: jest.Mocked<
    Pick<
      DocumentationLookupRepository,
      'findByVehicleId' | 'findRecentForActiveTenant'
    >
  >;

  beforeEach(async () => {
    vehiclesService = {
      assertExists: jest.fn(),
      changeStatus: jest.fn().mockResolvedValue(undefined),
      addStatusHistory: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
    firebase = {
      serverTimestamp: jest.fn().mockReturnValue({ _seconds: 0 }),
    };
    serviceOrders = {
      create: jest.fn().mockResolvedValue(undefined),
      findByIdOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockReturnValue(makeFakeQuery([])),
    };
    vehicleFields = {
      updateFields: jest.fn().mockResolvedValue(true),
    };
    documentationLookup = {
      findByVehicleId: jest.fn().mockResolvedValue(null),
      findRecentForActiveTenant: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceOrdersService,
        { provide: FirebaseService, useFactory: () => firebase },
        { provide: VehiclesService, useFactory: () => vehiclesService },
        {
          provide: NotificationsService,
          useFactory: () => notificationsService,
        },
        { provide: ServiceOrdersRepository, useFactory: () => serviceOrders },
        { provide: VehicleFieldsRepository, useFactory: () => vehicleFields },
        {
          provide: DocumentationLookupRepository,
          useFactory: () => documentationLookup,
        },
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
        status: VehicleStatus.POR_ARRIBAR,
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
      documentationLookup.findByVehicleId.mockResolvedValue(null);

      await expect(
        service.create({ vehicleId: 'v1' } as any, jefeTaller),
      ).rejects.toThrow(BadRequestException);
    });

    it('crea la OT delegando la escritura al repositorio, sin llamar a Firestore directamente', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v1',
        status: VehicleStatus.CERTIFICADO_STOCK,
        sede: SedeEnum.SURMOTOR,
        chassis: 'XYZ123',
      });
      documentationLookup.findByVehicleId.mockResolvedValue({
        accessories: [{ key: 'laminas', classification: 'VENDIDO' }],
      });

      const result = await service.create(
        { vehicleId: 'v1', orderNumber: 'OT-1' } as any,
        jefeTaller,
      );

      expect(serviceOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleId: 'v1', orderNumber: 'OT-1' }),
        expect.any(String),
      );
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.ORDEN_GENERADA,
        jefeTaller,
        expect.any(Object),
      );
      expect(result).toEqual(expect.objectContaining({ orderNumber: 'OT-1' }));
    });
  });

  // ── multi-tenancy ────────────────────────────────────────────────────────
  describe('multi-tenancy', () => {
    it('create() nunca construye ni envía un tenantId propio al repositorio — lo resuelve el contexto', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v1',
        status: VehicleStatus.CERTIFICADO_STOCK,
        sede: SedeEnum.SURMOTOR,
        chassis: 'XYZ123',
      });
      documentationLookup.findByVehicleId.mockResolvedValue({
        accessories: [{ key: 'laminas', classification: 'VENDIDO' }],
      });

      await service.create({ vehicleId: 'v1' } as any, jefeTaller);

      expect(serviceOrders.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ tenantId: expect.anything() }),
        expect.any(String),
      );
    });

    it('findOne() propaga 404 cuando el repositorio no encuentra la OT (cross-tenant se ve como inexistente)', async () => {
      serviceOrders.findByIdOrThrow.mockRejectedValue(
        new NotFoundException('Orden de trabajo no encontrada'),
      );

      await expect(service.findOne('ot-de-otro-tenant')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fallo cerrado: el error del repositorio por falta de contexto se propaga sin ser absorbido', async () => {
      serviceOrders.findByIdOrThrow.mockRejectedValue(
        new InternalServerErrorException(
          'Operación ejecutada fuera de un contexto de tenant.',
        ),
      );

      await expect(service.findOne('ot-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('assignTechnician() usa el puente de vehicles (nunca Firestore crudo) para vehículos ya avanzados', async () => {
      serviceOrders.findByIdOrThrow.mockResolvedValue({
        id: 'ot-1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        sede: SedeEnum.SURMOTOR,
        status: 'GENERADA',
        assignedTechnicianId: null,
        assignedTechnicianName: null,
      } as any);
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        status: VehicleStatus.EN_INSTALACION,
        chassis: 'XYZ123',
      });

      await service.assignTechnician(
        'ot-1',
        { technicianUid: 'tech-1', technicianName: 'Carlos' } as any,
        jefeTaller,
      );

      expect(vehicleFields.updateFields).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ assignedTechnicianId: 'tech-1' }),
      );
    });
  });

  // ── getPredictions() ──────────────────────────────────────────────────────────
  describe('getPredictions()', () => {
    it('should return empty array when documentation does not exist', async () => {
      documentationLookup.findByVehicleId.mockResolvedValue(null);

      const result = await service.getPredictions('unknown-vehicle');
      expect(result).toEqual([]);
    });

    it('should return empty array when no sold accessories in documentation', async () => {
      documentationLookup.findByVehicleId.mockResolvedValue({
        accessories: [
          { key: 'radio', classification: 'NO_APLICA' },
          { key: 'laminado', classification: 'NO_APLICA' },
        ],
      });

      const result = await service.getPredictions('v1');
      expect(result).toEqual([]);
    });

    it('should return predictions above threshold', async () => {
      // v1 has laminas=VENDIDO, alarma=NO_APLICA (unclassified)
      // 3 historical docs: all have laminas=VENDIDO and alarma=VENDIDO → alarma 100% probability
      documentationLookup.findByVehicleId.mockResolvedValue({
        accessories: [
          { key: 'laminas', classification: 'VENDIDO' },
          { key: 'alarma', classification: 'NO_APLICA' },
        ],
      });
      documentationLookup.findRecentForActiveTenant.mockResolvedValue([
        {
          id: 'hist-1',
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'alarma', classification: 'VENDIDO' },
          ],
        },
        {
          id: 'hist-2',
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'alarma', classification: 'VENDIDO' },
          ],
        },
        {
          id: 'hist-3',
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'alarma', classification: 'VENDIDO' },
          ],
        },
      ]);

      process.env.PREDICTION_THRESHOLD = '40';
      const result = await service.getPredictions('v1');

      // alarma appeared 3/3 = 100% > 40% threshold
      expect(Array.isArray(result)).toBe(true);
      const alarmaPrediction = result.find((p) => p.key === 'alarma');
      expect(alarmaPrediction).toBeDefined();
      expect(alarmaPrediction!.probability).toBeGreaterThanOrEqual(40);
    });

    it('pide el histórico al puente ya acotado al tenant — nunca escanea Firestore por su cuenta', async () => {
      documentationLookup.findByVehicleId.mockResolvedValue({
        accessories: [{ key: 'laminas', classification: 'VENDIDO' }],
      });

      await service.getPredictions('v1');

      expect(
        documentationLookup.findRecentForActiveTenant,
      ).toHaveBeenCalledWith(500);
    });
  });

  // ── findAll() ─────────────────────────────────────────────────────────────
  describe('findAll()', () => {
    it('parte de la query ya acotada al tenant y filtra por rol', async () => {
      const query = makeFakeQuery([]);
      serviceOrders.query.mockReturnValue(query);

      const technician: AuthenticatedUser = {
        ...jefeTaller,
        role: RoleEnum.PERSONAL_TALLER,
        uid: 'tech-1',
      };

      await service.findAll(technician);

      expect(serviceOrders.query).toHaveBeenCalled();
      expect(query.where).toHaveBeenCalledWith(
        'assignedTechnicianId',
        '==',
        'tech-1',
      );
    });

    it('pagina en memoria los resultados devueltos por la query', async () => {
      const docs = Array.from({ length: 3 }, (_, i) => ({
        id: `ot-${i}`,
        data: () => ({
          status: 'GENERADA',
          createdAt: { _seconds: i },
        }),
      }));
      serviceOrders.query.mockReturnValue(makeFakeQuery(docs));

      const result = await service.findAll(jefeTaller, { page: 1, limit: 2 });

      expect(result.total).toBe(3);
      expect(result.data).toHaveLength(2);
    });
  });

  // ── Aislamiento del algoritmo de predicción (hallazgo crítico) ─────────────
  describe('aislamiento del algoritmo de predicción entre concesionarios', () => {
    it('getPredictions() nunca deriva probabilidades del histórico de OTRO concesionario', async () => {
      // Firestore real (mockeado) con documentaciones de DOS concesionarios:
      // kia-quito siempre vende "alarma" junto con "laminas", mazda-guayaquil
      // siempre vende "aros" junto con "laminas". Si el aislamiento fallara,
      // la predicción de kia-quito mostraría "aros" (patrón ajeno).
      const kiaDocs = Array.from({ length: 5 }, (_, i) => ({
        id: `kia-${i}`,
        data: () => ({
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'alarma', classification: 'VENDIDO' },
          ],
        }),
      }));
      const mazdaDocs = Array.from({ length: 5 }, (_, i) => ({
        id: `mazda-${i}`,
        data: () => ({
          accessories: [
            { key: 'laminas', classification: 'VENDIDO' },
            { key: 'aros', classification: 'VENDIDO' },
          ],
        }),
      }));

      const targetVehicleDoc = {
        exists: true,
        data: () => ({
          accessories: [{ key: 'laminas', classification: 'VENDIDO' }],
        }),
      };

      const whereMock = jest.fn(
        (_f: string, _op: string, tenantId: string) => ({
          orderBy: () => ({
            limit: () => ({
              get: () =>
                Promise.resolve({
                  docs: tenantId === 'kia-quito' ? kiaDocs : mazdaDocs,
                }),
            }),
          }),
        }),
      );
      const docMock = jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue(targetVehicleDoc),
      });
      const collectionMock = jest
        .fn()
        .mockReturnValue({ doc: docMock, where: whereMock });
      const realFirebase = {
        rawFirestore: jest.fn().mockReturnValue({ collection: collectionMock }),
      };

      const realDocumentationLookup = new DocumentationLookupRepository(
        realFirebase as never,
      );

      const svc = new ServiceOrdersService(
        firebase as never,
        vehiclesService as never,
        notificationsService as never,
        serviceOrders as never,
        vehicleFields as never,
        realDocumentationLookup,
      );

      process.env.PREDICTION_THRESHOLD = '40';

      const kiaPredictions = await TenantContext.run(
        makeContext({ tenantId: 'kia-quito' }),
        () => svc.getPredictions('vehicle-1'),
      );

      const keys = kiaPredictions.map((p) => p.key);
      expect(keys).toContain('alarma');
      expect(keys).not.toContain('aros');

      const mazdaPredictions = await TenantContext.run(
        makeContext({ tenantId: 'mazda-guayaquil' }),
        () => svc.getPredictions('vehicle-1'),
      );

      const mazdaKeys = mazdaPredictions.map((p) => p.key);
      expect(mazdaKeys).toContain('aros');
      expect(mazdaKeys).not.toContain('alarma');
    });
  });

  // ── updateChecklist() ───────────────────────────────────────────────────
  describe('updateChecklist()', () => {
    const technician: AuthenticatedUser = {
      ...jefeTaller,
      role: RoleEnum.PERSONAL_TALLER,
      uid: 'tech-1',
    };

    beforeEach(() => {
      serviceOrders.findByIdOrThrow.mockResolvedValue({
        id: 'ot-1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        sede: SedeEnum.SURMOTOR,
        status: 'ASIGNADA',
        assignedTechnicianId: 'tech-1',
        checklist: [
          { key: 'alarma', installed: false },
          { key: 'aros', installed: false },
        ],
      } as any);
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        status: VehicleStatus.EN_INSTALACION,
        chassis: 'XYZ123',
      });
    });

    it('marca un ítem del checklist y persiste vía el repositorio', async () => {
      const result = await service.updateChecklist(
        'ot-1',
        { accessoryKey: 'alarma', installed: true } as any,
        technician,
      );

      expect(serviceOrders.update).toHaveBeenCalledWith(
        'ot-1',
        expect.objectContaining({
          checklist: expect.arrayContaining([
            expect.objectContaining({ key: 'alarma', installed: true }),
          ]),
          status: 'EN_INSTALACION',
        }),
      );
      expect(result.allInstalled).toBe(false);
    });

    it('al completar todos los ítems, avanza la OT y el vehículo a INSTALACION_COMPLETA', async () => {
      serviceOrders.findByIdOrThrow.mockResolvedValue({
        id: 'ot-1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        sede: SedeEnum.SURMOTOR,
        status: 'ASIGNADA',
        assignedTechnicianId: 'tech-1',
        checklist: [{ key: 'alarma', installed: false }],
      } as any);

      const result = await service.updateChecklist(
        'ot-1',
        { accessoryKey: 'alarma', installed: true } as any,
        technician,
      );

      expect(result.allInstalled).toBe(true);
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.INSTALACION_COMPLETA,
        technician,
        expect.any(Object),
      );
    });

    it('rechaza si el técnico no es el asignado a la OT', async () => {
      await expect(
        service.updateChecklist(
          'ot-1',
          { accessoryKey: 'alarma', installed: true } as any,
          { ...technician, uid: 'otro-tecnico' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza si el accesorio no existe en el checklist', async () => {
      await expect(
        service.updateChecklist(
          'ot-1',
          { accessoryKey: 'inexistente', installed: true } as any,
          technician,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza si la OT no está en un estado editable', async () => {
      serviceOrders.findByIdOrThrow.mockResolvedValue({
        id: 'ot-1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        sede: SedeEnum.SURMOTOR,
        status: 'LISTO_PARA_ENTREGA',
        assignedTechnicianId: 'tech-1',
        checklist: [],
      } as any);

      await expect(
        service.updateChecklist(
          'ot-1',
          { accessoryKey: 'alarma', installed: true } as any,
          technician,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── markReadyForDelivery() ──────────────────────────────────────────────
  describe('markReadyForDelivery()', () => {
    beforeEach(() => {
      serviceOrders.findByIdOrThrow.mockResolvedValue({
        id: 'ot-1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        sede: SedeEnum.SURMOTOR,
        status: 'INSTALACION_COMPLETA',
      } as any);
    });

    it('aprueba la instalación y marca la OT como LISTO_PARA_ENTREGA', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        status: VehicleStatus.INSTALACION_COMPLETA,
        chassis: 'XYZ123',
      });

      const result = await service.markReadyForDelivery('ot-1', jefeTaller);

      expect(serviceOrders.update).toHaveBeenCalledWith(
        'ot-1',
        expect.objectContaining({ status: 'LISTO_PARA_ENTREGA' }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          orderId: 'ot-1',
          vehicleId: 'v1',
          newStatus: VehicleStatus.LISTO_PARA_ENTREGA,
        }),
      );
    });

    it('rechaza si la instalación del vehículo no está completa', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        status: VehicleStatus.EN_INSTALACION,
        chassis: 'XYZ123',
      });

      await expect(
        service.markReadyForDelivery('ot-1', jefeTaller),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza roles sin permiso', async () => {
      const asesor: AuthenticatedUser = {
        ...jefeTaller,
        role: RoleEnum.ASESOR,
      };

      await expect(
        service.markReadyForDelivery('ot-1', asesor),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── reopenOrder() ────────────────────────────────────────────────────────
  describe('reopenOrder()', () => {
    it('guarda los datos de reapertura vía el puente de vehicles y cambia el estado', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        status: VehicleStatus.INSTALACION_COMPLETA,
        chassis: 'XYZ123',
        sede: SedeEnum.SURMOTOR,
      });

      const result = await service.reopenOrder(
        {
          vehicleId: 'v1',
          newAccessories: ['alarma'],
          reason: 'Cliente solicitó accesorio adicional',
        } as any,
        jefeTaller,
      );

      expect(vehicleFields.updateFields).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({
          isReopening: true,
          reopenReason: 'Cliente solicitó accesorio adicional',
          reopenAccessories: ['alarma'],
        }),
      );
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.DOCUMENTACION_PENDIENTE,
        jefeTaller,
        expect.any(Object),
      );
      expect(result.isReopening).toBe(true);
    });

    it('rechaza si el vehículo no está en un estado reabrible', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
        chassis: 'XYZ123',
        sede: SedeEnum.SURMOTOR,
      });

      await expect(
        service.reopenOrder(
          {
            vehicleId: 'v1',
            newAccessories: ['alarma'],
            reason: 'motivo',
          } as any,
          jefeTaller,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(vehicleFields.updateFields).not.toHaveBeenCalled();
    });
  });

  // ── completeInstallation() ──────────────────────────────────────────────
  describe('completeInstallation()', () => {
    it('finaliza manualmente la instalación y actualiza el checklist completo', async () => {
      serviceOrders.findByIdOrThrow.mockResolvedValue({
        id: 'ot-1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        sede: SedeEnum.SURMOTOR,
        status: 'ASIGNADA',
        assignedTechnicianId: 'tech-1',
        checklist: [{ key: 'alarma', installed: false }],
      } as any);
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        status: VehicleStatus.ASIGNADO,
        chassis: 'XYZ123',
      });

      const technician: AuthenticatedUser = {
        ...jefeTaller,
        role: RoleEnum.PERSONAL_TALLER,
        uid: 'tech-1',
      };

      await service.completeInstallation('ot-1', technician);

      expect(serviceOrders.update).toHaveBeenCalledWith(
        'ot-1',
        expect.objectContaining({
          status: 'INSTALACION_COMPLETA',
          checklist: [{ key: 'alarma', installed: true }],
        }),
      );
    });

    it('rechaza si quien finaliza no es el técnico asignado ni tiene rol de override', async () => {
      serviceOrders.findByIdOrThrow.mockResolvedValue({
        id: 'ot-1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        sede: SedeEnum.SURMOTOR,
        status: 'ASIGNADA',
        assignedTechnicianId: 'tech-1',
        checklist: [],
      } as any);

      const otroTecnico: AuthenticatedUser = {
        ...jefeTaller,
        role: RoleEnum.PERSONAL_TALLER,
        uid: 'otro-tecnico',
      };

      await expect(
        service.completeInstallation('ot-1', otroTecnico),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
