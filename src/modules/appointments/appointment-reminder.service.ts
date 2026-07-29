import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { AppointmentsRepository } from './appointments.repository';
import { TenantsService } from '../tenants/tenants.service';

/**
 * Cron job that runs every minute and sends a reminder notification
 * 30 minutes before a scheduled delivery to: ASESOR, LIDER_TECNICO,
 * JEFE_TALLER, and DOCUMENTACION.
 *
 * ── Por qué este archivo abre su propio TenantContext (el punto crítico
 *    de esta migración) ────────────────────────────────────────────────
 * `AppointmentsRepository` extiende `TenantScopedRepository`, cuyo
 * `scopedQuery()` llama `TenantContext.getOrThrow()` — revienta si no hay
 * contexto abierto (fallo cerrado, ver docs/design/01-multi-tenancy.md
 * D-101/D-103). Un `@Cron` NO corre dentro de una request: no pasa por
 * `TenantGuard` ni por `TenantContextInterceptor`, así que no hay
 * `AsyncLocalStorage` poblado. Migrar este servicio a
 * `AppointmentsRepository` sin resolver esto haría que la excepción se
 * lanzara en CADA ejecución del cron (cada minuto), silenciosamente
 * atrapada por el try/catch de logging — cero recordatorios enviados,
 * nunca, sin que nadie lo note hasta que un cliente se queje de no haber
 * recibido un aviso de entrega.
 *
 * Se descartó dejar este servicio con acceso directo a Firestore (la otra
 * opción que planteaba la migración): eso dejaría un agujero de aislamiento
 * real un cron que NO filtra por tenantId leería y notificaría
 * agendamientos de TODOS los concesionarios en una sola pasada. Es
 * exactamente el bug que D-101 a D-107 existen para prevenir, y un cron es
 * peor lugar para tenerlo que un endpoint: no hay guard, ni test de
 * integración de request, que lo agarre.
 *
 * La solución: en cada tick, enumerar los tenants ACTIVOS con
 * `TenantsService.listActiveIds()` — el mismo servicio que ya hace acceso
 * crudo legítimo a `tenants` para `TenantGuard` (esa colección define el
 * scope, así que filtrarla por tenantId no tendría sentido) — y, para cada
 * uno, abrir un `TenantContext.run()`
 * sintético con una identidad de sistema (`platformAdmin: true`, sin
 * usuario real) antes de tocar `AppointmentsRepository` o
 * `NotificationsService`. Así cada tenant se procesa con el mismo
 * aislamiento que tendría una request real de ese tenant — el repositorio
 * nunca ve más de un tenant a la vez — y un tenant que falla no frena a los
 * demás (se loguea y se sigue).
 *
 * Trade-off aceptado: con N tenants activos, cada tick hace 1 lectura de
 * `tenants` + N lecturas de `appointments` (antes era 1 lectura total, sin
 * aislamiento). El costo es proporcional a la cantidad de concesionarios
 * activos, no al volumen de datos, y es el precio correcto de tener
 * aislamiento real en un job que antes no lo tenía.
 */
@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  /** Roles that receive delivery reminders */
  private readonly REMINDER_ROLES: RoleEnum[] = [
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.DOCUMENTACION,
  ];

  constructor(
    private readonly firebase: FirebaseService,
    private readonly notificationsService: NotificationsService,
    private readonly appointmentsRepository: AppointmentsRepository,
    private readonly tenants: TenantsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDeliveryReminders(): Promise<void> {
    let tenantIds: string[];
    try {
      tenantIds = await this.tenants.listActiveIds();
    } catch (error) {
      this.logger.error(
        `No se pudo listar tenants activos para recordatorios: ${String(error)}`,
      );
      return;
    }

    for (const tenantId of tenantIds) {
      await this.runForTenant(tenantId);
    }
  }

  /**
   * Abre un TenantContext sintético para `tenantId` y corre los
   * recordatorios de ese concesionario. Un error en un tenant se loguea y
   * NO propaga: el resto de los tenants activos debe seguir procesándose en
   * el mismo tick.
   */
  private async runForTenant(tenantId: string): Promise<void> {
    const context: TenantContextData = {
      tenantId,
      // No hay usuario real detrás de un cron — se deja identificado como
      // actor de sistema para que audit_logs y logs de la app puedan
      // distinguirlo de una acción humana.
      userId: 'system:appointment-reminder-cron',
      role: RoleEnum.SOPORTE,
      establishmentIds: [],
      // El job en sí cruza tenants (uno por iteración) por diseño, no por
      // request de un usuario — platformAdmin refleja eso con precisión.
      platformAdmin: true,
      requestId: `cron-reminder-${randomUUID()}`,
    };

    try {
      await TenantContext.run(context, () => this.sendRemindersForTenant());
    } catch (error) {
      this.logger.error(
        `Error enviando recordatorios del tenant ${tenantId}: ${String(error)}`,
      );
    }
  }

  /**
   * Lógica de negocio original, sin cambios: para el tenant activo en el
   * TenantContext actual, busca agendamientos AGENDADO de hoy y notifica los
   * que caen dentro de la ventana de 30 minutos.
   */
  private async sendRemindersForTenant(): Promise<void> {
    const now = new Date();
    const todayStr = this.formatDate(now); // YYYY-MM-DD

    const appointments =
      await this.appointmentsRepository.findScheduledForDate(todayStr);

    if (appointments.length === 0) return;

    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    for (const apt of appointments) {
      // Skip if reminder was already sent
      if (apt.reminderSentAt) continue;

      // Parse scheduledTime "HH:MM" → minutes since midnight
      const scheduledMinutes = this.parseTimeToMinutes(apt.scheduledTime);
      if (scheduledMinutes === null) continue;

      // Check if the delivery is within the next 30 minutes (and not past)
      const minutesUntil = scheduledMinutes - nowMinutes;
      if (minutesUntil > 30 || minutesUntil < 0) continue;

      // Send reminder to all relevant roles
      const sede = apt.sede;
      const body = `Entrega del vehículo ${apt.chassis} (${apt.model}) programada a las ${apt.scheduledTime}${apt.clientName ? ` — Cliente: ${apt.clientName}` : ''} — Asesor: ${apt.assignedAdvisorName ?? 'N/A'}`;

      await Promise.all(
        this.REMINDER_ROLES.map((role) =>
          this.notificationsService.notify({
            type: 'RECORDATORIO_ENTREGA',
            targetRole: role,
            targetSede: role === RoleEnum.JEFE_TALLER ? 'ALL' : sede,
            title: '⏰ Entrega en 30 minutos',
            body,
            vehicleId: apt.vehicleId,
            chassis: apt.chassis,
            data: { advisorId: apt.assignedAdvisorId },
          }),
        ),
      );

      // Stamp reminderSentAt to prevent duplicate notifications
      await this.appointmentsRepository.update(apt.id!, {
        reminderSentAt: this.firebase.serverTimestamp(),
      });

      this.logger.log(
        `Reminder sent for appointment ${apt.id} — ${apt.chassis} at ${apt.scheduledTime} to ${this.REMINDER_ROLES.join(', ')}`,
      );
    }
  }

  /** Formats a Date as YYYY-MM-DD (local timezone) */
  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Parses "HH:MM" to minutes since midnight, or null if invalid */
  private parseTimeToMinutes(time: string): number | null {
    const parts = time?.split(':');
    if (!parts || parts.length !== 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }
}
