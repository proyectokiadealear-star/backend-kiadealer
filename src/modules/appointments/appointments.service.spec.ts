import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let firebase: { serverTimestamp: jest.Mock };
  let vehiclesService: {
    assertExists: jest.Mock;
    changeStatus: jest.Mock;
    addStatusHistory: jest.Mock;
  };
  let notificationsService: { notify: jest.Mock };
  let appointmentsRepository: {
    create: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    findByAdvisorAndDate: jest.Mock;
    findScheduledForDate: jest.Mock;
    listAll: jest.Mock;
    paginateFiltered: jest.Mock;
    countFiltered: jest.Mock;
  };
  let vehicleBridge: { findManyAccessible: jest.Mock };

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

  const liderTecnico: AuthenticatedUser = {
    ...advisor,
    uid: 'lider-1',
    role: RoleEnum.LIDER_TECNICO,
  };

  const vehicleReadyForDelivery = {
    status: VehicleStatus.LISTO_PARA_ENTREGA,
    registrationReceivedDate: '2026-03-01',
    chassis: 'CH123',
    model: 'Sportage',
    color: 'Rojo',
    sede: SedeEnum.SURMOTOR,
    clientName: 'Ana',
    clientId: 'client-1',
  };

  beforeEach(() => {
    firebase = { serverTimestamp: jest.fn().mockReturnValue('SERVER_TS') };
    vehiclesService = {
      assertExists: jest.fn().mockResolvedValue(vehicleReadyForDelivery),
      changeStatus: jest.fn().mockResolvedValue(undefined),
      addStatusHistory: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = { notify: jest.fn().mockResolvedValue(undefined) };
    appointmentsRepository = {
      create: jest.fn().mockResolvedValue({ id: 'apt-1' }),
      findById: jest.fn(),
      update: jest.fn(),
      findByAdvisorAndDate: jest.fn().mockResolvedValue([]),
      findScheduledForDate: jest.fn().mockResolvedValue([]),
      listAll: jest.fn().mockResolvedValue([]),
      paginateFiltered: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      countFiltered: jest.fn().mockResolvedValue(0),
    };
    vehicleBridge = {
      findManyAccessible: jest.fn().mockResolvedValue(new Map()),
    };

    service = new AppointmentsService(
      firebase as never,
      vehiclesService as never,
      notificationsService as never,
      appointmentsRepository as never,
      vehicleBridge as never,
    );
  });

  describe('create()', () => {
    const dto = {
      vehicleId: 'vehicle-1',
      scheduledDate: '2026-03-15',
      scheduledTime: '10:00',
      assignedAdvisorId: 'advisor-1',
      assignedAdvisorName: 'Juan Pérez',
    };

    it('agenda la entrega y cambia el vehículo a AGENDADO', async () => {
      const result = await service.create(dto, advisor);

      expect(appointmentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: 'vehicle-1',
          status: 'AGENDADO',
        }),
        expect.any(String),
      );
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'vehicle-1',
        VehicleStatus.AGENDADO,
        advisor,
        expect.anything(),
      );
      expect(result).toEqual({
        aptId: 'apt-1',
        vehicleId: 'vehicle-1',
        newStatus: VehicleStatus.AGENDADO,
      });
    });

    it('nunca pasa tenantId al repositorio — el scope sale del contexto, no del service', async () => {
      await service.create(dto, advisor);

      const [payload] = appointmentsRepository.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(payload).not.toHaveProperty('tenantId');
    });

    it('rechaza si el vehículo no está LISTO_PARA_ENTREGA', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        ...vehicleReadyForDelivery,
        status: VehicleStatus.AGENDADO,
      });

      await expect(service.create(dto, advisor)).rejects.toThrow(
        BadRequestException,
      );
      expect(appointmentsRepository.create).not.toHaveBeenCalled();
    });

    it('rechaza sin matrícula recibida', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        ...vehicleReadyForDelivery,
        registrationReceivedDate: null,
      });

      await expect(service.create(dto, advisor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el asesor ya tiene un slot ocupado ese día y hora', async () => {
      appointmentsRepository.findByAdvisorAndDate.mockResolvedValue([
        {
          id: 'apt-existing',
          scheduledTime: '10:00',
          status: 'AGENDADO',
        },
      ]);

      await expect(service.create(dto, advisor)).rejects.toThrow(
        ConflictException,
      );
      expect(appointmentsRepository.create).not.toHaveBeenCalled();
    });

    it('ignora slots CANCELADO al validar conflicto', async () => {
      appointmentsRepository.findByAdvisorAndDate.mockResolvedValue([
        {
          id: 'apt-existing',
          scheduledTime: '10:00',
          status: 'CANCELADO',
        },
      ]);

      await expect(service.create(dto, advisor)).resolves.toEqual(
        expect.objectContaining({ vehicleId: 'vehicle-1' }),
      );
    });
  });

  describe('getOccupiedSlots()', () => {
    it('excluye los horarios CANCELADO', async () => {
      appointmentsRepository.findByAdvisorAndDate.mockResolvedValue([
        { scheduledTime: '09:00', status: 'AGENDADO' },
        { scheduledTime: '11:00', status: 'CANCELADO' },
      ]);

      const result = await service.getOccupiedSlots('advisor-1', '2026-03-15');

      expect(result).toEqual(['09:00']);
    });
  });

  describe('findAll() — scope por rol', () => {
    it('ASESOR solo ve sus propias citas asignadas', async () => {
      await service.findAll(advisor, {});

      expect(appointmentsRepository.listAll).toHaveBeenCalledWith(
        expect.objectContaining({ assignedAdvisorId: 'advisor-1' }),
      );
    });

    it('JEFE_TALLER ve todo, sin restricción de sede', async () => {
      await service.findAll(jefeTaller, {});

      const [filters] = appointmentsRepository.listAll.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(filters.sede).toBeUndefined();
      expect(filters.assignedAdvisorId).toBeUndefined();
    });

    it('LIDER_TECNICO ve solo las citas de su sede', async () => {
      await service.findAll(liderTecnico, {});

      expect(appointmentsRepository.listAll).toHaveBeenCalledWith(
        expect.objectContaining({ sede: SedeEnum.SURMOTOR }),
      );
    });

    it('vehicleId omite la restricción de rol/sede', async () => {
      await service.findAll(advisor, { vehicleId: 'vehicle-1' });

      expect(appointmentsRepository.listAll).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleId: 'vehicle-1' }),
      );
      const [filters] = appointmentsRepository.listAll.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(filters.assignedAdvisorId).toBeUndefined();
    });

    it('nunca pasa tenantId como filtro — el scope sale del contexto del repositorio', async () => {
      await service.findAll(advisor, {});

      const [filters] = appointmentsRepository.listAll.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(filters).not.toHaveProperty('tenantId');
    });
  });

  describe('findAll() — paginación por cursor', () => {
    it('sin page/limit/cursor devuelve el array plano (camino legacy)', async () => {
      appointmentsRepository.listAll.mockResolvedValue([
        { id: 'apt-1', clientName: 'Ana', color: 'Rojo', vehicleId: 'v1' },
      ]);

      const result = await service.findAll(advisor, {});

      expect(Array.isArray(result)).toBe(true);
      expect(appointmentsRepository.paginateFiltered).not.toHaveBeenCalled();
    });

    it('con cursor usa paginateFiltered() y countFiltered() en paralelo', async () => {
      appointmentsRepository.countFiltered.mockResolvedValue(3);
      appointmentsRepository.paginateFiltered.mockResolvedValue({
        items: [
          { id: 'apt-1', clientName: 'Ana', color: 'Rojo', vehicleId: 'v1' },
        ],
        nextCursor: 'cursor-abc',
        hasMore: true,
      });

      const result = await service.findAll(advisor, {
        cursor: 'some-cursor',
      });

      expect(appointmentsRepository.paginateFiltered).toHaveBeenCalledWith(
        expect.objectContaining({ assignedAdvisorId: 'advisor-1' }),
        expect.objectContaining({ cursor: 'some-cursor' }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          total: 3,
          nextCursor: 'cursor-abc',
        }),
      );
    });

    it('page>1 sin cursor lanza BadRequestException', async () => {
      await expect(service.findAll(advisor, { page: '2' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('enriquece los docs legacy sin clientName/color vía el bridge de vehicles', async () => {
      appointmentsRepository.listAll.mockResolvedValue([
        { id: 'apt-1', vehicleId: 'vehicle-1', clientName: null, color: null },
      ]);
      vehicleBridge.findManyAccessible.mockResolvedValue(
        new Map([['vehicle-1', { clientName: 'Ana', color: 'Rojo' }]]),
      );

      const result = (await service.findAll(advisor, {})) as Array<
        Record<string, unknown>
      >;

      expect(vehicleBridge.findManyAccessible).toHaveBeenCalledWith([
        'vehicle-1',
      ]);
      expect(result[0]).toEqual(
        expect.objectContaining({ clientName: 'Ana', color: 'Rojo' }),
      );
    });
  });

  describe('update()', () => {
    const existing = {
      id: 'apt-1',
      tenantId: 'kia-quito',
      vehicleId: 'vehicle-1',
      scheduledDate: '2026-03-15',
      scheduledTime: '10:00',
      assignedAdvisorId: 'advisor-1',
      assignedAdvisorName: 'Juan Pérez',
      status: 'AGENDADO',
    };

    beforeEach(() => {
      appointmentsRepository.findById.mockResolvedValue(existing);
      appointmentsRepository.update.mockResolvedValue({
        ...existing,
        scheduledTime: '11:00',
      });
    });

    it('lanza 404 si el agendamiento no existe (o es de otro tenant)', async () => {
      appointmentsRepository.findById.mockResolvedValue(null);

      await expect(
        service.update('apt-1', { scheduledTime: '11:00' }, advisor),
      ).rejects.toThrow(NotFoundException);
    });

    it('revalida conflicto de horario cuando cambia la hora', async () => {
      await service.update('apt-1', { scheduledTime: '11:00' }, advisor);

      expect(appointmentsRepository.findByAdvisorAndDate).toHaveBeenCalledWith(
        'advisor-1',
        '2026-03-15',
      );
    });

    it('no revalida conflicto si no cambian fecha/hora/asesor', async () => {
      await service.update('apt-1', { assignedAdvisorName: 'Otro' }, advisor);

      expect(
        appointmentsRepository.findByAdvisorAndDate,
      ).not.toHaveBeenCalled();
    });

    it('resetea reminderSentAt cuando cambia la fecha', async () => {
      await service.update('apt-1', { scheduledDate: '2026-03-20' }, advisor);

      expect(appointmentsRepository.update).toHaveBeenCalledWith(
        'apt-1',
        expect.objectContaining({ reminderSentAt: null }),
      );
    });

    it('registra el cambio en el historial del vehículo', async () => {
      await service.update('apt-1', { scheduledTime: '11:00' }, advisor);

      expect(vehiclesService.addStatusHistory).toHaveBeenCalledWith(
        'vehicle-1',
        VehicleStatus.AGENDADO,
        VehicleStatus.AGENDADO,
        advisor,
        advisor.sede,
        expect.stringContaining('hora:'),
      );
    });

    it('no toca el historial si no hay cambios detectables', async () => {
      await service.update('apt-1', {}, advisor);

      expect(vehiclesService.addStatusHistory).not.toHaveBeenCalled();
    });
  });
});
