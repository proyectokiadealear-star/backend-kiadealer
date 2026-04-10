import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentReminderService } from './appointment-reminder.service';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [VehiclesModule, NotificationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentReminderService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
