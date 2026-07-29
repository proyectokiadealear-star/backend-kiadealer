import { Module } from '@nestjs/common';
import { DocumentationService } from './documentation.service';
import { DocumentationController } from './documentation.controller';
import { DocumentationRepository } from './documentation.repository';
import { VehicleFieldsRepository } from './vehicle-fields.repository';
import { ServiceOrderLookupRepository } from './service-order-lookup.repository';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [VehiclesModule, NotificationsModule],
  controllers: [DocumentationController],
  providers: [
    DocumentationService,
    DocumentationRepository,
    VehicleFieldsRepository,
    ServiceOrderLookupRepository,
  ],
  exports: [DocumentationService],
})
export class DocumentationModule {}
