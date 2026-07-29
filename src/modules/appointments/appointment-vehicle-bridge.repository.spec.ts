import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { AppointmentVehicleBridgeRepository } from './appointment-vehicle-bridge.repository';

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

describe('AppointmentVehicleBridgeRepository', () => {
  let repository: AppointmentVehicleBridgeRepository;
  let docRefs: Record<string, { get: jest.Mock }>;
  let collectionRef: { doc: jest.Mock };

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

  beforeEach(() => {
    docRefs = {};
    collectionRef = {
      doc: jest.fn((id: string) => docRefs[id]),
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };

    repository = new AppointmentVehicleBridgeRepository(firebase as never);
  });

  it('lanza si se invoca fuera de un contexto de tenant', async () => {
    givenVehicle('vehicle-1', { tenantId: 'kia-quito' });

    await expect(repository.findManyAccessible(['vehicle-1'])).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('incluye solo los vehículos propios o pre-migración, nunca los de otro tenant', async () => {
    givenVehicle('vehicle-1', { tenantId: 'kia-quito', clientName: 'Ana' });
    givenVehicle('vehicle-2', {
      tenantId: 'mazda-guayaquil',
      clientName: 'Otro',
    });
    givenVehicle('vehicle-3', { clientName: 'Sin tenant (pre-migración)' });
    givenVehicle('vehicle-4', null);

    const result = await TenantContext.run(makeContext(), () =>
      repository.findManyAccessible([
        'vehicle-1',
        'vehicle-2',
        'vehicle-3',
        'vehicle-4',
      ]),
    );

    expect(result.size).toBe(2);
    expect(result.get('vehicle-1')).toEqual(
      expect.objectContaining({ clientName: 'Ana' }),
    );
    expect(result.get('vehicle-3')).toEqual(
      expect.objectContaining({ clientName: 'Sin tenant (pre-migración)' }),
    );
    expect(result.has('vehicle-2')).toBe(false);
    expect(result.has('vehicle-4')).toBe(false);
  });

  it('devuelve un mapa vacío si no hay ids', async () => {
    const result = await TenantContext.run(makeContext(), () =>
      repository.findManyAccessible([]),
    );

    expect(result.size).toBe(0);
  });
});
