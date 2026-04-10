import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirebaseService } from '../../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RoleEnum } from '../../common/enums/role.enum';

/**
 * Cron job that runs every minute and sends a reminder notification
 * 30 minutes before a scheduled delivery to: ASESOR, LIDER_TECNICO,
 * JEFE_TALLER, and DOCUMENTACION.
 *
 * Logic:
 * 1. Query all appointments with status AGENDADO for today's date
 * 2. For each, check if scheduledTime is within the next 30 minutes
 * 3. If reminderSentAt is not set, send the notification and stamp it
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
  ) {}

  private get db() {
    return this.firebase.firestore();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDeliveryReminders(): Promise<void> {
    try {
      const now = new Date();
      const todayStr = this.formatDate(now); // YYYY-MM-DD

      // Query appointments for today that are still AGENDADO
      const snapshot = await this.db
        .collection('appointments')
        .where('scheduledDate', '==', todayStr)
        .where('status', '==', 'AGENDADO')
        .get();

      if (snapshot.empty) return;

      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      for (const doc of snapshot.docs) {
        const apt = doc.data();

        // Skip if reminder was already sent
        if (apt['reminderSentAt']) continue;

        // Parse scheduledTime "HH:MM" → minutes since midnight
        const scheduledMinutes = this.parseTimeToMinutes(apt['scheduledTime'] as string);
        if (scheduledMinutes === null) continue;

        // Check if the delivery is within the next 30 minutes (and not past)
        const minutesUntil = scheduledMinutes - nowMinutes;
        if (minutesUntil > 30 || minutesUntil < 0) continue;

        // Send reminder to all relevant roles
        const sede = apt['sede'] as string;
        const body = `Entrega del vehículo ${apt['chassis']} (${apt['model']}) programada a las ${apt['scheduledTime']}${apt['clientName'] ? ` — Cliente: ${apt['clientName']}` : ''} — Asesor: ${apt['assignedAdvisorName'] ?? 'N/A'}`;

        await Promise.all(
          this.REMINDER_ROLES.map((role) =>
            this.notificationsService.notify({
              type: 'RECORDATORIO_ENTREGA',
              targetRole: role,
              targetSede: role === RoleEnum.JEFE_TALLER ? 'ALL' : sede,
              title: '⏰ Entrega en 30 minutos',
              body,
              vehicleId: apt['vehicleId'] as string,
              chassis: apt['chassis'] as string,
              data: { advisorId: apt['assignedAdvisorId'] as string },
            }),
          ),
        );

        // Stamp reminderSentAt to prevent duplicate notifications
        await this.db.collection('appointments').doc(doc.id).update({
          reminderSentAt: this.firebase.serverTimestamp(),
        });

        this.logger.log(
          `Reminder sent for appointment ${doc.id} — ${apt['chassis']} at ${apt['scheduledTime']} to ${this.REMINDER_ROLES.join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error in delivery reminder cron: ${String(error)}`);
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
