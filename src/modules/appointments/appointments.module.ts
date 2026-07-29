import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AppointmentsRepository } from './appointments.repository';
import { AppointmentVehicleBridgeRepository } from './appointment-vehicle-bridge.repository';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { NotificationsModule } from '../notifications/notifications.module';

// FirebaseService, AuditService y TenantsService no necesitan importarse acá
// porque FirebaseModule, AuditModule y TenantsModule son @Global() (mismo
// patrón que notifications y delivery).
@Module({
  imports: [VehiclesModule, NotificationsModule],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentReminderService,
    AppointmentsRepository,
    AppointmentVehicleBridgeRepository,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
