import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { CreateCeremonyDto } from './dto/delivery.dto';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

describe('DeliveryController', () => {
  let controller: DeliveryController;
  let svc: { createCeremony: jest.Mock; getCeremony: jest.Mock };

  const user: AuthenticatedUser = {
    uid: 'advisor-1',
    email: 'advisor@kia.com',
    role: RoleEnum.ASESOR,
    active: true,
    sede: SedeEnum.SURMOTOR,
    tenantId: 'kia-quito',
  };

  beforeEach(() => {
    svc = {
      createCeremony: jest.fn().mockResolvedValue({ vehicleId: 'vehicle-1' }),
      getCeremony: jest.fn().mockResolvedValue({ vehicleId: 'vehicle-1' }),
    };
    controller = new DeliveryController(svc as unknown as DeliveryService);
  });

  it('createCeremony() delega en el service con los archivos desempaquetados', async () => {
    const dto: CreateCeremonyDto = { appointmentId: 'apt-1' };
    const files: {
      deliveryPhoto: Express.Multer.File[];
      signedActa: Express.Multer.File[];
    } = {
      deliveryPhoto: [{ buffer: Buffer.from('a') } as Express.Multer.File],
      signedActa: [{ buffer: Buffer.from('b') } as Express.Multer.File],
    };

    const result = await controller.createCeremony(
      'vehicle-1',
      dto,
      user,
      files,
    );

    expect(svc.createCeremony).toHaveBeenCalledWith('vehicle-1', dto, user, {
      deliveryPhoto: files.deliveryPhoto[0],
      signedActa: files.signedActa[0],
    });
    expect(result).toEqual({ vehicleId: 'vehicle-1' });
  });

  it('createCeremony() funciona sin archivos adjuntos', async () => {
    const dto: CreateCeremonyDto = { appointmentId: 'apt-1' };

    await controller.createCeremony('vehicle-1', dto, user, undefined);

    expect(svc.createCeremony).toHaveBeenCalledWith('vehicle-1', dto, user, {
      deliveryPhoto: undefined,
      signedActa: undefined,
    });
  });

  it('getCeremony() delega en el service', async () => {
    const result = await controller.getCeremony('vehicle-1');

    expect(svc.getCeremony).toHaveBeenCalledWith('vehicle-1');
    expect(result).toEqual({ vehicleId: 'vehicle-1' });
  });
});
