import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationRecipientsRepository } from './notification-recipients.repository';

// FirebaseService y AuditService no necesitan importarse acá porque
// FirebaseModule y AuditModule son @Global() (mismo patrón que catalogs y delivery).
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    NotificationRecipientsRepository,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
