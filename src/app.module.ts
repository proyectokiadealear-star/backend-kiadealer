import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FirebaseModule } from './firebase/firebase.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CertificationsModule } from './modules/certifications/certifications.module';
import { DocumentationModule } from './modules/documentation/documentation.module';
import { ServiceOrdersModule } from './modules/service-orders/service-orders.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { UsersModule } from './modules/users/users.module';
import { CatalogsModule } from './modules/catalogs/catalogs.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SeedModule } from './modules/seed/seed.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    FirebaseModule,
    VehiclesModule,
    NotificationsModule,
    CertificationsModule,
    DocumentationModule,
    ServiceOrdersModule,
    AppointmentsModule,
    DeliveryModule,
    UsersModule,
    CatalogsModule,
    ReportsModule,
    SeedModule,
    AuthModule,
  ],
})
export class AppModule {}
