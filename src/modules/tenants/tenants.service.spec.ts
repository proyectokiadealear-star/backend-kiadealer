import { TenantsService } from './tenants.service';
import { TenantStatus } from './tenant.types';

describe('TenantsService', () => {
  let service: TenantsService;
  let docGet: jest.Mock;
  let subcollectionGet: jest.Mock;
  let whereQuery: { where: jest.Mock; get: jest.Mock };

  const givenTenant = (data: Record<string, unknown> | null) => {
    docGet.mockResolvedValue(
      data
        ? { exists: true, id: 'kia-quito', data: () => data }
        : { exists: false, data: () => undefined },
    );
  };

  beforeEach(() => {
    process.env.TENANT_CACHE_TTL_MS = '60000';
    docGet = jest.fn();
    subcollectionGet = jest.fn().mockResolvedValue({ docs: [] });
    whereQuery = {
      where: jest.fn(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    };
    whereQuery.where.mockReturnValue(whereQuery);

    const firebase = {
      rawFirestore: () => ({
        collection: () => ({
          doc: () => ({
            get: docGet,
            collection: () => ({ get: subcollectionGet }),
          }),
          where: whereQuery.where,
        }),
      }),
    };

    service = new TenantsService(firebase as never);
  });

  describe('findById()', () => {
    it('devuelve el concesionario con su id', async () => {
      givenTenant({ name: 'Kia Quito', status: TenantStatus.ACTIVE });

      const tenant = await service.findById('kia-quito');

      expect(tenant).toEqual(
        expect.objectContaining({ id: 'kia-quito', name: 'Kia Quito' }),
      );
    });

    it('devuelve null si no existe', async () => {
      givenTenant(null);

      expect(await service.findById('no-existe')).toBeNull();
    });
  });

  describe('caché', () => {
    it('no vuelve a leer Firestore dentro del TTL', async () => {
      givenTenant({ status: TenantStatus.ACTIVE });

      await service.findById('kia-quito');
      await service.findById('kia-quito');
      await service.findById('kia-quito');

      expect(docGet).toHaveBeenCalledTimes(1);
    });

    it('cachea también el resultado negativo', async () => {
      givenTenant(null);

      await service.findById('no-existe');
      await service.findById('no-existe');

      expect(docGet).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache() fuerza una lectura nueva', async () => {
      givenTenant({ status: TenantStatus.ACTIVE });

      await service.findById('kia-quito');
      service.invalidateCache('kia-quito');
      await service.findById('kia-quito');

      expect(docGet).toHaveBeenCalledTimes(2);
    });

    it('relee cuando el TTL expira', async () => {
      process.env.TENANT_CACHE_TTL_MS = '0';
      const firebase = {
        rawFirestore: () => ({
          collection: () => ({ doc: () => ({ get: docGet }) }),
        }),
      };
      const shortLived = new TenantsService(firebase as never);
      givenTenant({ status: TenantStatus.ACTIVE });

      await shortLived.findById('kia-quito');
      await shortLived.findById('kia-quito');

      expect(docGet).toHaveBeenCalledTimes(2);
    });

    it('mantiene entradas separadas por concesionario', async () => {
      givenTenant({ status: TenantStatus.ACTIVE });

      await service.findById('kia-quito');
      await service.findById('mazda-guayaquil');

      expect(docGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('isActive()', () => {
    it.each([
      [TenantStatus.ACTIVE, true],
      [TenantStatus.SUSPENDED, false],
      [TenantStatus.PENDING, false],
    ])('con estado %s devuelve %s', async (status, expected) => {
      givenTenant({ status });

      expect(await service.isActive('kia-quito')).toBe(expected);
    });

    it('devuelve false si el concesionario no existe', async () => {
      givenTenant(null);

      expect(await service.isActive('no-existe')).toBe(false);
    });
  });

  describe('listEstablishments()', () => {
    it('mapea las sucursales con su id', async () => {
      subcollectionGet.mockResolvedValue({
        docs: [{ id: 'surmotor', data: () => ({ code: 'MAT', active: true }) }],
      });

      const establishments = await service.listEstablishments('kia-quito');

      expect(establishments).toEqual([
        { id: 'surmotor', code: 'MAT', active: true },
      ]);
    });

    it('devuelve arreglo vacío si no hay sucursales', async () => {
      expect(await service.listEstablishments('kia-quito')).toEqual([]);
    });
  });

  describe('listActiveIds()', () => {
    it('filtra por status ACTIVE y devuelve los ids', async () => {
      whereQuery.get.mockResolvedValue({
        docs: [{ id: 'kia-quito' }, { id: 'mazda-guayaquil' }],
      });

      const ids = await service.listActiveIds();

      expect(whereQuery.where).toHaveBeenCalledWith(
        'status',
        '==',
        TenantStatus.ACTIVE,
      );
      expect(ids).toEqual(['kia-quito', 'mazda-guayaquil']);
    });

    it('devuelve arreglo vacío si no hay concesionarios activos', async () => {
      expect(await service.listActiveIds()).toEqual([]);
    });
  });
});
