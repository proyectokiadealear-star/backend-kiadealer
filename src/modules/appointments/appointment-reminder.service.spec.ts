import { AppointmentReminderService } from './appointment-reminder.service';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';

/**
 * El punto crítico de esta migración: un @Cron no corre dentro de una
 * request, así que no hay TenantContext abierto por TenantGuard/
 * TenantContextInterceptor. Estas pruebas verifican que el servicio abre su
 * propio contexto sintético por cada tenant activo — nunca procesa más de
 * un tenant a la vez — y que un tenant que falla no frena a los demás.
 */
describe('AppointmentReminderService', () => {
  let service: AppointmentReminderService;
  let firebase: { serverTimestamp: jest.Mock };
  let notificationsService: { notify: jest.Mock };
  let appointmentsRepository: {
    findScheduledForDate: jest.Mock;
    update: jest.Mock;
  };
  let activeTenants: { listActiveIds: jest.Mock };

  const baseAppointment = {
    id: 'apt-1',
    vehicleId: 'vehicle-1',
    chassis: 'CH123',
    model: 'Sportage',
    sede: 'SURMOTOR',
    clientName: 'Ana',
    assignedAdvisorId: 'advisor-1',
    assignedAdvisorName: 'Juan Pérez',
    status: 'AGENDADO',
    scheduledTime: '15:00',
    reminderSentAt: null,
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 15, 14, 45, 0)); // 14:45 local, 15 min antes de las 15:00

    firebase = { serverTimestamp: jest.fn().mockReturnValue('SERVER_TS') };
    notificationsService = { notify: jest.fn().mockResolvedValue(undefined) };
    appointmentsRepository = {
      findScheduledForDate: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    };
    activeTenants = {
      listActiveIds: jest.fn().mockResolvedValue([]),
    };

    service = new AppointmentReminderService(
      firebase as never,
      notificationsService as never,
      appointmentsRepository as never,
      activeTenants as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('fallo cerrado sin lista de tenants', () => {
    it('no lanza si listActiveIds() falla — se loguea y el tick termina', async () => {
      activeTenants.listActiveIds.mockRejectedValue(
        new Error('Firestore caído'),
      );

      await expect(service.handleDeliveryReminders()).resolves.toBeUndefined();
      expect(
        appointmentsRepository.findScheduledForDate,
      ).not.toHaveBeenCalled();
    });

    it('no hace nada si no hay tenants activos', async () => {
      activeTenants.listActiveIds.mockResolvedValue([]);

      await service.handleDeliveryReminders();

      expect(
        appointmentsRepository.findScheduledForDate,
      ).not.toHaveBeenCalled();
    });
  });

  describe('abre un TenantContext por cada tenant activo — nunca corre sin contexto', () => {
    it('abre el contexto del tenant antes de consultar AppointmentsRepository', async () => {
      activeTenants.listActiveIds.mockResolvedValue(['kia-quito']);
      let capturedContext: TenantContextData | undefined;
      appointmentsRepository.findScheduledForDate.mockImplementation(() => {
        capturedContext = TenantContext.get();
        return Promise.resolve([]);
      });

      await service.handleDeliveryReminders();

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.tenantId).toBe('kia-quito');
      expect(capturedContext?.platformAdmin).toBe(true);
    });

    it('no hay contexto de tenant abierto ANTES de que el servicio abra el suyo', () => {
      // Precondición del escenario: fuera de handleDeliveryReminders(), como
      // corre un @Cron real, no hay AsyncLocalStorage poblado.
      expect(TenantContext.get()).toBeUndefined();
    });

    it('procesa cada tenant activo con SU PROPIO tenantId — aislamiento entre tenants', async () => {
      activeTenants.listActiveIds.mockResolvedValue([
        'kia-quito',
        'mazda-guayaquil',
      ]);
      const seenTenantIds: string[] = [];
      appointmentsRepository.findScheduledForDate.mockImplementation(() => {
        seenTenantIds.push(TenantContext.getOrThrow().tenantId);
        return Promise.resolve([]);
      });

      await service.handleDeliveryReminders();

      expect(seenTenantIds).toEqual(['kia-quito', 'mazda-guayaquil']);
    });

    it('busca los agendamientos AGENDADO de la fecha de hoy, formateada localmente', async () => {
      activeTenants.listActiveIds.mockResolvedValue(['kia-quito']);

      await service.handleDeliveryReminders();

      expect(appointmentsRepository.findScheduledForDate).toHaveBeenCalledWith(
        '2026-03-15',
      );
    });
  });

  describe('un tenant que falla no frena a los demás', () => {
    it('sigue procesando el resto de los tenants activos', async () => {
      activeTenants.listActiveIds.mockResolvedValue([
        'kia-quito',
        'mazda-guayaquil',
      ]);
      appointmentsRepository.findScheduledForDate
        .mockRejectedValueOnce(new Error('Falla puntual en kia-quito'))
        .mockResolvedValueOnce([]);

      await expect(service.handleDeliveryReminders()).resolves.toBeUndefined();

      expect(appointmentsRepository.findScheduledForDate).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe('lógica de recordatorio (una vez dentro del contexto del tenant)', () => {
    beforeEach(() => {
      activeTenants.listActiveIds.mockResolvedValue(['kia-quito']);
    });

    it('notifica cuando la entrega es dentro de los próximos 30 minutos', async () => {
      appointmentsRepository.findScheduledForDate.mockResolvedValue([
        { ...baseAppointment },
      ]);

      await service.handleDeliveryReminders();

      expect(notificationsService.notify).toHaveBeenCalledTimes(4); // REMINDER_ROLES
      expect(notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RECORDATORIO_ENTREGA',
          targetRole: RoleEnum.ASESOR,
          vehicleId: 'vehicle-1',
        }),
      );
      expect(appointmentsRepository.update).toHaveBeenCalledWith('apt-1', {
        reminderSentAt: 'SERVER_TS',
      });
    });

    it('JEFE_TALLER recibe el aviso con targetSede ALL, el resto con la sede del agendamiento', async () => {
      appointmentsRepository.findScheduledForDate.mockResolvedValue([
        { ...baseAppointment },
      ]);

      await service.handleDeliveryReminders();

      expect(notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRole: RoleEnum.JEFE_TALLER,
          targetSede: 'ALL',
        }),
      );
      expect(notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRole: RoleEnum.ASESOR,
          targetSede: 'SURMOTOR',
        }),
      );
    });

    it('no notifica si el recordatorio ya se envió', async () => {
      appointmentsRepository.findScheduledForDate.mockResolvedValue([
        { ...baseAppointment, reminderSentAt: 'ya-enviado' },
      ]);

      await service.handleDeliveryReminders();

      expect(notificationsService.notify).not.toHaveBeenCalled();
      expect(appointmentsRepository.update).not.toHaveBeenCalled();
    });

    it('no notifica si la entrega está a más de 30 minutos', async () => {
      appointmentsRepository.findScheduledForDate.mockResolvedValue([
        { ...baseAppointment, scheduledTime: '16:00' },
      ]);

      await service.handleDeliveryReminders();

      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('no notifica si la entrega ya pasó', async () => {
      appointmentsRepository.findScheduledForDate.mockResolvedValue([
        { ...baseAppointment, scheduledTime: '14:00' },
      ]);

      await service.handleDeliveryReminders();

      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('ignora agendamientos con scheduledTime inválido', async () => {
      appointmentsRepository.findScheduledForDate.mockResolvedValue([
        { ...baseAppointment, scheduledTime: 'no-es-hora' },
      ]);

      await expect(service.handleDeliveryReminders()).resolves.toBeUndefined();
      expect(notificationsService.notify).not.toHaveBeenCalled();
    });
  });
});
