import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('vehicle/:vehicleId')
  @ApiOperation({ summary: 'Generar PDF de trazabilidad del vehículo' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO)
  async generateVehicleReport(
    @Param('vehicleId') vehicleId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.svc.generateVehicleReport(vehicleId, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reporte-${vehicleId}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Analytics y KPIs (JEFE_TALLER y SOPORTE)' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE, RoleEnum.SUPERVISOR)
  getAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: AnalyticsFiltersDto,
  ) {
    return this.svc.getAnalytics(user, filters);
  }

  @Get('technician-performance/:uid')
  @ApiOperation({ summary: 'Rendimiento de un técnico' })
  @Roles(RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER)
  getTechnicianPerformance(@Param('uid') uid: string) {
    return this.svc.getTechnicianPerformance(uid);
  }
}
