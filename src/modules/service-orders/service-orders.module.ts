import { Module } from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersRepository } from './service-orders.repository';
import { VehicleFieldsRepository } from './vehicle-fields.repository';
import { DocumentationLookupRepository } from './documentation-lookup.repository';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [VehiclesModule, NotificationsModule],
  controllers: [ServiceOrdersController],
  providers: [
    ServiceOrdersService,
    ServiceOrdersRepository,
    VehicleFieldsRepository,
    DocumentationLookupRepository,
  ],
  exports: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
