import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { FirebaseModule } from './firebase/firebase.module';
import { AuditModule } from './modules/audit/audit.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
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
import { HomeModule } from './modules/home/home.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    FirebaseModule,
    TenantsModule,
    AuditModule,
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
    HomeModule,
  ],
  providers: [
    // Abre el contexto de tenant cuando el token trae el claim `tenantId`.
    // Sin ese claim es un no-op, así que registrarlo ahora no afecta a los
    // usuarios existentes ni a las rutas públicas.
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    // TenantGuard NO se registra como APP_GUARD todavía, a propósito.
    //
    // Activarlo ahora rechazaría con 401 a todos los usuarios: sus tokens
    // aún no traen el claim `tenantId`, que vive en Firebase Auth y no en
    // Firestore. El orden obligatorio de la migración es:
    //   1. migrar los 14 módulos a TenantScopedRepository
    //   2. asignar tenantId a todos los documentos
    //   3. desplegar los índices con tenantId y esperar su construcción
    //   4. re-emitir los custom claims de todos los usuarios
    //   5. recién entonces registrar TenantGuard acá
    // Ver docs/design/01-multi-tenancy.md §5.
  ],
})
export class AppModule {}
