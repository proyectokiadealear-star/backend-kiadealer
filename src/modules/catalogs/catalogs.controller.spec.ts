import { CatalogsController } from './catalogs.controller';
import { CatalogsService } from './catalogs.service';

/**
 * El controller es una capa de delegación pura (guards + DTOs + swagger):
 * no tiene lógica de tenant propia, así que estos tests solo verifican que
 * cada endpoint llama al método correcto del servicio con los argumentos
 * correctos. El scope de tenant y el aislamiento entre concesionarios ya
 * están cubiertos en catalogs.repository.spec.ts y catalogs.service.spec.ts.
 */
/**
 * Mock tipado como objeto plano (no `jest.Mocked<CatalogsService>`): así
 * evitamos que `@typescript-eslint/unbound-method` marque cada
 * `expect(service.metodo)` como una referencia a un método de clase sin
 * bindear — acá son propiedades `jest.Mock`, no métodos de instancia.
 */
type ServiceMock = {
  getColors: jest.Mock;
  createColor: jest.Mock;
  updateColor: jest.Mock;
  deleteColor: jest.Mock;
  getModels: jest.Mock;
  createModel: jest.Mock;
  updateModel: jest.Mock;
  deleteModel: jest.Mock;
  getConcessionaires: jest.Mock;
  createConcessionaire: jest.Mock;
  updateConcessionaire: jest.Mock;
  deleteConcessionaire: jest.Mock;
  getSedes: jest.Mock;
  createSede: jest.Mock;
  updateSede: jest.Mock;
  deleteSede: jest.Mock;
  getAccessories: jest.Mock;
  createAccessory: jest.Mock;
  updateAccessory: jest.Mock;
  deleteAccessory: jest.Mock;
};

describe('CatalogsController', () => {
  let controller: CatalogsController;
  let service: ServiceMock;

  beforeEach(() => {
    service = {
      getColors: jest.fn(),
      createColor: jest.fn(),
      updateColor: jest.fn(),
      deleteColor: jest.fn(),
      getModels: jest.fn(),
      createModel: jest.fn(),
      updateModel: jest.fn(),
      deleteModel: jest.fn(),
      getConcessionaires: jest.fn(),
      createConcessionaire: jest.fn(),
      updateConcessionaire: jest.fn(),
      deleteConcessionaire: jest.fn(),
      getSedes: jest.fn(),
      createSede: jest.fn(),
      updateSede: jest.fn(),
      deleteSede: jest.fn(),
      getAccessories: jest.fn(),
      createAccessory: jest.fn(),
      updateAccessory: jest.fn(),
      deleteAccessory: jest.fn(),
    };

    controller = new CatalogsController(service as unknown as CatalogsService);
  });

  it('colores: lista, crea, edita y elimina delegando en el servicio', () => {
    void controller.getColors();
    expect(service.getColors).toHaveBeenCalled();

    void controller.createColor({ name: 'ROJO' });
    expect(service.createColor).toHaveBeenCalledWith('ROJO');

    void controller.updateColor('rojo', { name: 'AZUL' });
    expect(service.updateColor).toHaveBeenCalledWith('rojo', 'AZUL');

    void controller.deleteColor('rojo');
    expect(service.deleteColor).toHaveBeenCalledWith('rojo');
  });

  it('modelos: lista, crea, edita y elimina delegando en el servicio', () => {
    void controller.getModels();
    expect(service.getModels).toHaveBeenCalled();

    void controller.createModel({ name: 'SPORTAGE' });
    expect(service.createModel).toHaveBeenCalledWith('SPORTAGE');

    void controller.updateModel('sportage', { name: 'RIO' });
    expect(service.updateModel).toHaveBeenCalledWith('sportage', 'RIO');

    void controller.deleteModel('sportage');
    expect(service.deleteModel).toHaveBeenCalledWith('sportage');
  });

  it('concesionarios: lista, crea, edita y elimina delegando en el servicio', () => {
    void controller.getConcessionaires();
    expect(service.getConcessionaires).toHaveBeenCalled();

    void controller.createConcessionaire({ name: 'LOGIMANTA' });
    expect(service.createConcessionaire).toHaveBeenCalledWith('LOGIMANTA');

    void controller.updateConcessionaire('logimanta', { name: 'SURMOTOR' });
    expect(service.updateConcessionaire).toHaveBeenCalledWith(
      'logimanta',
      'SURMOTOR',
    );

    void controller.deleteConcessionaire('logimanta');
    expect(service.deleteConcessionaire).toHaveBeenCalledWith('logimanta');
  });

  it('sedes: lista, crea, edita y elimina delegando en el servicio', () => {
    void controller.getSedes();
    expect(service.getSedes).toHaveBeenCalled();

    void controller.createSede({ name: 'SURMOTOR NORTE', code: 'SMN' });
    expect(service.createSede).toHaveBeenCalledWith('SURMOTOR NORTE', 'SMN');

    void controller.updateSede('surmotor', {
      name: 'SURMOTOR SUR',
      code: 'SMS',
    });
    expect(service.updateSede).toHaveBeenCalledWith(
      'surmotor',
      'SURMOTOR SUR',
      'SMS',
    );

    void controller.deleteSede('surmotor');
    expect(service.deleteSede).toHaveBeenCalledWith('surmotor');
  });

  it('accesorios: lista, crea, edita y elimina delegando en el servicio', () => {
    void controller.getAccessories();
    expect(service.getAccessories).toHaveBeenCalled();

    void controller.createAccessory({
      name: 'BOTON DE ENCENDIDO',
      key: 'BOTON_ENCENDIDO',
    });
    expect(service.createAccessory).toHaveBeenCalledWith(
      'BOTON DE ENCENDIDO',
      'BOTON_ENCENDIDO',
    );

    void controller.updateAccessory('boton-de-encendido', {
      name: 'BOTON APAGADO',
    });
    expect(service.updateAccessory).toHaveBeenCalledWith(
      'boton-de-encendido',
      'BOTON APAGADO',
    );

    void controller.deleteAccessory('boton-de-encendido');
    expect(service.deleteAccessory).toHaveBeenCalledWith('boton-de-encendido');
  });
});
