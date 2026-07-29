import { DocumentationController } from './documentation.controller';
import { DocumentationService } from './documentation.service';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

/**
 * El controlador es un adaptador puro: delega en DocumentationService sin
 * lógica propia. Estos tests solo confirman el mapeo de argumentos
 * (incluido el armado de `files` desde los arrays de multer).
 */
describe('DocumentationController', () => {
  let controller: DocumentationController;
  let service: jest.Mocked<
    Pick<
      DocumentationService,
      | 'create'
      | 'sendToRegistration'
      | 'receiveRegistration'
      | 'findOne'
      | 'update'
      | 'remove'
      | 'removeFile'
      | 'revertToPorArribar'
      | 'billVehicle'
      | 'changeSede'
      | 'transferConcessionaire'
    >
  >;

  const user: AuthenticatedUser = {
    uid: 'u1',
    role: RoleEnum.DOCUMENTACION,
    sede: SedeEnum.SURMOTOR,
    active: true,
    displayName: 'User',
    email: 'u1@kia.com',
  };

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      sendToRegistration: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      receiveRegistration: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      findOne: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      update: jest.fn().mockResolvedValue({ vehicleId: 'v1', updated: true }),
      remove: jest.fn().mockResolvedValue({ vehicleId: 'v1', deleted: true }),
      removeFile: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      revertToPorArribar: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      billVehicle: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      changeSede: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      transferConcessionaire: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
    };
    controller = new DocumentationController(service as never);
  });

  it('create() delega armando files desde los arrays de multer', () => {
    const invoice = { buffer: Buffer.from('x') } as Express.Multer.File;
    controller.create('v1', { clientName: 'Juan' } as any, user, {
      vehicleInvoice: [invoice],
    });

    expect(service.create).toHaveBeenCalledWith(
      'v1',
      { clientName: 'Juan' },
      user,
      { vehicleInvoice: invoice, giftEmails: [], accessoryInvoices: [] },
    );
  });

  it('sendToRegistration() delega en el service', () => {
    controller.sendToRegistration(
      'v1',
      { registrationSentDate: '2026-01-01' } as any,
      user,
    );
    expect(service.sendToRegistration).toHaveBeenCalledWith(
      'v1',
      '2026-01-01',
      user,
    );
  });

  it('receiveRegistration() delega en el service', () => {
    controller.receiveRegistration(
      'v1',
      { registrationReceivedDate: '2026-02-01' } as any,
      user,
    );
    expect(service.receiveRegistration).toHaveBeenCalledWith(
      'v1',
      '2026-02-01',
      user,
    );
  });

  it('findOne() delega en el service', () => {
    controller.findOne('v1');
    expect(service.findOne).toHaveBeenCalledWith('v1');
  });

  it('update() delega armando files desde los arrays de multer', () => {
    const invoice = { buffer: Buffer.from('y') } as Express.Multer.File;
    controller.update('v1', { clientPhone: '099' } as any, user, {
      giftEmail: [invoice],
    });

    expect(service.update).toHaveBeenCalledWith(
      'v1',
      { clientPhone: '099' },
      user,
      { vehicleInvoice: undefined, giftEmails: [invoice], accessoryInvoices: [] },
    );
  });

  it('remove() delega en el service', () => {
    controller.remove('v1', user);
    expect(service.remove).toHaveBeenCalledWith('v1', user);
  });

  it('removeFile() delega convirtiendo el index de query string a número', () => {
    controller.removeFile('v1', 'giftEmail', user, '2');
    expect(service.removeFile).toHaveBeenCalledWith('v1', 'giftEmail', user, 2);
  });

  it('removeFile() sin index lo deja undefined', () => {
    controller.removeFile('v1', 'vehicleInvoice', user);
    expect(service.removeFile).toHaveBeenCalledWith(
      'v1',
      'vehicleInvoice',
      user,
      undefined,
    );
  });

  it('revertToPorArribar() delega en el service', () => {
    controller.revertToPorArribar('v1', { reason: 'x' } as any, user);
    expect(service.revertToPorArribar).toHaveBeenCalledWith(
      'v1',
      { reason: 'x' },
      user,
    );
  });

  it('billVehicle() delega en el service', () => {
    controller.billVehicle('v1', user);
    expect(service.billVehicle).toHaveBeenCalledWith('v1', user);
  });

  it('changeSede() delega en el service', () => {
    controller.changeSede('v1', { newSede: SedeEnum.SHYRIS } as any, user);
    expect(service.changeSede).toHaveBeenCalledWith(
      'v1',
      SedeEnum.SHYRIS,
      user,
    );
  });

  it('transfer() delega en el service armando el archivo desde multer', () => {
    const doc = { buffer: Buffer.from('z') } as Express.Multer.File;
    controller.transfer(
      'v1',
      { targetConcessionaire: 'LogiManta' } as any,
      user,
      { transferDocument: [doc] },
    );

    expect(service.transferConcessionaire).toHaveBeenCalledWith(
      'v1',
      'LogiManta',
      user,
      doc,
    );
  });
});
