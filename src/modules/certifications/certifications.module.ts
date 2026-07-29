import { Module } from '@nestjs/common';
import { CertificationsService } from './certifications.service';
import { CertificationsController } from './certifications.controller';
import { CertificationsRepository } from './certifications.repository';
import { VehicleFieldsRepository } from './vehicle-fields.repository';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [VehiclesModule, NotificationsModule],
  controllers: [CertificationsController],
  providers: [
    CertificationsService,
    CertificationsRepository,
    VehicleFieldsRepository,
  ],
  exports: [CertificationsService],
})
export class CertificationsModule {}
