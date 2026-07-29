import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { AppointmentLookupRepository } from './appointment-lookup.repository';

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

describe('AppointmentLookupRepository', () => {
  let repository: AppointmentLookupRepository;
  let docRef: { get: jest.Mock; update: jest.Mock };
  let collectionRef: { doc: jest.Mock };

  const givenAppointment = (data: Record<string, unknown> | null) => {
    docRef.get.mockResolvedValue(
      data
        ? { exists: true, data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    docRef = {
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    collectionRef = { doc: jest.fn().mockReturnValue(docRef) };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };

    repository = new AppointmentLookupRepository(firebase as never);
  });

  describe('findById()', () => {
    it('devuelve el agendamiento del propio concesionario', async () => {
      givenAppointment({
        tenantId: 'kia-quito',
        assignedAdvisorId: 'advisor-1',
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('apt-1'),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith('apt-1');
      expect(result).toEqual({
        tenantId: 'kia-quito',
        assignedAdvisorId: 'advisor-1',
      });
    });

    it('devuelve null cuando el agendamiento no existe', async () => {
      givenAppointment(null);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('apt-1'),
      );

      expect(result).toBeNull();
    });

    it('devuelve null ante un agendamiento de otro concesionario', async () => {
      givenAppointment({
        tenantId: 'mazda-guayaquil',
        assignedAdvisorId: 'advisor-x',
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('apt-1'),
      );

      expect(result).toBeNull();
    });

    it('tolera un documento pre-migración sin tenantId', async () => {
      // La tolerancia vive acá, no en TenantScopedRepository: el primitivo de
      // aislamiento se mantiene estricto. Ver el encabezado del repositorio.
      givenAppointment({ assignedAdvisorId: 'advisor-1' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('apt-1'),
      );

      expect(result).toEqual({ assignedAdvisorId: 'advisor-1' });
    });

    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      givenAppointment({ tenantId: 'kia-quito' });

      await expect(repository.findById('apt-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('markStatus()', () => {
    it('actualiza un agendamiento del propio concesionario', async () => {
      givenAppointment({ tenantId: 'kia-quito' });

      await TenantContext.run(makeContext(), () =>
        repository.markStatus('apt-1', 'ENTREGADO', 'SERVER_TIMESTAMP'),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith('apt-1');
      expect(docRef.update).toHaveBeenCalledWith({
        status: 'ENTREGADO',
        updatedAt: 'SERVER_TIMESTAMP',
      });
    });

    it('no escribe sobre un agendamiento de otro concesionario', async () => {
      givenAppointment({ tenantId: 'mazda-guayaquil' });

      await TenantContext.run(makeContext(), () =>
        repository.markStatus('apt-1', 'ENTREGADO', 'SERVER_TIMESTAMP'),
      );

      expect(docRef.update).not.toHaveBeenCalled();
    });

    it('no escribe si el agendamiento no existe', async () => {
      givenAppointment(null);

      await TenantContext.run(makeContext(), () =>
        repository.markStatus('apt-1', 'ENTREGADO', 'SERVER_TIMESTAMP'),
      );

      expect(docRef.update).not.toHaveBeenCalled();
    });

    it('actualiza un documento pre-migración sin tenantId', async () => {
      givenAppointment({ assignedAdvisorId: 'advisor-1' });

      await TenantContext.run(makeContext(), () =>
        repository.markStatus('apt-1', 'ENTREGADO', 'SERVER_TIMESTAMP'),
      );

      expect(docRef.update).toHaveBeenCalled();
    });
  });
});
