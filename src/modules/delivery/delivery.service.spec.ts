import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SedeEnum } from '../../common/enums/sede.enum';
import { CreateCeremonyDto } from './dto/delivery.dto';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let firebase: {
    uploadBuffer: jest.Mock;
    getSignedUrl: jest.Mock;
    serverTimestamp: jest.Mock;
  };
  let vehiclesService: {
    assertExists: jest.Mock;
    changeStatus: jest.Mock;
  };
  let notificationsService: { notify: jest.Mock };
  let deliveryRepository: { create: jest.Mock; findById: jest.Mock };
  let appointmentLookup: { findById: jest.Mock; markStatus: jest.Mock };

  const advisor: AuthenticatedUser = {
    uid: 'advisor-1',
    email: 'advisor@kia.com',
    role: RoleEnum.ASESOR,
    active: true,
    sede: SedeEnum.SURMOTOR,
    tenantId: 'kia-quito',
  };

  const jefeTaller: AuthenticatedUser = {
    ...advisor,
    uid: 'jefe-1',
    role: RoleEnum.JEFE_TALLER,
  };

  const baseDto: CreateCeremonyDto = {
    appointmentId: 'apt-1',
    clientComment: 'Muy satisfecho',
  };

  const scheduledToday = () => {
    const tzOffsetHours = Number(process.env.TZ_OFFSET_HOURS ?? -5);
    const nowLocal = new Date(Date.now() + tzOffsetHours * 60 * 60 * 1000);
    return nowLocal.toISOString().slice(0, 10);
  };

  beforeEach(() => {
    firebase = {
      uploadBuffer: jest.fn().mockResolvedValue('path'),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed-url'),
      serverTimestamp: jest.fn().mockReturnValue('SERVER_TIMESTAMP'),
    };
    vehiclesService = {
      assertExists: jest.fn().mockResolvedValue({
        status: VehicleStatus.AGENDADO,
        chassis: 'CH123',
      }),
      changeStatus: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = { notify: jest.fn().mockResolvedValue(undefined) };
    deliveryRepository = {
      create: jest.fn().mockResolvedValue({ id: 'vehicle-1' }),
      findById: jest.fn(),
    };
    appointmentLookup = {
      findById: jest.fn().mockResolvedValue({
        assignedAdvisorId: 'advisor-1',
        scheduledDate: scheduledToday(),
      }),
      markStatus: jest.fn().mockResolvedValue(undefined),
    };

    service = new DeliveryService(
      firebase as never,
      vehiclesService as never,
      notificationsService as never,
      deliveryRepository as never,
      appointmentLookup as never,
    );
  });

  describe('createCeremony — camino de negocio', () => {
    it('crea la ceremonia, cambia el vehículo a ENTREGADO y marca el agendamiento', async () => {
      const result = await service.createCeremony(
        'vehicle-1',
        baseDto,
        advisor,
      );

      expect(deliveryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: 'vehicle-1',
          appointmentId: 'apt-1',
          deliveredBy: 'advisor-1',
        }),
        'vehicle-1',
      );
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'vehicle-1',
        VehicleStatus.ENTREGADO,
        advisor,
        expect.anything(),
      );
      const [, , , changeStatusOpts] = vehiclesService.changeStatus.mock
        .calls[0] as [
        string,
        string,
        unknown,
        { extraFields: Record<string, unknown> },
      ];
      expect(changeStatusOpts.extraFields).toEqual(
        expect.objectContaining({ deliveredBy: 'advisor-1' }),
      );
      expect(appointmentLookup.markStatus).toHaveBeenCalledWith(
        'apt-1',
        'ENTREGADO',
        'SERVER_TIMESTAMP',
      );
      expect(notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ESTADO_CAMBIADO',
          targetRole: RoleEnum.JEFE_TALLER,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          vehicleId: 'vehicle-1',
          newStatus: VehicleStatus.ENTREGADO,
        }),
      );
    });

    it('nunca pasa tenantId al repositorio — el scope sale del contexto, no del service', async () => {
      await service.createCeremony('vehicle-1', baseDto, advisor);

      const [payload] = deliveryRepository.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(payload).not.toHaveProperty('tenantId');
    });

    it('rechaza si el vehículo no está AGENDADO', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.LISTO_PARA_ENTREGA,
      });

      await expect(
        service.createCeremony('vehicle-1', baseDto, advisor),
      ).rejects.toThrow(BadRequestException);
      expect(deliveryRepository.create).not.toHaveBeenCalled();
    });

    it('rechaza con 404 si el agendamiento no existe', async () => {
      appointmentLookup.findById.mockResolvedValue(null);

      await expect(
        service.createCeremony('vehicle-1', baseDto, advisor),
      ).rejects.toThrow(NotFoundException);
      expect(deliveryRepository.create).not.toHaveBeenCalled();
    });

    it('rechaza si el asesor no es el asignado al agendamiento', async () => {
      appointmentLookup.findById.mockResolvedValue({
        assignedAdvisorId: 'otro-asesor',
        scheduledDate: scheduledToday(),
      });

      await expect(
        service.createCeremony('vehicle-1', baseDto, advisor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('JEFE_TALLER puede ejecutar la ceremonia aunque no sea el asesor asignado', async () => {
      appointmentLookup.findById.mockResolvedValue({
        assignedAdvisorId: 'otro-asesor',
        scheduledDate: '2000-01-01', // fuera de rango, pero JEFE_TALLER tiene override
      });

      await expect(
        service.createCeremony('vehicle-1', baseDto, jefeTaller),
      ).resolves.toEqual(
        expect.objectContaining({ newStatus: VehicleStatus.ENTREGADO }),
      );
    });

    it('rechaza si la fecha agendada ya pasó (más de un día) y el rol no tiene override', async () => {
      appointmentLookup.findById.mockResolvedValue({
        assignedAdvisorId: 'advisor-1',
        scheduledDate: '2000-01-01',
      });

      await expect(
        service.createCeremony('vehicle-1', baseDto, advisor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si la fecha agendada es futura y el rol no tiene override', async () => {
      appointmentLookup.findById.mockResolvedValue({
        assignedAdvisorId: 'advisor-1',
        scheduledDate: '2999-01-01',
      });

      await expect(
        service.createCeremony('vehicle-1', baseDto, advisor),
      ).rejects.toThrow(BadRequestException);
    });

    it('sube las fotos cuando vienen adjuntas y guarda las URLs firmadas', async () => {
      const files = {
        deliveryPhoto: { buffer: Buffer.from('a'), mimetype: 'image/jpeg' },
        signedActa: { buffer: Buffer.from('b'), mimetype: 'image/jpeg' },
      } as never;

      await service.createCeremony('vehicle-1', baseDto, advisor, files);

      expect(firebase.uploadBuffer).toHaveBeenCalledTimes(2);
      expect(deliveryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryPhotoUrl: 'https://signed-url',
          signedActaUrl: 'https://signed-url',
        }),
        'vehicle-1',
      );
    });

    it('funciona sin fotos adjuntas — quedan en null', async () => {
      await service.createCeremony('vehicle-1', baseDto, advisor);

      expect(firebase.uploadBuffer).not.toHaveBeenCalled();
      expect(deliveryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryPhotoUrl: null,
          signedActaUrl: null,
        }),
        'vehicle-1',
      );
    });

    it('propaga el fallo cerrado del repositorio en vez de silenciarlo', async () => {
      deliveryRepository.create.mockRejectedValue(
        new InternalServerErrorException(
          'Operación ejecutada fuera de un contexto de tenant.',
        ),
      );

      await expect(
        service.createCeremony('vehicle-1', baseDto, advisor),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getCeremony', () => {
    it('devuelve null si el repositorio no encuentra la ceremonia (incluye la de otro concesionario)', async () => {
      deliveryRepository.findById.mockResolvedValue(null);

      const result = await service.getCeremony('vehicle-1');

      expect(result).toBeNull();
      expect(deliveryRepository.findById).toHaveBeenCalledWith('vehicle-1');
    });

    it('regenera las signed URLs de foto y acta cuando existen', async () => {
      deliveryRepository.findById.mockResolvedValue({
        id: 'vehicle-1',
        tenantId: 'kia-quito',
        deliveryPhotoUrl: 'https://old-photo',
        signedActaUrl: 'https://old-acta',
      });

      const result = await service.getCeremony('vehicle-1');

      expect(firebase.getSignedUrl).toHaveBeenCalledWith(
        'vehicles/vehicle-1/delivery/ceremony-photo.jpg',
      );
      expect(firebase.getSignedUrl).toHaveBeenCalledWith(
        'vehicles/vehicle-1/delivery/signed-acta.jpg',
      );
      expect(result).toEqual(
        expect.objectContaining({
          deliveryPhotoUrl: 'https://signed-url',
          signedActaUrl: 'https://signed-url',
        }),
      );
    });

    it('no intenta regenerar URLs ausentes', async () => {
      deliveryRepository.findById.mockResolvedValue({
        id: 'vehicle-1',
        tenantId: 'kia-quito',
        deliveryPhotoUrl: null,
        signedActaUrl: null,
      });

      await service.getCeremony('vehicle-1');

      expect(firebase.getSignedUrl).not.toHaveBeenCalled();
    });

    it('conserva la URL vieja si falla la regeneración', async () => {
      firebase.getSignedUrl.mockRejectedValue(new Error('GCS caído'));
      deliveryRepository.findById.mockResolvedValue({
        id: 'vehicle-1',
        tenantId: 'kia-quito',
        deliveryPhotoUrl: 'https://old-photo',
        signedActaUrl: null,
      });

      const result = await service.getCeremony('vehicle-1');

      expect(result.deliveryPhotoUrl).toBe('https://old-photo');
    });
  });
});
