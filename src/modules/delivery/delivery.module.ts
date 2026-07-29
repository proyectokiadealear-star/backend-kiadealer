import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryRepository } from './delivery.repository';
import { AppointmentLookupRepository } from './appointment-lookup.repository';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [VehiclesModule, NotificationsModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryRepository, AppointmentLookupRepository],
  exports: [DeliveryService],
})
export class DeliveryModule {}
