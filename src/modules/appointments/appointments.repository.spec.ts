import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { AppointmentsRepository } from './appointments.repository';

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

describe('AppointmentsRepository', () => {
  let repository: AppointmentsRepository;
  let audit: { recordCrossTenantAttempt: jest.Mock };
  let docRef: {
    id: string;
    get: jest.Mock;
    set: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let whereQuery: {
    get: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    startAfter: jest.Mock;
    limit: jest.Mock;
    count: jest.Mock;
  };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };

  const givenDocs = (
    docs: Array<{ id: string; data: Record<string, unknown> }>,
  ) => {
    whereQuery.get.mockResolvedValue({
      docs: docs.map((d) => ({
        id: d.id,
        data: () => d.data,
        get: (field: string) => d.data[field],
      })),
    });
  };

  beforeEach(() => {
    docRef = {
      id: 'apt-1',
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    whereQuery = {
      get: jest.fn().mockResolvedValue({ docs: [] }),
      where: jest.fn(),
      orderBy: jest.fn(),
      startAfter: jest.fn(),
      limit: jest.fn(),
      count: jest.fn(),
    };
    whereQuery.where.mockReturnValue(whereQuery);
    whereQuery.orderBy.mockReturnValue(whereQuery);
    whereQuery.startAfter.mockReturnValue(whereQuery);
    whereQuery.limit.mockReturnValue(whereQuery);
    whereQuery.count.mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
    });
    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn().mockReturnValue(whereQuery),
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };
    audit = {
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };

    repository = new AppointmentsRepository(firebase as never, audit as never);
  });

  describe('fallo cerrado sin contexto', () => {
    it('findByAdvisorAndDate() lanza en vez de consultar', async () => {
      await expect(
        repository.findByAdvisorAndDate('advisor-1', '2026-03-15'),
      ).rejects.toThrow(InternalServerErrorException);
      expect(collectionRef.where).not.toHaveBeenCalled();
    });

    it('findScheduledForDate() lanza en vez de consultar', async () => {
      await expect(
        repository.findScheduledForDate('2026-03-15'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('listAll() lanza en vez de consultar', async () => {
      await expect(repository.listAll({})).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('paginateFiltered() lanza en vez de consultar', async () => {
      await expect(
        repository.paginateFiltered({}, { limit: 10 }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('countFiltered() lanza en vez de consultar', async () => {
      await expect(repository.countFiltered({})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('aislamiento entre concesionarios', () => {
    it('findByAdvisorAndDate() solo trae documentos ya acotados por scopedQuery()', async () => {
      givenDocs([
        {
          id: 'apt-1',
          data: {
            tenantId: 'kia-quito',
            assignedAdvisorId: 'advisor-1',
            scheduledDate: '2026-03-15',
            scheduledTime: '10:00',
            status: 'AGENDADO',
          },
        },
      ]);

      await TenantContext.run(makeContext(), () =>
        repository.findByAdvisorAndDate('advisor-1', '2026-03-15'),
      );

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
      expect(whereQuery.where).toHaveBeenCalledWith(
        'assignedAdvisorId',
        '==',
        'advisor-1',
      );
      expect(whereQuery.where).toHaveBeenCalledWith(
        'scheduledDate',
        '==',
        '2026-03-15',
      );
    });

    it('un cursor de otro concesionario no permite saltar de tenant en paginateFiltered()', async () => {
      givenDocs([]);

      await TenantContext.run(makeContext({ tenantId: 'kia-quito' }), () =>
        repository.paginateFiltered({}, { limit: 10 }),
      );

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
    });
  });

  describe('create() — el tenantId del contexto pisa el del payload', () => {
    it('ignora un tenantId ajeno enviado en el payload y usa el id explícito', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.create(
          {
            vehicleId: 'vehicle-1',
            tenantId: 'mazda-guayaquil',
          } as never,
          'apt-1',
        ),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith('apt-1');
      expect(docRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
    });
  });

  describe('buildQuery() vía countFiltered() y paginateFiltered()', () => {
    it('countFiltered() aplica los filtros de negocio sin orderBy', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.countFiltered({
          sede: 'SURMOTOR',
          dateFrom: '2026-03-01',
          dateTo: '2026-03-31',
        }),
      );

      expect(whereQuery.where).toHaveBeenCalledWith('sede', '==', 'SURMOTOR');
      expect(whereQuery.where).toHaveBeenCalledWith(
        'scheduledDate',
        '>=',
        '2026-03-01',
      );
      expect(whereQuery.where).toHaveBeenCalledWith(
        'scheduledDate',
        '<=',
        '2026-03-31',
      );
    });

    it('paginateFiltered() pide limit+1 y ordena por scheduledDate', async () => {
      givenDocs([]);

      await TenantContext.run(makeContext(), () =>
        repository.paginateFiltered(
          { assignedAdvisorId: 'advisor-1' },
          { limit: 20 },
        ),
      );

      expect(whereQuery.where).toHaveBeenCalledWith(
        'assignedAdvisorId',
        '==',
        'advisor-1',
      );
      expect(whereQuery.orderBy).toHaveBeenCalledWith('scheduledDate', 'asc');
      expect(whereQuery.orderBy).toHaveBeenCalledWith('__name__', 'asc');
      expect(whereQuery.limit).toHaveBeenCalledWith(21);
    });
  });

  describe('listAll()', () => {
    it('ordena por fecha, hora e id de documento', async () => {
      givenDocs([]);

      await TenantContext.run(makeContext(), () =>
        repository.listAll({ vehicleId: 'vehicle-1' }),
      );

      expect(whereQuery.where).toHaveBeenCalledWith(
        'vehicleId',
        '==',
        'vehicle-1',
      );
      expect(whereQuery.orderBy).toHaveBeenCalledWith('scheduledDate', 'asc');
      expect(whereQuery.orderBy).toHaveBeenCalledWith('scheduledTime', 'asc');
      expect(whereQuery.orderBy).toHaveBeenCalledWith('__name__', 'asc');
    });
  });
});
