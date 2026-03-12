import { Module } from '@nestjs/common';
import { HomeService } from './home.service';
import { HomeController } from './home.controller';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [VehiclesModule, ServiceOrdersModule, NotificationsModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
