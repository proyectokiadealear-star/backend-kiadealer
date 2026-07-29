import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { VehiclesRepository } from './vehicles.repository';

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

describe('VehiclesRepository', () => {
  let repository: VehiclesRepository;
  let vehicleDocRef: {
    get: jest.Mock;
    set: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    collection: jest.Mock;
    id: string;
  };
  let historyCollection: {
    orderBy: jest.Mock;
    get: jest.Mock;
    add: jest.Mock;
  };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };
  let scopedQuery: { where: jest.Mock; get: jest.Mock };
  let batch: { set: jest.Mock; delete: jest.Mock; commit: jest.Mock };
  let audit: { recordCrossTenantAttempt: jest.Mock };

  const givenVehicle = (data: Record<string, unknown> | null) => {
    vehicleDocRef.get.mockResolvedValue(
      data
        ? { exists: true, id: 'v1', data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  const givenHistory = (entries: { id: string; data: unknown }[]) => {
    historyCollection.get.mockResolvedValue({
      size: entries.length,
      docs: entries.map((entry) => ({
        id: entry.id,
        data: () => entry.data,
        ref: { path: `vehicles/v1/statusHistory/${entry.id}` },
      })),
    });
  };

  beforeEach(() => {
    historyCollection = {
      orderBy: jest.fn(),
      get: jest.fn().mockResolvedValue({ size: 0, docs: [] }),
      add: jest.fn().mockResolvedValue(undefined),
    };
    historyCollection.orderBy.mockReturnValue(historyCollection);

    vehicleDocRef = {
      id: 'v1',
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      collection: jest.fn().mockReturnValue(historyCollection),
    };

    scopedQuery = {
      where: jest.fn(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    };
    scopedQuery.where.mockReturnValue(scopedQuery);

    collectionRef = {
      doc: jest.fn().mockReturnValue(vehicleDocRef),
      where: jest.fn().mockReturnValue(scopedQuery),
    };

    batch = {
      set: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
        batch: jest.fn().mockReturnValue(batch),
      }),
    };
    audit = {
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };

    repository = new VehiclesRepository(firebase as never, audit as never);
  });

  describe('query()', () => {
    it('devuelve una consulta ya acotada al concesionario', () => {
      TenantContext.run(makeContext(), () => repository.query());

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
    });

    it('lanza sin contexto de tenant', () => {
      expect(() => repository.query()).toThrow(InternalServerErrorException);
    });
  });

  describe('aislamiento de la subcolección statusHistory', () => {
    // Firestore NO propaga el scope del padre a sus subcolecciones: sin esta
    // verificación, conocer el id de un vehículo ajeno bastaría para leer su
    // historial completo.

    it('getStatusHistory() devuelve null ante un vehículo de otro concesionario', async () => {
      givenVehicle({ tenantId: 'mazda-guayaquil' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.getStatusHistory('v1'),
      );

      expect(result).toBeNull();
      expect(historyCollection.get).not.toHaveBeenCalled();
    });

    it('getStatusHistory() devuelve null si el vehículo no existe', async () => {
      givenVehicle(null);

      const result = await TenantContext.run(makeContext(), () =>
        repository.getStatusHistory('v1'),
      );

      expect(result).toBeNull();
    });

    it('getStatusHistory() distingue "sin historial" de "sin acceso"', async () => {
      givenVehicle({ tenantId: 'kia-quito' });
      givenHistory([]);

      const result = await TenantContext.run(makeContext(), () =>
        repository.getStatusHistory('v1'),
      );

      expect(result).toEqual([]);
    });

    it('getStatusHistory() devuelve el historial del vehículo propio', async () => {
      givenVehicle({ tenantId: 'kia-quito' });
      givenHistory([{ id: 'h1', data: { status: 'DOCUMENTADO' } }]);

      const result = await TenantContext.run(makeContext(), () =>
        repository.getStatusHistory('v1'),
      );

      expect(result).toEqual([{ id: 'h1', status: 'DOCUMENTADO' }]);
      expect(historyCollection.orderBy).toHaveBeenCalledWith(
        'changedAt',
        'desc',
      );
    });

    it('addStatusHistory() no escribe en el historial de un vehículo ajeno', async () => {
      givenVehicle({ tenantId: 'mazda-guayaquil' });

      const written = await TenantContext.run(makeContext(), () =>
        repository.addStatusHistory('v1', {
          status: 'ENTREGADO',
          changedBy: 'user-1',
          changedAt: 'ts',
        }),
      );

      expect(written).toBe(false);
      expect(historyCollection.add).not.toHaveBeenCalled();
    });

    it('addStatusHistory() escribe en el historial del vehículo propio', async () => {
      givenVehicle({ tenantId: 'kia-quito' });

      const written = await TenantContext.run(makeContext(), () =>
        repository.addStatusHistory('v1', {
          status: 'ENTREGADO',
          changedBy: 'user-1',
          changedAt: 'ts',
        }),
      );

      expect(written).toBe(true);
      expect(historyCollection.add).toHaveBeenCalled();
    });

    it('lanza sin contexto de tenant', async () => {
      await expect(repository.getStatusHistory('v1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('deleteManyWithHistory()', () => {
    it('omite los vehículos de otro concesionario sin borrarlos', async () => {
      givenVehicle({ tenantId: 'mazda-guayaquil' });

      const deleted = await TenantContext.run(makeContext(), () =>
        repository.deleteManyWithHistory(['v1']),
      );

      expect(deleted).toEqual([]);
      expect(batch.delete).not.toHaveBeenCalled();
    });

    it('borra el vehículo propio junto con su historial', async () => {
      givenVehicle({ tenantId: 'kia-quito' });
      givenHistory([
        { id: 'h1', data: {} },
        { id: 'h2', data: {} },
      ]);

      const deleted = await TenantContext.run(makeContext(), () =>
        repository.deleteManyWithHistory(['v1']),
      );

      expect(deleted).toEqual(['v1']);
      // 2 entradas de historial + el vehículo
      expect(batch.delete).toHaveBeenCalledTimes(3);
      expect(batch.commit).toHaveBeenCalled();
    });

    it('no confirma ningún batch cuando no hay nada que borrar', async () => {
      givenVehicle(null);

      const deleted = await TenantContext.run(makeContext(), () =>
        repository.deleteManyWithHistory(['v1']),
      );

      expect(deleted).toEqual([]);
      expect(batch.commit).not.toHaveBeenCalled();
    });

    it('devuelve solo los ids efectivamente borrados', async () => {
      vehicleDocRef.get
        .mockResolvedValueOnce({
          exists: true,
          id: 'v1',
          data: () => ({ tenantId: 'kia-quito' }),
        })
        .mockResolvedValueOnce({
          exists: true,
          id: 'v2',
          data: () => ({ tenantId: 'mazda-guayaquil' }),
        });

      const deleted = await TenantContext.run(makeContext(), () =>
        repository.deleteManyWithHistory(['v1', 'v2']),
      );

      expect(deleted).toEqual(['v1']);
    });
  });

  describe('upsertMany()', () => {
    it('fuerza el tenantId del contexto en cada documento', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.upsertMany([
          { id: 'v1', data: { chassis: 'ABC', tenantId: 'mazda-guayaquil' } },
        ]),
      );

      expect(batch.set).toHaveBeenCalledWith(
        vehicleDocRef,
        expect.objectContaining({ tenantId: 'kia-quito' }),
        { merge: true },
      );
    });

    it('usa merge para no borrar campos que el ETL no trae', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.upsertMany([{ id: 'v1', data: { chassis: 'ABC' } }]),
      );

      expect(batch.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { merge: true },
      );
    });

    it('devuelve la cantidad escrita', async () => {
      const written = await TenantContext.run(makeContext(), () =>
        repository.upsertMany([
          { id: 'v1', data: {} },
          { id: 'v2', data: {} },
        ]),
      );

      expect(written).toBe(2);
    });

    it('lanza sin contexto de tenant', async () => {
      await expect(
        repository.upsertMany([{ id: 'v1', data: {} }]),
      ).rejects.toThrow(InternalServerErrorException);
      expect(batch.commit).not.toHaveBeenCalled();
    });

    it('corta en varios batches al superar el límite de 500 de Firestore', async () => {
      const documents = Array.from({ length: 501 }, (_unused, index) => ({
        id: `v${index}`,
        data: {},
      }));

      const written = await TenantContext.run(makeContext(), () =>
        repository.upsertMany(documents),
      );

      expect(written).toBe(501);
      // Uno al llegar a 500 y otro con el documento restante.
      expect(batch.commit).toHaveBeenCalledTimes(2);
    });
  });

  describe('límites de batch en borrado', () => {
    it('cierra el batch en curso cuando el vehículo con su historial no entra', async () => {
      givenVehicle({ tenantId: 'kia-quito' });
      // 300 entradas por vehículo: el segundo no entra en lo que queda del
      // batch (300 + 1 + 300 + 1 supera 500), así que fuerza un corte.
      givenHistory(
        Array.from({ length: 300 }, (_unused, index) => ({
          id: `h${index}`,
          data: {},
        })),
      );

      const deleted = await TenantContext.run(makeContext(), () =>
        repository.deleteManyWithHistory(['v1', 'v2']),
      );

      expect(deleted).toEqual(['v1', 'v2']);
      expect(batch.commit).toHaveBeenCalledTimes(2);
    });
  });
});
