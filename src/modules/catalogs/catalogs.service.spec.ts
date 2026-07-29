import { NotFoundException } from '@nestjs/common';
import { CatalogsService } from './catalogs.service';
import { CatalogItemsRepository } from './catalogs.repository';

/**
 * El servicio no conoce Firestore ni TenantContext — solo delega en los
 * repositorios inyectados. Por eso los mocks acá son objetos planos: no hace
 * falta simular Firestore para probar la lógica de normalización y de
 * traducción de resultados a NotFoundException.
 */
type RepoMock = {
  findAllSorted: jest.Mock;
  createItem: jest.Mock;
  updateItem: jest.Mock;
  delete: jest.Mock;
};

const makeRepoMock = (): RepoMock => ({
  findAllSorted: jest.fn(),
  createItem: jest.fn(),
  updateItem: jest.fn(),
  delete: jest.fn(),
});

describe('CatalogsService', () => {
  let service: CatalogsService;
  let colors: RepoMock;
  let models: RepoMock;
  let concessionaires: RepoMock;
  let sedes: RepoMock;
  let accessories: RepoMock;

  beforeEach(() => {
    colors = makeRepoMock();
    models = makeRepoMock();
    concessionaires = makeRepoMock();
    sedes = makeRepoMock();
    accessories = makeRepoMock();

    service = new CatalogsService(
      colors as unknown as CatalogItemsRepository,
      models as unknown as CatalogItemsRepository,
      concessionaires as unknown as CatalogItemsRepository,
      sedes as unknown as CatalogItemsRepository,
      accessories as unknown as CatalogItemsRepository,
    );
  });

  // ── COLORES ───────────────────────────────────────────────────────
  describe('colores', () => {
    it('getColors() delega en el repositorio de colores', async () => {
      const items = [{ id: 'a', tenantId: 't1', name: 'AZUL' }];
      colors.findAllSorted.mockResolvedValue(items);

      const result = await service.getColors();

      expect(colors.findAllSorted).toHaveBeenCalled();
      expect(result).toBe(items);
    });

    it('createColor() normaliza el nombre a MAYUSCULAS antes de crear', async () => {
      colors.createItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'ROJO',
      });

      await service.createColor('  rojo  ');

      expect(colors.createItem).toHaveBeenCalledWith({ name: 'ROJO' });
    });

    it('updateColor() lanza 404 cuando el repositorio devuelve null', async () => {
      colors.updateItem.mockResolvedValue(null);

      await expect(service.updateColor('missing-id', 'rojo')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updateColor() devuelve {id, updated:true} cuando actualiza', async () => {
      colors.updateItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'ROJO',
      });

      const result = await service.updateColor('x', 'rojo');

      expect(colors.updateItem).toHaveBeenCalledWith('x', { name: 'ROJO' });
      expect(result).toEqual({ id: 'x', updated: true });
    });

    it('deleteColor() lanza 404 cuando el repositorio no borra nada', async () => {
      colors.delete.mockResolvedValue(false);

      await expect(service.deleteColor('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deleteColor() devuelve {id, deleted:true} cuando borra', async () => {
      colors.delete.mockResolvedValue(true);

      const result = await service.deleteColor('x');

      expect(result).toEqual({ id: 'x', deleted: true });
    });
  });

  // ── MODELOS ───────────────────────────────────────────────────────
  describe('modelos', () => {
    it('getModels() delega en el repositorio de modelos', async () => {
      models.findAllSorted.mockResolvedValue([]);
      await service.getModels();
      expect(models.findAllSorted).toHaveBeenCalled();
    });

    it('createModel() normaliza el nombre', async () => {
      models.createItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'SPORTAGE',
      });
      await service.createModel('sportage');
      expect(models.createItem).toHaveBeenCalledWith({ name: 'SPORTAGE' });
    });

    it('updateModel() traduce null a 404', async () => {
      models.updateItem.mockResolvedValue(null);
      await expect(service.updateModel('missing-id', 'rio')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deleteModel() traduce false a 404', async () => {
      models.delete.mockResolvedValue(false);
      await expect(service.deleteModel('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deleteModel() devuelve {id, deleted:true} cuando borra', async () => {
      models.delete.mockResolvedValue(true);
      const result = await service.deleteModel('x');
      expect(result).toEqual({ id: 'x', deleted: true });
    });
  });

  // ── CONCESIONARIOS ────────────────────────────────────────────────
  describe('concesionarios', () => {
    it('getConcessionaires() delega en el repositorio correspondiente', async () => {
      concessionaires.findAllSorted.mockResolvedValue([]);
      await service.getConcessionaires();
      expect(concessionaires.findAllSorted).toHaveBeenCalled();
    });

    it('createConcessionaire() normaliza el nombre', async () => {
      concessionaires.createItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'LOGIMANTA',
      });
      await service.createConcessionaire('logimanta');
      expect(concessionaires.createItem).toHaveBeenCalledWith({
        name: 'LOGIMANTA',
      });
    });

    it('updateConcessionaire() devuelve {id, updated:true} cuando actualiza', async () => {
      concessionaires.updateItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'LOGIMANTA',
      });
      const result = await service.updateConcessionaire('x', 'logimanta');
      expect(result).toEqual({ id: 'x', updated: true });
    });

    it('deleteConcessionaire() traduce false a 404', async () => {
      concessionaires.delete.mockResolvedValue(false);
      await expect(service.deleteConcessionaire('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── SEDES ─────────────────────────────────────────────────────────
  describe('sedes', () => {
    it('getSedes() delega en el repositorio de sedes', async () => {
      sedes.findAllSorted.mockResolvedValue([]);
      await service.getSedes();
      expect(sedes.findAllSorted).toHaveBeenCalled();
    });

    it('createSede() normaliza name pero conserva code tal cual', async () => {
      sedes.createItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'SURMOTOR NORTE',
        code: 'smn',
      });

      await service.createSede('surmotor norte', 'smn');

      expect(sedes.createItem).toHaveBeenCalledWith({
        name: 'SURMOTOR NORTE',
        code: 'smn',
      });
    });

    it('updateSede() pasa name y code al repositorio', async () => {
      sedes.updateItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'SURMOTOR',
        code: 'sm',
      });

      const result = await service.updateSede('x', 'surmotor', 'sm');

      expect(sedes.updateItem).toHaveBeenCalledWith('x', {
        name: 'SURMOTOR',
        code: 'sm',
      });
      expect(result).toEqual({ id: 'x', updated: true });
    });

    it('updateSede() traduce null a 404', async () => {
      sedes.updateItem.mockResolvedValue(null);
      await expect(
        service.updateSede('missing-id', 'surmotor', 'sm'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deleteSede() devuelve {id, deleted:true} cuando borra', async () => {
      sedes.delete.mockResolvedValue(true);
      const result = await service.deleteSede('x');
      expect(result).toEqual({ id: 'x', deleted: true });
    });
  });

  // ── ACCESORIOS ────────────────────────────────────────────────────
  describe('accesorios', () => {
    it('getAccessories() delega en el repositorio de accesorios', async () => {
      accessories.findAllSorted.mockResolvedValue([]);
      await service.getAccessories();
      expect(accessories.findAllSorted).toHaveBeenCalled();
    });

    it('createAccessory() normaliza name pero conserva key tal cual', async () => {
      accessories.createItem.mockResolvedValue({
        id: 'x',
        tenantId: 't1',
        name: 'BOTON DE ENCENDIDO',
        key: 'boton_encendido',
      });

      await service.createAccessory('boton de encendido', 'boton_encendido');

      expect(accessories.createItem).toHaveBeenCalledWith({
        name: 'BOTON DE ENCENDIDO',
        key: 'boton_encendido',
      });
    });

    it('updateAccessory() traduce null a 404', async () => {
      accessories.updateItem.mockResolvedValue(null);
      await expect(
        service.updateAccessory('missing-id', 'nombre'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deleteAccessory() traduce false a 404', async () => {
      accessories.delete.mockResolvedValue(false);
      await expect(service.deleteAccessory('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deleteAccessory() devuelve {id, deleted:true} cuando borra', async () => {
      accessories.delete.mockResolvedValue(true);
      const result = await service.deleteAccessory('x');
      expect(result).toEqual({ id: 'x', deleted: true });
    });
  });
});
