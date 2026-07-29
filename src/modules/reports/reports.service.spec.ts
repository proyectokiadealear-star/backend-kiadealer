import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { VehicleLookupRepository } from './vehicle-lookup.repository';
import {
  ReportServiceOrdersRepository,
  ReportDocumentationsRepository,
  ReportDeliveryCeremoniesRepository,
  ReportAppointmentsRepository,
  ReportAccessoriesCatalogRepository,
} from './reports.repository';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ALL_VEHICLE_STATUSES } from './contracts/analytics.contract';

type DocRow = { id: string; [key: string]: any };

describe('ReportsService', () => {
  let service: ReportsService;
  let vehicleLookup: jest.Mocked<
    Pick<
      VehicleLookupRepository,
      'findAllAccessible' | 'findByIdAccessible' | 'findByAssignedTechnician'
    >
  >;
  let serviceOrders: jest.Mocked<
    Pick<ReportServiceOrdersRepository, 'findAll'>
  >;
  let documentations: jest.Mocked<
    Pick<ReportDocumentationsRepository, 'findAll'>
  >;
  let deliveryCeremonies: jest.Mocked<
    Pick<ReportDeliveryCeremoniesRepository, 'findAll'>
  >;
  let appointmentsRepo: jest.Mocked<
    Pick<ReportAppointmentsRepository, 'findAll'>
  >;
  let accessoriesCatalogRepo: jest.Mocked<
    Pick<ReportAccessoriesCatalogRepository, 'findAll'>
  >;

  const user: AuthenticatedUser = {
    uid: 'u-admin',
    email: 'admin@kia.com',
    role: RoleEnum.JEFE_TALLER,
    sede: SedeEnum.ALL,
    active: true,
    displayName: 'Admin',
  };

  const buildService = async (data: {
    vehicles?: DocRow[];
    orders?: DocRow[];
    docs?: DocRow[];
    ceremonies?: DocRow[];
    appointments?: DocRow[];
    accessoriesCatalog?: DocRow[];
  }) => {
    // Cada repositorio ya devuelve datos acotados al tenant activo (eso lo
    // garantiza TenantScopedRepository/MigrationBridgeRepository, testeado
    // aparte en tenant-scoped.repository.spec.ts y
    // vehicle-lookup.repository.spec.ts). Acá solo importa que ReportsService
    // consuma esos repositorios y arme el agregado correctamente — por eso el
    // mock resuelve directamente el arreglo "ya filtrado".
    vehicleLookup = {
      findAllAccessible: jest.fn().mockResolvedValue(data.vehicles ?? []),
      findByIdAccessible: jest.fn(),
      findByAssignedTechnician: jest.fn(),
    };
    serviceOrders = { findAll: jest.fn().mockResolvedValue(data.orders ?? []) };
    documentations = { findAll: jest.fn().mockResolvedValue(data.docs ?? []) };
    deliveryCeremonies = {
      findAll: jest.fn().mockResolvedValue(data.ceremonies ?? []),
    };
    appointmentsRepo = {
      findAll: jest.fn().mockResolvedValue(data.appointments ?? []),
    };
    accessoriesCatalogRepo = {
      findAll: jest.fn().mockResolvedValue(data.accessoriesCatalog ?? []),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: VehicleLookupRepository, useFactory: () => vehicleLookup },
        {
          provide: ReportServiceOrdersRepository,
          useFactory: () => serviceOrders,
        },
        {
          provide: ReportDocumentationsRepository,
          useFactory: () => documentations,
        },
        {
          provide: ReportDeliveryCeremoniesRepository,
          useFactory: () => deliveryCeremonies,
        },
        {
          provide: ReportAppointmentsRepository,
          useFactory: () => appointmentsRepo,
        },
        {
          provide: ReportAccessoriesCatalogRepository,
          useFactory: () => accessoriesCatalogRepo,
        },
      ],
    }).compile();

    return module.get<ReportsService>(ReportsService);
  };

  it('returns deterministic contract and seeded byStatus for empty dataset', async () => {
    service = await buildService({});

    const analytics = await service.getAnalytics(user, {});

    expect(analytics.total).toBe(0);
    expect(analytics.vehiclesDelivered).toBe(0);
    expect(analytics.vehiclesCreatedInPeriod).toBe(0);
    expect(analytics.registrationBacklog).toEqual({
      pendingReception: 0,
      porArribar: 0,
      pendingToRegister: 0,
    });
    expect(analytics.avgDaysToDelivery).toBeNull();
    expect(analytics.medianDaysToDelivery).toBeNull();
    expect(analytics.otif).toEqual({
      numerator: 0,
      denominator: 0,
      valuePct: null,
      missingPromisedDate: 0,
      insufficientData: 0,
      passed: 0,
      failed: 0,
      noEvaluable: 0,
      totalDeliveriesInPeriod: 0,
      totalDeliveriesEvaluable: 0,
      failureReasons: {
        late: 0,
        incomplete_docs: 0,
        incomplete_accessories: 0,
      },
      definitionVersion: 'v1',
    });
    expect(Object.keys(analytics.byStatus)).toEqual(
      expect.arrayContaining(ALL_VEHICLE_STATUSES as unknown as string[]),
    );
    for (const status of ALL_VEHICLE_STATUSES) {
      expect(analytics.byStatus[status]).toBe(0);
    }
  });

  it('reads every collection through its scoped repository, never through Firestore directo', async () => {
    service = await buildService({});

    await service.getAnalytics(user, {});

    expect(vehicleLookup.findAllAccessible).toHaveBeenCalledTimes(1);
    expect(serviceOrders.findAll).toHaveBeenCalledTimes(1);
    expect(documentations.findAll).toHaveBeenCalledTimes(1);
    expect(deliveryCeremonies.findAll).toHaveBeenCalledTimes(1);
    expect(appointmentsRepo.findAll).toHaveBeenCalledTimes(1);
    expect(accessoriesCatalogRepo.findAll).toHaveBeenCalledTimes(1);
  });

  it('applies date semantics by KPI family (inventory ignores date; delivery/events honor date)', async () => {
    service = await buildService({
      accessoriesCatalog: [{ id: 'laminas', key: 'LAMINAS', name: 'LAMINAS' }],
      vehicles: [
        {
          id: 'v1',
          sede: 'SURMOTOR',
          model: 'KIA SPORTAGE',
          color: 'BLANCO',
          status: 'POR_ARRIBAR',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v2',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'NEGRO',
          status: 'ENTREGADO',
          createdAt: '2026-02-01T00:00:00.000Z',
          deliveryDate: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v3',
          sede: 'SURMOTOR',
          model: 'RIO',
          color: 'ROJO',
          status: 'ENTREGADO',
          createdAt: '2026-01-01T00:00:00.000Z',
          deliveryDate: '2026-01-10T00:00:00.000Z',
        },
      ],
      docs: [
        {
          id: 'd1',
          vehicleId: 'v2',
          createdAt: '2026-02-12T00:00:00.000Z',
          accessories: [{ key: 'LAMINAS', classification: 'VENDIDO' }],
        },
        {
          id: 'd2',
          vehicleId: 'v3',
          createdAt: '2026-01-12T00:00:00.000Z',
          accessories: [{ key: 'LAMINAS', classification: 'VENDIDO' }],
        },
      ],
      orders: [
        {
          id: 'o1',
          vehicleId: 'v1',
          createdAt: '2026-02-12T00:00:00.000Z',
          createdBy: 'a1',
          createdByName: 'Asesor 1',
          assignedTechnicianId: 't1',
          assignedTechnicianName: 'Tec 1',
          assignedAt: '2026-02-12T00:00:00.000Z',
        },
        {
          id: 'o2',
          vehicleId: 'v3',
          createdAt: '2026-01-12T00:00:00.000Z',
          createdBy: 'a2',
          createdByName: 'Asesor 2',
          assignedTechnicianId: 't2',
          assignedTechnicianName: 'Tec 2',
          assignedAt: '2026-01-12T00:00:00.000Z',
        },
      ],
      ceremonies: [
        {
          id: 'c1',
          vehicleId: 'v1',
          createdAt: '2026-02-13T00:00:00.000Z',
          deliveredBy: 'a1',
          deliveredByName: 'Asesor 1',
        },
        {
          id: 'c2',
          vehicleId: 'v3',
          createdAt: '2026-01-13T00:00:00.000Z',
          deliveredBy: 'a2',
          deliveredByName: 'Asesor 2',
        },
      ],
    });

    const analytics = await service.getAnalytics(user, {
      dateFrom: '01/02/2026',
      dateTo: '28/02/2026',
    });

    expect(analytics.total).toBe(3);
    expect(analytics.vehiclesDelivered).toBe(1);
    expect(analytics.vehiclesCreatedInPeriod).toBe(2);
    expect(analytics.registrationBacklog).toEqual({
      pendingReception: 0,
      porArribar: 1,
      pendingToRegister: 1,
    });
    expect(analytics.accessories.totalVendido).toBe(1);
    expect(analytics.accessories.totalNoAplica).toBe(0);
    expect(analytics.topAsesores.ordenesGeneradas[0]).toMatchObject({
      uid: 'a1',
      ordenes: 1,
    });
    expect(analytics.topTaller[0]).toMatchObject({ uid: 't1', totalOTs: 1 });
    const deliveriesInSeries = analytics.byMonthlyDeliveries.reduce(
      (sum, item) => sum + item.count,
      0,
    );
    expect(deliveriesInSeries).toBe(1);
  });

  it('counts accessories only for delivered vehicles within filtered scope', async () => {
    service = await buildService({
      accessoriesCatalog: [{ id: 'laminas', key: 'LAMINAS', name: 'LAMINAS' }],
      vehicles: [
        {
          id: 'v-delivered',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'BLANCO',
          status: 'ENTREGADO',
          createdAt: '2026-02-01T00:00:00.000Z',
          deliveryDate: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v-not-delivered',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'NEGRO',
          status: 'DOCUMENTADO',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      docs: [
        {
          id: 'd-delivered',
          vehicleId: 'v-delivered',
          createdAt: '2026-02-11T00:00:00.000Z',
          accessories: [{ key: 'LAMINAS', classification: 'VENDIDO' }],
        },
        {
          id: 'd-not-delivered',
          vehicleId: 'v-not-delivered',
          createdAt: '2026-02-11T00:00:00.000Z',
          accessories: [{ key: 'LAMINAS', classification: 'VENDIDO' }],
        },
      ],
    });

    const analytics = await service.getAnalytics(user, {
      dateFrom: '01/02/2026',
      dateTo: '28/02/2026',
    });

    expect(analytics.accessories.byKey.LAMINAS).toEqual({
      VENDIDO: 1,
      OBSEQUIADO: 0,
      NO_APLICA: 0,
    });
    expect(analytics.accessories.totalVendido).toBe(1);
  });

  it('normalizes model filter and echoes effective filters metadata', async () => {
    service = await buildService({
      vehicles: [
        {
          id: 'v1',
          sede: 'SURMOTOR',
          model: 'KIA SPORTAGE',
          color: 'BLANCO',
          status: 'POR_ARRIBAR',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v2',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'NEGRO',
          status: 'ENTREGADO',
          createdAt: '2026-02-01T00:00:00.000Z',
          deliveryDate: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v3',
          sede: 'SURMOTOR',
          model: 'RIO',
          color: 'ROJO',
          status: 'POR_ARRIBAR',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });

    const analytics = await service.getAnalytics(user, {
      model: 'kia sportage',
      dateFrom: '01/02/2026',
      dateTo: '28/02/2026',
    });

    expect(analytics.total).toBe(2);
    expect(analytics.byModel['RIO']).toBeUndefined();
    expect(analytics.filtersApplied).toEqual({
      sede: null,
      modelNormalized: 'SPORTAGE',
      dateFrom: '01/02/2026',
      dateTo: '28/02/2026',
      groupBy: 'month',
    });
  });

  it('builds pending registration backlog including POR_ARRIBAR and pending reception', async () => {
    service = await buildService({
      vehicles: [
        {
          id: 'v-por-arribar',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'BLANCO',
          status: 'POR_ARRIBAR',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v-enviado-pendiente',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'NEGRO',
          status: 'ENVIADO_A_MATRICULAR',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v-documentado-recibida',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'ROJO',
          status: 'DOCUMENTADO',
          registrationReceivedDate: '2026-02-15',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v-certificado-pendiente',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'AZUL',
          status: 'CERTIFICADO_STOCK',
          registrationReceivedDate: '   ',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'v-otro-modelo',
          sede: 'SURMOTOR',
          model: 'RIO',
          color: 'PLATA',
          status: 'ENVIADO_A_MATRICULAR',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
      ],
    });

    const analytics = await service.getAnalytics(user, {
      model: 'KIA SPORTAGE',
      dateFrom: '01/01/2026',
      dateTo: '31/12/2026',
    });

    expect(analytics.registrationBacklog).toEqual({
      pendingReception: 2,
      porArribar: 1,
      pendingToRegister: 3,
    });
  });

  it('seeds accessories from catalog and normalizes key/classification casing', async () => {
    service = await buildService({
      accessoriesCatalog: [
        { id: 'laminas', key: 'LAMINAS', name: 'LAMINAS' },
        { id: 'alarma', key: 'ALARMA', name: 'ALARMA' },
        { id: 'piso', key: 'PISO', name: 'PISO' },
      ],
      vehicles: [
        {
          id: 'v1',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'BLANCO',
          status: 'ENTREGADO',
          createdAt: '2026-02-01T00:00:00.000Z',
          deliveryDate: '2026-02-10T00:00:00.000Z',
        },
      ],
      docs: [
        {
          id: 'd1',
          vehicleId: 'v1',
          createdAt: '2026-02-10T00:00:00.000Z',
          accessories: [
            { key: 'laminas', classification: 'vendido' },
            { key: 'ALARMA', classification: 'OBSEQUIADO' },
            { key: 'PISO', classification: null },
          ],
        },
      ],
    });

    const analytics = await service.getAnalytics(user, {
      dateFrom: '01/02/2026',
      dateTo: '28/02/2026',
    });

    expect(analytics.accessories.byKey).toEqual({
      LAMINAS: { VENDIDO: 1, OBSEQUIADO: 0, NO_APLICA: 0 },
      ALARMA: { VENDIDO: 0, OBSEQUIADO: 1, NO_APLICA: 0 },
      PISO: { VENDIDO: 0, OBSEQUIADO: 0, NO_APLICA: 1 },
    });
    expect(analytics.accessories.totalVendido).toBe(1);
    expect(analytics.accessories.totalObsequiado).toBe(1);
    expect(analytics.accessories.totalNoAplica).toBe(1);
  });

  it('groups delivery trend by week when groupBy=week', async () => {
    service = await buildService({
      vehicles: [
        {
          id: 'v1',
          sede: 'SURMOTOR',
          model: 'RIO',
          color: 'BLANCO',
          status: 'ENTREGADO',
          createdAt: '2026-03-01T00:00:00.000Z',
          deliveryDate: '2026-03-03T00:00:00.000Z',
        },
        {
          id: 'v2',
          sede: 'SURMOTOR',
          model: 'RIO',
          color: 'NEGRO',
          status: 'ENTREGADO',
          createdAt: '2026-03-01T00:00:00.000Z',
          deliveryDate: '2026-03-05T00:00:00.000Z',
        },
      ],
    });

    const analytics = await service.getAnalytics(user, {
      dateFrom: '01/03/2026',
      dateTo: '31/03/2026',
      groupBy: 'week',
    });

    expect(analytics.deliverySeriesGranularity).toBe('week');
    expect(
      analytics.byMonthlyDeliveries.some((item) => item.month.includes('-W')),
    ).toBe(true);
    const deliveriesInSeries = analytics.byMonthlyDeliveries.reduce(
      (sum, item) => sum + item.count,
      0,
    );
    expect(deliveriesInSeries).toBe(2);
  });

  it('computes OTIF v1 with pass/fail/missing and excludes insufficient data from denominator', async () => {
    service = await buildService({
      vehicles: [
        {
          id: 'v-pass',
          sede: 'SURMOTOR',
          model: 'RIO',
          color: 'BLANCO',
          status: 'ENTREGADO',
          createdAt: '2026-03-01T00:00:00.000Z',
          deliveryDate: '2026-03-10T00:00:00.000Z',
        },
        {
          id: 'v-fail',
          sede: 'SURMOTOR',
          model: 'RIO',
          color: 'NEGRO',
          status: 'ENTREGADO',
          createdAt: '2026-03-01T00:00:00.000Z',
          deliveryDate: '2026-03-15T00:00:00.000Z',
        },
        {
          id: 'v-missing',
          sede: 'SURMOTOR',
          model: 'SONET',
          color: 'ROJO',
          status: 'ENTREGADO',
          createdAt: '2026-03-01T00:00:00.000Z',
          deliveryDate: '2026-03-12T00:00:00.000Z',
        },
        {
          id: 'v-insufficient',
          sede: 'SURMOTOR',
          model: 'SPORTAGE',
          color: 'AZUL',
          status: 'ENTREGADO',
          createdAt: '2026-03-01T00:00:00.000Z',
          deliveryDate: '2026-03-09T00:00:00.000Z',
        },
      ],
      appointments: [
        {
          id: 'a-pass',
          vehicleId: 'v-pass',
          scheduledDate: '2026-03-10',
          status: 'AGENDADO',
        },
        {
          id: 'a-fail',
          vehicleId: 'v-fail',
          scheduledDate: '2026-03-12',
          status: 'AGENDADO',
        },
        {
          id: 'a-insufficient',
          vehicleId: 'v-insufficient',
          scheduledDate: '2026-03-10',
          status: 'AGENDADO',
        },
      ],
      docs: [
        {
          id: 'd-pass',
          vehicleId: 'v-pass',
          documentationStatus: 'COMPLETO',
          accessories: [{ key: 'LAMINAS', classification: 'VENDIDO' }],
        },
        {
          id: 'd-fail',
          vehicleId: 'v-fail',
          documentationStatus: 'COMPLETO',
          accessories: [{ key: 'PISO', classification: 'VENDIDO' }],
        },
        {
          id: 'd-insufficient',
          vehicleId: 'v-insufficient',
          documentationStatus: 'COMPLETO',
          accessories: [{ key: 'ALARMA', classification: 'VENDIDO' }],
        },
      ],
      orders: [
        {
          id: 'o-pass',
          vehicleId: 'v-pass',
          checklist: [{ key: 'LAMINAS', installed: true }],
        },
        {
          id: 'o-fail',
          vehicleId: 'v-fail',
          checklist: [{ key: 'PISO', installed: false }],
        },
      ],
    });

    const analytics = await service.getAnalytics(user, {
      dateFrom: '01/03/2026',
      dateTo: '31/03/2026',
    });

    expect(analytics.otif.numerator).toBe(1);
    expect(analytics.otif.denominator).toBe(2);
    expect(analytics.otif.valuePct).toBe(50);
    expect(analytics.otif.missingPromisedDate).toBe(1);
    expect(analytics.otif.insufficientData).toBe(1);
    expect(analytics.otif.passed).toBe(1);
    expect(analytics.otif.failed).toBe(1);
    expect(analytics.otif.noEvaluable).toBe(2);
    expect(analytics.otif.totalDeliveriesInPeriod).toBe(4);
    expect(analytics.otif.totalDeliveriesEvaluable).toBe(2);
    expect(analytics.otif.failureReasons).toEqual({
      late: 1,
      incomplete_docs: 0,
      incomplete_accessories: 1,
    });
    expect(analytics.otif.definitionVersion).toBe('v1');
  });

  // ── generateVehicleReport() — trazabilidad en PDF ──────────────────────
  describe('generateVehicleReport()', () => {
    it('genera el PDF cuando el vehículo es accesible desde el tenant activo', async () => {
      service = await buildService({});
      vehicleLookup.findByIdAccessible.mockResolvedValue({
        id: 'v1',
        model: 'KIA SPORTAGE',
        vin: 'VIN123',
        status: 'ENTREGADO',
        sede: 'SURMOTOR',
      });

      const buffer = await service.generateVehicleReport('v1', user);

      expect(vehicleLookup.findByIdAccessible).toHaveBeenCalledWith('v1');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('responde 404 (NotFoundException), nunca 403, para un vehículo de otro concesionario', async () => {
      // D-104: acceso cruzado indistinguible de "no existe" — el repositorio
      // ya devuelve null tanto si el vehículo no existe como si es ajeno.
      service = await buildService({});
      vehicleLookup.findByIdAccessible.mockResolvedValue(null);

      await expect(
        service.generateVehicleReport('vehicle-ajeno', user),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getTechnicianPerformance() — corrige el hallazgo más grave ─────────
  describe('getTechnicianPerformance()', () => {
    it('calcula el rendimiento solo con vehículos accesibles del tenant activo', async () => {
      service = await buildService({});
      vehicleLookup.findByAssignedTechnician.mockResolvedValue([
        { id: 'v1', status: 'ENTREGADO' },
        { id: 'v2', status: 'ASIGNADO' },
      ]);

      const result = await service.getTechnicianPerformance('tech-1');

      expect(vehicleLookup.findByAssignedTechnician).toHaveBeenCalledWith(
        'tech-1',
      );
      expect(result).toEqual({
        uid: 'tech-1',
        totalAssigned: 2,
        totalCompleted: 1,
        completionRate: 50,
      });
    });

    it('no filtra por sí sola con el uid del técnico: delega el scope de tenant al repositorio', async () => {
      // Este es el hallazgo original: la consulta vieja solo filtraba por
      // assignedTechnicianUid, sin ningún límite de concesionario. Acá se
      // verifica que ReportsService ya NO arma esa consulta a mano: delega
      // por completo en VehicleLookupRepository, que sí aplica el scope.
      service = await buildService({});
      vehicleLookup.findByAssignedTechnician.mockResolvedValue([]);

      const result = await service.getTechnicianPerformance('tech-ajeno');

      expect(result).toEqual({
        uid: 'tech-ajeno',
        totalAssigned: 0,
        totalCompleted: 0,
        completionRate: 0,
      });
    });
  });
});
