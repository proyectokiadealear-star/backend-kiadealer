import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { ServiceOrderLookupRepository } from './service-order-lookup.repository';

const makeContext = (
  overrides: Partial<TenantContextData> = {},
): TenantContextData => ({
  tenantId: 'kia-quito',
  userId: 'user-1',
  role: RoleEnum.DOCUMENTACION,
  establishmentIds: ['surmotor'],
  platformAdmin: false,
  requestId: 'req-1',
  ...overrides,
});

describe('ServiceOrderLookupRepository', () => {
  let repository: ServiceOrderLookupRepository;
  let docRef: { get: jest.Mock; update: jest.Mock };
  let whereRef: { get: jest.Mock };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };

  beforeEach(() => {
    docRef = {
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    whereRef = { get: jest.fn() };
    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn().mockReturnValue(whereRef),
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };

    repository = new ServiceOrderLookupRepository(firebase as never);
  });

  describe('findLatestByVehicleId()', () => {
    it('consulta por vehicleId y devuelve la OT más reciente del propio concesionario', async () => {
      whereRef.get.mockResolvedValue({
        docs: [
          {
            id: 'order-old',
            data: () => ({
              tenantId: 'kia-quito',
              createdAt: { _seconds: 100 },
            }),
          },
          {
            id: 'order-new',
            data: () => ({
              tenantId: 'kia-quito',
              createdAt: { _seconds: 200 },
            }),
          },
        ],
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findLatestByVehicleId('vehicle-1'),
      );

      expect(collectionRef.where).toHaveBeenCalledWith(
        'vehicleId',
        '==',
        'vehicle-1',
      );
      expect(result).toEqual({
        id: 'order-new',
        tenantId: 'kia-quito',
        createdAt: { _seconds: 200 },
      });
    });

    it('nunca devuelve una OT de otro concesionario, aunque sea más reciente', async () => {
      whereRef.get.mockResolvedValue({
        docs: [
          {
            id: 'order-foreign',
            data: () => ({
              tenantId: 'mazda-guayaquil',
              createdAt: { _seconds: 999 },
            }),
          },
          {
            id: 'order-own',
            data: () => ({
              tenantId: 'kia-quito',
              createdAt: { _seconds: 100 },
            }),
          },
        ],
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findLatestByVehicleId('vehicle-1'),
      );

      expect(result).toEqual({
        id: 'order-own',
        tenantId: 'kia-quito',
        createdAt: { _seconds: 100 },
      });
    });

    it('devuelve null cuando no hay OTs accesibles', async () => {
      whereRef.get.mockResolvedValue({ docs: [] });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findLatestByVehicleId('vehicle-1'),
      );

      expect(result).toBeNull();
    });

    it('tolera una OT pre-migración sin tenantId', async () => {
      // `service-orders` todavía no migró. Ver MigrationBridgeRepository.
      whereRef.get.mockResolvedValue({
        docs: [
          {
            id: 'order-legacy',
            data: () => ({ createdAt: { _seconds: 50 } }),
          },
        ],
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findLatestByVehicleId('vehicle-1'),
      );

      expect(result).toEqual({
        id: 'order-legacy',
        createdAt: { _seconds: 50 },
      });
    });

    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      await expect(
        repository.findLatestByVehicleId('vehicle-1'),
      ).rejects.toThrow(InternalServerErrorException);
      expect(whereRef.get).not.toHaveBeenCalled();
    });
  });

  describe('updateFields()', () => {
    const givenOrder = (data: Record<string, unknown> | null) => {
      docRef.get.mockResolvedValue(
        data
          ? { exists: true, data: () => data }
          : { exists: false, data: () => undefined },
      );
    };

    it('actualiza una OT del propio concesionario', async () => {
      givenOrder({ tenantId: 'kia-quito' });

      const applied = await TenantContext.run(makeContext(), () =>
        repository.updateFields('order-1', { status: 'ASIGNADA' }),
      );

      expect(applied).toBe(true);
      expect(docRef.update).toHaveBeenCalledWith({ status: 'ASIGNADA' });
    });

    it('NO escribe sobre una OT de otro concesionario', async () => {
      givenOrder({ tenantId: 'mazda-guayaquil' });

      const applied = await TenantContext.run(makeContext(), () =>
        repository.updateFields('order-1', { status: 'ASIGNADA' }),
      );

      expect(applied).toBe(false);
      expect(docRef.update).not.toHaveBeenCalled();
    });

    it('NO escribe si la OT no existe', async () => {
      givenOrder(null);

      const applied = await TenantContext.run(makeContext(), () =>
        repository.updateFields('order-1', { status: 'ASIGNADA' }),
      );

      expect(applied).toBe(false);
      expect(docRef.update).not.toHaveBeenCalled();
    });

    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      givenOrder({ tenantId: 'kia-quito' });

      await expect(
        repository.updateFields('order-1', { status: 'ASIGNADA' }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
