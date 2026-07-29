import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { CatalogItem, CatalogItemsRepository } from './catalogs.repository';

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

describe('CatalogItemsRepository', () => {
  let repository: CatalogItemsRepository;
  let audit: { recordCrossTenantAttempt: jest.Mock };
  let docRef: {
    id: string;
    get: jest.Mock;
    set: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };
  let whereQuery: { get: jest.Mock; where: jest.Mock };
  let collectionMock: jest.Mock;
  let firebase: { rawFirestore: jest.Mock; serverTimestamp: jest.Mock };

  const givenDocument = (data: CatalogItem | null) => {
    docRef.get.mockResolvedValue(
      data
        ? { exists: true, id: 'doc-1', data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    docRef = {
      id: 'doc-1',
      get: jest
        .fn()
        .mockResolvedValue({ exists: false, data: () => undefined }),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    whereQuery = {
      get: jest.fn().mockResolvedValue({ docs: [] }),
      where: jest.fn(),
    };
    whereQuery.where.mockReturnValue(whereQuery);
    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn().mockReturnValue(whereQuery),
    };
    collectionMock = jest.fn().mockReturnValue(collectionRef);
    firebase = {
      rawFirestore: jest.fn().mockReturnValue({ collection: collectionMock }),
      serverTimestamp: jest.fn().mockReturnValue('SERVER_TS'),
    };
    audit = {
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };

    repository = new CatalogItemsRepository(
      firebase as never,
      audit as never,
      'colors',
    );
  });

  describe('subcolección', () => {
    it('apunta a catalogs/{tipo}/items sin necesitar sobreescribir collection()', async () => {
      await TenantContext.run(makeContext(), () => repository.findAllSorted());

      expect(collectionMock).toHaveBeenCalledWith('catalogs/colors/items');
    });
  });

  describe('createItem()', () => {
    it('fallo cerrado: lanza sin contexto de tenant y no toca Firestore', async () => {
      await expect(
        repository.createItem({ name: 'ROJO' } as never),
      ).rejects.toThrow(InternalServerErrorException);

      expect(docRef.get).not.toHaveBeenCalled();
      expect(docRef.set).not.toHaveBeenCalled();
    });

    it('crea el documento con id determinístico prefijado por el tenant activo', async () => {
      docRef.get.mockResolvedValue({ exists: false });

      const result = await TenantContext.run(makeContext(), () =>
        repository.createItem({ name: 'BLANCO PERLA' } as never),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith('kia-quito__blanco-perla');
      expect(docRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'BLANCO PERLA',
          tenantId: 'kia-quito',
          createdAt: 'SERVER_TS',
        }),
      );
      expect(result.id).toBe('doc-1');
    });

    it('el tenantId del contexto pisa un tenantId ajeno enviado en el payload', async () => {
      docRef.get.mockResolvedValue({ exists: false });

      await TenantContext.run(makeContext(), () =>
        repository.createItem({
          name: 'ROJO',
          tenantId: 'mazda-guayaquil',
        } as never),
      );

      expect(docRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'kia-quito' }),
      );
    });

    it('rechaza un nombre duplicado dentro del mismo concesionario', async () => {
      docRef.get.mockResolvedValue({ exists: true });

      await expect(
        TenantContext.run(makeContext(), () =>
          repository.createItem({ name: 'BLANCO PERLA' } as never),
        ),
      ).rejects.toThrow(ConflictException);
      expect(docRef.set).not.toHaveBeenCalled();
    });

    it('el mismo nombre en otro concesionario no colisiona: el id incluye el tenant', async () => {
      docRef.get.mockResolvedValue({ exists: false });

      await TenantContext.run(
        makeContext({ tenantId: 'mazda-guayaquil' }),
        () => repository.createItem({ name: 'BLANCO PERLA' } as never),
      );

      expect(collectionRef.doc).toHaveBeenCalledWith(
        'mazda-guayaquil__blanco-perla',
      );
    });
  });

  describe('findAllSorted()', () => {
    it('fallo cerrado sin contexto de tenant', async () => {
      await expect(repository.findAllSorted()).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('filtra por el tenant del contexto', async () => {
      await TenantContext.run(makeContext(), () => repository.findAllSorted());

      expect(collectionRef.where).toHaveBeenCalledWith(
        'tenantId',
        '==',
        'kia-quito',
      );
    });

    it('ordena alfabéticamente por nombre en memoria', async () => {
      whereQuery.get.mockResolvedValue({
        docs: [
          { id: 'b', data: () => ({ tenantId: 'kia-quito', name: 'ZETA' }) },
          { id: 'a', data: () => ({ tenantId: 'kia-quito', name: 'ALFA' }) },
        ],
      });

      const result = await TenantContext.run(makeContext(), () =>
        repository.findAllSorted(),
      );

      expect(result.map((item) => item.name)).toEqual(['ALFA', 'ZETA']);
    });
  });

  describe('REQ-001 — aislamiento entre concesionarios (heredado de la base)', () => {
    it('findById() devuelve null ante un documento de otro concesionario', async () => {
      givenDocument({
        tenantId: 'mazda-guayaquil',
        name: 'CX-5',
      } as CatalogItem);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('doc-1'),
      );

      expect(result).toBeNull();
      expect(audit.recordCrossTenantAttempt).toHaveBeenCalledWith({
        collection: 'catalogs/colors/items',
        documentId: 'doc-1',
        ownerTenantId: 'mazda-guayaquil',
      });
    });

    it('findById() devuelve el ítem propio', async () => {
      givenDocument({ tenantId: 'kia-quito', name: 'ROJO' } as CatalogItem);

      const result = await TenantContext.run(makeContext(), () =>
        repository.findById('doc-1'),
      );

      expect(result).toEqual({
        id: 'doc-1',
        tenantId: 'kia-quito',
        name: 'ROJO',
      });
    });
  });

  describe('updateItem()', () => {
    it('sella updatedAt y delega el chequeo de pertenencia en la base', async () => {
      givenDocument({ tenantId: 'kia-quito', name: 'ROJO' } as CatalogItem);

      const result = await TenantContext.run(makeContext(), () =>
        repository.updateItem('doc-1', { name: 'AZUL' }),
      );

      expect(docRef.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'AZUL', updatedAt: 'SERVER_TS' }),
      );
      expect(result).not.toBeNull();
    });

    it('devuelve null sin escribir si el documento es de otro concesionario', async () => {
      givenDocument({
        tenantId: 'mazda-guayaquil',
        name: 'ROJO',
      } as CatalogItem);

      const result = await TenantContext.run(makeContext(), () =>
        repository.updateItem('doc-1', { name: 'AZUL' }),
      );

      expect(result).toBeNull();
      expect(docRef.update).not.toHaveBeenCalled();
    });
  });

  describe('delete() heredado', () => {
    it('no borra un documento de otro concesionario', async () => {
      givenDocument({
        tenantId: 'mazda-guayaquil',
        name: 'ROJO',
      } as CatalogItem);

      const result = await TenantContext.run(makeContext(), () =>
        repository.delete('doc-1'),
      );

      expect(result).toBe(false);
      expect(docRef.delete).not.toHaveBeenCalled();
    });

    it('borra el ítem propio', async () => {
      givenDocument({ tenantId: 'kia-quito', name: 'ROJO' } as CatalogItem);

      const result = await TenantContext.run(makeContext(), () =>
        repository.delete('doc-1'),
      );

      expect(result).toBe(true);
      expect(docRef.delete).toHaveBeenCalled();
    });
  });
});
