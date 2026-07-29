import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { VehicleLookupRepository } from './vehicle-lookup.repository';

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

type FakeDoc = { id: string; data: Record<string, unknown> | null };

describe('VehicleLookupRepository', () => {
  let repository: VehicleLookupRepository;
  let docRefs: Record<string, { get: jest.Mock }>;
  let allDocs: FakeDoc[];
  let whereMock: jest.Mock;
  let collectionGetMock: jest.Mock;
  let collectionRef: { doc: jest.Mock; get: jest.Mock; where: jest.Mock };

  const givenVehicle = (id: string, data: Record<string, unknown> | null) => {
    docRefs[id] = {
      get: jest
        .fn()
        .mockResolvedValue(
          data
            ? { exists: true, data: () => data }
            : { exists: false, data: () => undefined },
        ),
    };
  };

  const toSnapshot = (docs: FakeDoc[]) => ({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  });

  beforeEach(() => {
    docRefs = {};
    allDocs = [];
    collectionGetMock = jest.fn(() => Promise.resolve(toSnapshot(allDocs)));
    whereMock = jest.fn(() => ({
      get: jest.fn(() => Promise.resolve(toSnapshot(allDocs))),
    }));
    collectionRef = {
      doc: jest.fn((id: string) => docRefs[id]),
      get: collectionGetMock,
      where: whereMock,
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };

    repository = new VehicleLookupRepository(firebase as never);
  });

  describe('findByIdAccessible()', () => {
    it('devuelve el vehículo con su id cuando pertenece al tenant activo', async () => {
      givenVehicle('v1', { tenantId: 'kia-quito', model: 'Sportage' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByIdAccessible('v1'),
      );

      expect(result).toEqual({
        id: 'v1',
        tenantId: 'kia-quito',
        model: 'Sportage',
      });
    });

    it('devuelve null (→404, nunca 403) para un vehículo de otro concesionario', async () => {
      givenVehicle('v1', { tenantId: 'mazda-guayaquil', model: 'CX-5' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByIdAccessible('v1'),
      );

      expect(result).toBeNull();
    });

    it('tolera un vehículo pre-migración sin tenantId', async () => {
      givenVehicle('v1', { model: 'Sportage sin tenant' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByIdAccessible('v1'),
      );

      expect(result).toEqual({ id: 'v1', model: 'Sportage sin tenant' });
    });

    it('devuelve null si el vehículo no existe', async () => {
      givenVehicle('v1', null);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByIdAccessible('v1'),
      );

      expect(result).toBeNull();
    });

    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      givenVehicle('v1', { tenantId: 'kia-quito' });

      await expect(repository.findByIdAccessible('v1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('findAllAccessible()', () => {
    it('excluye vehículos de otros concesionarios e incluye los propios y los pre-migración', async () => {
      allDocs = [
        { id: 'v-own', data: { tenantId: 'kia-quito', model: 'Sportage' } },
        { id: 'v-other', data: { tenantId: 'mazda-guayaquil', model: 'CX-5' } },
        { id: 'v-legacy', data: { model: 'Rio sin tenant' } },
      ];

      const result = await TenantContext.run(makeContext(), () =>
        repository.findAllAccessible(),
      );

      expect(result).toEqual([
        { id: 'v-own', tenantId: 'kia-quito', model: 'Sportage' },
        { id: 'v-legacy', model: 'Rio sin tenant' },
      ]);
    });

    it('devuelve un arreglo vacío cuando la colección está vacía', async () => {
      allDocs = [];

      const result = await TenantContext.run(makeContext(), () =>
        repository.findAllAccessible(),
      );

      expect(result).toEqual([]);
    });

    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      allDocs = [{ id: 'v1', data: { tenantId: 'kia-quito' } }];

      await expect(repository.findAllAccessible()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('findByAssignedTechnician()', () => {
    it('filtra server-side por técnico y, en memoria, por accesibilidad de tenant', async () => {
      allDocs = [
        {
          id: 'v-own',
          data: {
            tenantId: 'kia-quito',
            assignedTechnicianUid: 'tech-1',
            status: 'ENTREGADO',
          },
        },
        {
          id: 'v-other-tenant',
          data: {
            tenantId: 'mazda-guayaquil',
            assignedTechnicianUid: 'tech-1',
            status: 'ENTREGADO',
          },
        },
      ];

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByAssignedTechnician('tech-1'),
      );

      expect(whereMock).toHaveBeenCalledWith(
        'assignedTechnicianUid',
        '==',
        'tech-1',
      );
      // El hallazgo que corrige este puente: un `uid` de técnico no alcanza
      // como límite de aislamiento — el vehículo de otro concesionario con el
      // mismo assignedTechnicianUid queda afuera igual.
      expect(result).toEqual([
        {
          id: 'v-own',
          tenantId: 'kia-quito',
          assignedTechnicianUid: 'tech-1',
          status: 'ENTREGADO',
        },
      ]);
    });

    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      // Al menos un doc en el snapshot: la excepción sale de isAccessible()
      // al evaluar el filtro, no de collection().where().get() en sí.
      allDocs = [{ id: 'v1', data: { tenantId: 'kia-quito' } }];

      await expect(
        repository.findByAssignedTechnician('tech-1'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
