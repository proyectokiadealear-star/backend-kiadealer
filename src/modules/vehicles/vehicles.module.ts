import { Module } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExcelService } from './excel.service';

@Module({
  imports: [NotificationsModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, ExcelService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
