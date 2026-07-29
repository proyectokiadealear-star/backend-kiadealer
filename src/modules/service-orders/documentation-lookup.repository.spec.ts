import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { DocumentationLookupRepository } from './documentation-lookup.repository';

const makeContext = (
  overrides: Partial<TenantContextData> = {},
): TenantContextData => ({
  tenantId: 'kia-quito',
  userId: 'user-1',
  role: RoleEnum.ASESOR,
  establishmentIds: ['surmotor'],
  platformAdmin: false,
  requestId: 'req-1',
  ...overrides,
});

describe('DocumentationLookupRepository', () => {
  let repository: DocumentationLookupRepository;

  // ── mocks para findByVehicleId() (lectura de un solo doc) ──
  let docGetMock: jest.Mock;
  let docMock: jest.Mock;

  // ── mocks para findRecentForActiveTenant() (escaneo histórico) ──
  let queryGetSpy: jest.Mock;
  let whereMock: jest.Mock;

  let collectionMock: jest.Mock;

  const givenVehicleDoc = (data: Record<string, unknown> | null) => {
    docGetMock.mockResolvedValue(
      data
        ? { exists: true, data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  /** Documentaciones "reales" por tenant, tal como las devolvería Firestore
   * si la query `where('tenantId','==',X)` filtrara correctamente. */
  const docsByTenant: Record<
    string,
    Array<{ id: string; data: () => Record<string, unknown> }>
  > = {
    'kia-quito': [
      {
        id: 'doc-kia-1',
        data: () => ({
          accessories: [{ key: 'alarma', classification: 'VENDIDO' }],
        }),
      },
      {
        id: 'doc-kia-2',
        data: () => ({ accessories: [] }), // sin accesorios — se descarta
      },
    ],
    'mazda-guayaquil': [
      {
        id: 'doc-mazda-1',
        data: () => ({
          accessories: [{ key: 'aros', classification: 'VENDIDO' }],
        }),
      },
    ],
  };

  beforeEach(() => {
    docGetMock = jest.fn();
    docMock = jest.fn().mockReturnValue({ get: docGetMock });

    queryGetSpy = jest.fn((tenantId: string) =>
      Promise.resolve({ docs: docsByTenant[tenantId] ?? [] }),
    );
    whereMock = jest.fn((_field: string, _op: string, value: string) => ({
      orderBy: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn(() => queryGetSpy(value)),
        }),
      }),
    }));

    collectionMock = jest.fn().mockReturnValue({
      doc: docMock,
      where: whereMock,
    });

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({ collection: collectionMock }),
    };

    repository = new DocumentationLookupRepository(firebase as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findByVehicleId() — lectura de un solo vehículo', () => {
    it('devuelve la documentación del propio concesionario', async () => {
      givenVehicleDoc({ tenantId: 'kia-quito', accessories: [] });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByVehicleId('vehicle-1'),
      );

      expect(result).toEqual({ tenantId: 'kia-quito', accessories: [] });
    });

    it('devuelve null ante documentación de otro concesionario', async () => {
      givenVehicleDoc({ tenantId: 'mazda-guayaquil', accessories: [] });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByVehicleId('vehicle-1'),
      );

      expect(result).toBeNull();
    });

    it('devuelve null si no existe documentación', async () => {
      givenVehicleDoc(null);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByVehicleId('vehicle-1'),
      );

      expect(result).toBeNull();
    });

    it('tolera documentación pre-migración sin tenantId', async () => {
      givenVehicleDoc({ accessories: [] });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByVehicleId('vehicle-1'),
      );

      expect(result).toEqual({ accessories: [] });
    });

    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      givenVehicleDoc({ tenantId: 'kia-quito', accessories: [] });

      await expect(repository.findByVehicleId('vehicle-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ── El hallazgo crítico: el histórico de predicción NO debe filtrarse ──
  describe('findRecentForActiveTenant() — aislamiento del algoritmo de predicción', () => {
    it('lanza si se invoca fuera de un contexto de tenant, sin llegar a consultar Firestore', async () => {
      await expect(repository.findRecentForActiveTenant(500)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(whereMock).not.toHaveBeenCalled();
    });

    it('consulta con where(tenantId == concesionario activo) — nunca trae todo el histórico sin filtrar', async () => {
      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.findRecentForActiveTenant(500),
      );

      expect(whereMock).toHaveBeenCalledWith('tenantId', '==', 'kia-quito');
    });

    it('el histórico de un concesionario jamás incluye documentos de otro (fuga de inteligencia comercial)', async () => {
      const resultKia = await TenantContext.run(
        makeContext({ tenantId: 'kia-quito' }),
        () => repository.findRecentForActiveTenant(500),
      );

      const idsKia = resultKia.map((e) => e.id);
      expect(idsKia).toContain('doc-kia-1');
      expect(idsKia).not.toContain('doc-mazda-1');
    });

    it('dos concesionarios distintos obtienen históricos separados desde la misma instancia del repositorio', async () => {
      const resultKia = await TenantContext.run(
        makeContext({ tenantId: 'kia-quito' }),
        () => repository.findRecentForActiveTenant(500),
      );
      const resultMazda = await TenantContext.run(
        makeContext({ tenantId: 'mazda-guayaquil' }),
        () => repository.findRecentForActiveTenant(500),
      );

      expect(resultKia.map((e) => e.id)).toEqual(['doc-kia-1']);
      expect(resultMazda.map((e) => e.id)).toEqual(['doc-mazda-1']);
    });

    it('descarta documentos sin accesorios', async () => {
      const resultKia = await TenantContext.run(
        makeContext({ tenantId: 'kia-quito' }),
        () => repository.findRecentForActiveTenant(500),
      );

      expect(resultKia.map((e) => e.id)).not.toContain('doc-kia-2');
    });

    it('cachea el histórico por tenant durante el TTL — no repite el escaneo en cada request', async () => {
      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.findRecentForActiveTenant(500),
      );
      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.findRecentForActiveTenant(500),
      );

      expect(queryGetSpy).toHaveBeenCalledTimes(1);
    });

    it('la caché de un tenant no sirve resultados a otro (indexada por tenantId, no global)', async () => {
      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.findRecentForActiveTenant(500),
      );
      const resultMazda = await TenantContext.run(
        makeContext({ tenantId: 'mazda-guayaquil' }),
        () => repository.findRecentForActiveTenant(500),
      );

      // Si la caché fuera global (el bug original), esta segunda llamada
      // devolvería el histórico de kia-quito servido desde caché en vez de
      // volver a consultar Firestore con el tenant correcto.
      expect(queryGetSpy).toHaveBeenCalledTimes(2);
      expect(resultMazda.map((e) => e.id)).toEqual(['doc-mazda-1']);
    });

    it('refresca el histórico una vez vencido el TTL', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);

      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.findRecentForActiveTenant(500),
      );

      nowSpy.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1);

      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.findRecentForActiveTenant(500),
      );

      expect(queryGetSpy).toHaveBeenCalledTimes(2);
    });
  });
});
