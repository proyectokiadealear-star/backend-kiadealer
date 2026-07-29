import { CertificationsController } from './certifications.controller';
import { CertificationsService } from './certifications.service';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

/**
 * El controlador es un adaptador puro: delega en CertificationsService sin
 * lógica propia. Estos tests solo confirman el mapeo de argumentos
 * (incluido el armado de `files` desde los arrays de multer).
 */
describe('CertificationsController', () => {
  let controller: CertificationsController;
  let service: jest.Mocked<
    Pick<CertificationsService, 'create' | 'findOne' | 'update' | 'remove'>
  >;

  const user: AuthenticatedUser = {
    uid: 'u1',
    role: RoleEnum.ASESOR,
    sede: SedeEnum.SURMOTOR,
    active: true,
    displayName: 'User',
    email: 'u1@kia.com',
  };

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      findOne: jest.fn().mockResolvedValue({ vehicleId: 'v1' }),
      update: jest.fn().mockResolvedValue({ vehicleId: 'v1', updated: true }),
      remove: jest.fn().mockResolvedValue({ vehicleId: 'v1', deleted: true }),
    };
    controller = new CertificationsController(service as never);
  });

  it('create() delega en el service armando files desde los arrays de multer', () => {
    const vehiclePhoto = { buffer: Buffer.from('x') } as Express.Multer.File;
    controller.create('v1', { mileage: 5 } as any, user, {
      vehiclePhoto: [vehiclePhoto],
    });

    expect(service.create).toHaveBeenCalledWith('v1', { mileage: 5 }, user, {
      vehiclePhoto,
      rimsPhoto: undefined,
    });
  });

  it('findOne() delega en el service', () => {
    controller.findOne('v1');
    expect(service.findOne).toHaveBeenCalledWith('v1');
  });

  it('update() delega en el service armando files desde los arrays de multer', () => {
    const rimsPhoto = { buffer: Buffer.from('y') } as Express.Multer.File;
    controller.update('v1', { mileage: 6 }, user, { rimsPhoto: [rimsPhoto] });

    expect(service.update).toHaveBeenCalledWith('v1', { mileage: 6 }, user, {
      vehiclePhoto: undefined,
      rimsPhoto,
    });
  });

  it('remove() delega en el service', () => {
    controller.remove('v1', user);
    expect(service.remove).toHaveBeenCalledWith('v1', user);
  });
});
