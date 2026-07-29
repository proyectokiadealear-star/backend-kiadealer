import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { CertificationsRepository } from './certifications.repository';

/**
 * CertificationsRepository no agrega lógica propia — es una instanciación de
 * TenantScopedRepository para `certifications`. Estos tests cubren el
 * contrato de aislamiento multi-tenant sobre ESE repositorio concreto (no
 * duplican la suite completa de tenant-scoped.repository.spec.ts), porque es
 * el comportamiento que CertificationsService asume que existe.
 */
describe('CertificationsRepository', () => {
  let repository: CertificationsRepository;
  let audit: { recordCrossTenantAttempt: jest.Mock };
  let docRef: {
    get: jest.Mock;
    set: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    id: string;
  };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };

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

  const givenDocument = (data: Record<string, unknown> | null) => {
    docRef.get.mockResolvedValue(
      data
        ? { exists: true, id: 'vehicle-1', data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    docRef = {
      id: 'vehicle-1',
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn(),
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };
    audit = {
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };

    repository = new CertificationsRepository(
      firebase as never,
      audit as never,
    );
  });

  describe('fallo cerrado sin contexto', () => {
    it('findById() lanza en vez de consultar Firestore', async () => {
      await expect(repository.findById('vehicle-1')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(docRef.get).not.toHaveBeenCalled();
    });

    it('create() lanza en vez de escribir', async () => {
      await expect(
        repository.create({ vehicleId: 'vehicle-1' } as never, 'vehicle-1'),
      ).rejects.toThrow(InternalServerErrorException);
      expect(docRef.set).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento entre concesionarios', () => {
    it('findById() devuelve null ante una certificación de otro concesionario', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil', vehicleId: 'vehicle-1' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('vehicle-1'),
      );

      expect(result).toBeNull();
      expect(audit.recordCrossTenantAttempt).toHaveBeenCalledWith({
        collection: 'certifications',
        documentId: 'vehicle-1',
        ownerTenantId: 'mazda-guayaquil',
      });
    });

    it('findById() devuelve la certificación propia', async () => {
      givenDocument({ tenantId: 'kia-quito', vehicleId: 'vehicle-1' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('vehicle-1'),
      );

      expect(result).toEqual({
        id: 'vehicle-1',
        tenantId: 'kia-quito',
        vehicleId: 'vehicle-1',
      });
    });
  });

  describe('el tenantId del contexto pisa el del payload', () => {
    it('create() ignora un tenantId ajeno enviado en el payload', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.create(
          { vehicleId: 'vehicle-1', tenantId: 'mazda-guayaquil' } as never,
          'vehicle-1',
        ),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith('vehicle-1');
      expect(docRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
    });

    it('create() usa el vehicleId como id del documento', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.create({ vehicleId: 'vehicle-42' } as never, 'vehicle-42'),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith('vehicle-42');
    });
  });
});
