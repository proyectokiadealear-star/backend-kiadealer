import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { RoleEnum } from '../enums/role.enum';
import { TenantContext, TenantContextData } from '../tenant/tenant-context';
import {
  decodeCursor,
  encodeCursor,
  TenantScopedDocument,
  TenantScopedRepository,
} from './tenant-scoped.repository';

interface TestVehicle extends TenantScopedDocument {
  model?: string;
  status?: string;
}

class TestVehicleRepository extends TenantScopedRepository<TestVehicle> {
  protected readonly collectionName = 'vehicles';
}

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

describe('TenantScopedRepository', () => {
  let repository: TestVehicleRepository;
  let audit: { recordCrossTenantAttempt: jest.Mock };
  let docRef: {
    get: jest.Mock;
    set: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    id: string;
  };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };
  let whereQuery: {
    get: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    startAfter: jest.Mock;
    limit: jest.Mock;
    count: jest.Mock;
  };

  const givenDocument = (data: TestVehicle | null) => {
    docRef.get.mockResolvedValue(
      data
        ? { exists: true, id: 'doc-1', data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    docRef = {
      id: 'doc-1',
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

    repository = new TestVehicleRepository(firebase as never, audit as never);
  });

  describe('fallo cerrado sin contexto', () => {
    it('findById() lanza en vez de consultar', async () => {
      await expect(repository.findById('doc-1')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(docRef.get).not.toHaveBeenCalled();
    });

    it('create() lanza en vez de escribir', async () => {
      await expect(repository.create({ model: 'Sportage' })).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(docRef.set).not.toHaveBeenCalled();
    });

    it('findAll() lanza en vez de devolver todos los tenants', async () => {
      await expect(repository.findAll()).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(whereQuery.get).not.toHaveBeenCalled();
    });
  });

  describe('scope automático', () => {
    it('findAll() filtra por el tenant del contexto', async () => {
      await TenantContext.run(makeContext(), () => repository.findAll());

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
    });

    it('findAll() mapea los documentos con su id', async () => {
      whereQuery.get.mockResolvedValue({
        docs: [
          { id: 'v1', data: () => ({ tenantId: 'kia-quito', model: 'Rio' }) },
        ],
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findAll(),
      );

      expect(result).toEqual([
        { id: 'v1', tenantId: 'kia-quito', model: 'Rio' },
      ]);
    });
  });

  describe('paginación por cursor', () => {
    const givenPage = (count: number, startAt = 0) => {
      whereQuery.get.mockResolvedValue({
        docs: Array.from({ length: count }, (_unused, index) => ({
          id: `v${startAt + index}`,
          data: () => ({ tenantId: 'kia-quito', model: `M${startAt + index}` }),
          get: () => `2026-01-${String(startAt + index + 1).padStart(2, '0')}`,
        })),
      });
    };

    it('lanza sin contexto de tenant', async () => {
      await expect(repository.paginate({ limit: 10 })).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('aplica el filtro de tenant antes de ordenar', async () => {
      givenPage(0);

      await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10 }),
      );

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
    });

    it('pide un documento extra para detectar si hay más', async () => {
      givenPage(0);

      await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 20 }),
      );

      expect(whereQuery.limit).toHaveBeenCalledWith(21);
    });

    it('recorta al límite y reporta hasMore cuando sobra un documento', async () => {
      givenPage(11);

      const page = await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10 }),
      );

      expect(page.items).toHaveLength(10);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();
    });

    it('no emite cursor en la última página', async () => {
      givenPage(5);

      const page = await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10 }),
      );

      expect(page.items).toHaveLength(5);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('no emite cursor cuando no hay resultados', async () => {
      givenPage(0);

      const page = await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10 }),
      );

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it('desempata por id de documento para que el orden sea estable', async () => {
      givenPage(0);

      await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10, orderByField: 'createdAt' }),
      );

      expect(whereQuery.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
      expect(whereQuery.orderBy).toHaveBeenCalledWith('__name__', 'desc');
    });

    it('avanza desde el cursor recibido', async () => {
      givenPage(0);
      const cursor = encodeCursor('2026-01-05', 'v5');

      await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10, cursor }),
      );

      expect(whereQuery.startAfter).toHaveBeenCalledWith('2026-01-05', 'v5');
    });

    it('un cursor corrupto degrada a primera página en vez de romper', async () => {
      givenPage(0);

      await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10, cursor: 'no-es-base64-valido!!' }),
      );

      expect(whereQuery.startAfter).not.toHaveBeenCalled();
    });

    it('un cursor de otro concesionario no permite saltar de tenant', async () => {
      givenPage(0);
      // Aunque el cursor venga de otro tenant, el scope se reaplica siempre
      // desde el contexto: el startAfter solo mueve la posición, no el filtro.
      const cursorAjeno = encodeCursor('2026-01-05', 'v-de-otro-tenant');

      await TenantContext.run(makeContext(), () =>
        repository.paginate({ limit: 10, cursor: cursorAjeno }),
      );

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
    });
  });

  describe('count()', () => {
    it('lanza sin contexto de tenant', async () => {
      await expect(repository.count()).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('usa el agregado de Firestore en vez de traer los documentos', async () => {
      whereQuery.count.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: () => ({ count: 42 }) }),
      });

      const total = await TenantContext.run(makeContext(), () =>
        repository.count(),
      );

      expect(total).toBe(42);
      expect(whereQuery.get).not.toHaveBeenCalled();
    });
  });

  describe('codificación de cursor', () => {
    it('ida y vuelta preserva valor e id', () => {
      expect(decodeCursor(encodeCursor('2026-01-05', 'v5'))).toEqual({
        value: '2026-01-05',
        docId: 'v5',
      });
    });

    it('soporta valores numéricos', () => {
      expect(decodeCursor(encodeCursor(1738368000, 'v9'))).toEqual({
        value: 1738368000,
        docId: 'v9',
      });
    });

    it.each([
      ['ausente', undefined],
      ['nulo', null],
      ['vacío', ''],
      ['no base64', 'no-es-base64!!'],
      ['base64 sin JSON', Buffer.from('texto plano').toString('base64')],
      ['JSON sin docId', Buffer.from('{"value":1}').toString('base64')],
    ])('devuelve null ante un cursor %s', (_caso, cursor) => {
      expect(decodeCursor(cursor)).toBeNull();
    });
  });

  describe('REQ-004 — el tenantId del token prevalece sobre el del payload', () => {
    it('create() ignora un tenantId ajeno enviado en el payload', async () => {
      await TenantContext.run(makeContext(), () =>
        repository.create({
          model: 'Sportage',
          tenantId: 'mazda-guayaquil',
        } as never),
      );

      expect(docRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
    });

    it('create() devuelve el documento con el tenant del contexto', async () => {
      const created = await TenantContext.run(makeContext(), () =>
        repository.create({ model: 'Sportage' }),
      );

      expect(created).toEqual({
        id: 'doc-1',
        model: 'Sportage',
        tenantId: 'kia-quito',
      });
    });
  });

  describe('REQ-001 — aislamiento entre concesionarios', () => {
    it('findById() devuelve null ante un documento de otro concesionario', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil', model: 'CX-5' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('doc-1'),
      );

      expect(result).toBeNull();
    });

    it('findById() audita el intento con el tenant real del token', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil', model: 'CX-5' });

      await TenantContext.run(makeContext(), () =>
        repository.findById('doc-1'),
      );

      expect(audit.recordCrossTenantAttempt).toHaveBeenCalledWith({
        collection: 'vehicles',
        documentId: 'doc-1',
        ownerTenantId: 'mazda-guayaquil',
      });
    });

    it('findById() no audita cuando el documento simplemente no existe', async () => {
      givenDocument(null);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('doc-1'),
      );

      expect(result).toBeNull();
      expect(audit.recordCrossTenantAttempt).not.toHaveBeenCalled();
    });

    it('findById() devuelve el documento propio', async () => {
      givenDocument({ tenantId: 'kia-quito', model: 'Rio' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('doc-1'),
      );

      expect(result).toEqual({
        id: 'doc-1',
        tenantId: 'kia-quito',
        model: 'Rio',
      });
      expect(audit.recordCrossTenantAttempt).not.toHaveBeenCalled();
    });

    it('update() no modifica un documento de otro concesionario', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil', model: 'CX-5' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.update('doc-1', { model: 'Alterado' }),
      );

      expect(result).toBeNull();
      expect(docRef.update).not.toHaveBeenCalled();
    });

    it('delete() no borra un documento de otro concesionario', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.delete('doc-1'),
      );

      expect(result).toBe(false);
      expect(docRef.delete).not.toHaveBeenCalled();
    });

    it('exists() devuelve false ante un documento de otro concesionario', async () => {
      givenDocument({ tenantId: 'mazda-guayaquil' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.exists('doc-1'),
      );

      expect(result).toBe(false);
    });
  });

  describe('operaciones sobre documentos propios', () => {
    it('update() aplica los cambios y devuelve el documento fusionado', async () => {
      givenDocument({ tenantId: 'kia-quito', model: 'Rio', status: 'NUEVO' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.update('doc-1', { status: 'ENTREGADO' }),
      );

      expect(docRef.update).toHaveBeenCalledWith({ status: 'ENTREGADO' });
      expect(result).toEqual({
        id: 'doc-1',
        tenantId: 'kia-quito',
        model: 'Rio',
        status: 'ENTREGADO',
      });
    });

    it('delete() borra y devuelve true', async () => {
      givenDocument({ tenantId: 'kia-quito' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.delete('doc-1'),
      );

      expect(result).toBe(true);
      expect(docRef.delete).toHaveBeenCalled();
    });

    it('findByIdOrThrow() lanza el error provisto si no hay resultado', async () => {
      givenDocument(null);

      await expect(
        TenantContext.run(makeContext(), () =>
          repository.findByIdOrThrow(
            'doc-1',
            () => new NotFoundException('nope'),
          ),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('findByIdOrThrow() devuelve el documento propio', async () => {
      givenDocument({ tenantId: 'kia-quito', model: 'Rio' });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findByIdOrThrow('doc-1', () => new NotFoundException()),
      );

      expect(result.model).toBe('Rio');
    });
  });
});
