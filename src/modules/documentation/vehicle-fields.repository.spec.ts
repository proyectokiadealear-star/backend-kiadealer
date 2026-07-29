import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { VehicleFieldsRepository } from './vehicle-fields.repository';

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

describe('VehicleFieldsRepository (documentation)', () => {
  let repository: VehicleFieldsRepository;
  let updateMock: jest.Mock;
  let getMock: jest.Mock;
  let docMock: jest.Mock;
  let collectionMock: jest.Mock;

  const givenVehicle = (data: Record<string, unknown> | null) => {
    getMock.mockResolvedValue(
      data
        ? { exists: true, data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    updateMock = jest.fn().mockResolvedValue(undefined);
    getMock = jest.fn();
    docMock = jest.fn().mockReturnValue({ update: updateMock, get: getMock });
    collectionMock = jest.fn().mockReturnValue({ doc: docMock });

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({ collection: collectionMock }),
    };

    repository = new VehicleFieldsRepository(firebase as never);
  });

  it('actualiza un vehículo del propio concesionario', async () => {
    givenVehicle({ tenantId: 'kia-quito', model: 'Sportage' });

    const applied = await TenantContext.run(makeContext(), () =>
      repository.updateFields('vehicle-1', {
        registrationReceivedDate: '2026-01-01',
      }),
    );

    expect(applied).toBe(true);
    expect(collectionMock).toHaveBeenCalledWith('vehicles');
    expect(docMock).toHaveBeenCalledWith('vehicle-1');
    expect(updateMock).toHaveBeenCalledWith({
      registrationReceivedDate: '2026-01-01',
    });
  });

  it('NO escribe sobre un vehículo de otro concesionario', async () => {
    givenVehicle({ tenantId: 'mazda-guayaquil', model: 'CX-5' });

    const applied = await TenantContext.run(makeContext(), () =>
      repository.updateFields('vehicle-1', { isReopening: false }),
    );

    expect(applied).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('NO escribe si el vehículo no existe', async () => {
    givenVehicle(null);

    const applied = await TenantContext.run(makeContext(), () =>
      repository.updateFields('vehicle-1', { isReopening: false }),
    );

    expect(applied).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('tolera un vehículo pre-migración sin tenantId', async () => {
    // La tolerancia es la razón de ser del puente: `vehicles` todavía no
    // migró y sus documentos no llevan tenantId. Ver MigrationBridgeRepository.
    givenVehicle({ model: 'Sportage' });

    const applied = await TenantContext.run(makeContext(), () =>
      repository.updateFields('vehicle-1', { isReopening: false }),
    );

    expect(applied).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ isReopening: false });
  });

  it('lanza si se invoca fuera de un contexto de tenant', async () => {
    givenVehicle({ tenantId: 'kia-quito' });

    await expect(
      repository.updateFields('vehicle-1', { isReopening: false }),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
