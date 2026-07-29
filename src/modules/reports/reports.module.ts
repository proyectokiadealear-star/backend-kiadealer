import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { VehicleLookupRepository } from './vehicle-lookup.repository';
import {
  ReportServiceOrdersRepository,
  ReportDocumentationsRepository,
  ReportDeliveryCeremoniesRepository,
  ReportAppointmentsRepository,
  ReportAccessoriesCatalogRepository,
} from './reports.repository';

// FirebaseService y AuditService no se importan acá: FirebaseModule y
// AuditModule son @Global() (mismo patrón que UsersModule y CatalogsModule).
// VehiclesModule ya no hace falta: ReportsService no invocaba VehiclesService
// (era un import muerto) y ahora lee `vehicles` a través de su propio puente.
@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    VehicleLookupRepository,
    ReportServiceOrdersRepository,
    ReportDocumentationsRepository,
    ReportDeliveryCeremoniesRepository,
    ReportAppointmentsRepository,
    ReportAccessoriesCatalogRepository,
  ],
})
export class ReportsModule {}
