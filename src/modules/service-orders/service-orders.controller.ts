import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServiceOrdersService } from './service-orders.service';
import {
  CreateServiceOrderDto,
  AssignTechnicianDto,
  UpdateChecklistDto,
  ReopenOrderDto,
} from './dto/service-order.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Service Orders')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(private readonly svc: ServiceOrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Generar Orden de Trabajo' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER)
  create(@Body() dto: CreateServiceOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.create(dto, user);
  }

  @Post('reopen')
  @ApiOperation({ summary: 'Reabrir Orden de Trabajo' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER)
  reopenOrder(@Body() dto: ReopenOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.reopenOrder(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Listar Ã³rdenes de trabajo' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sede') sede?: string,
    @Query('status') status?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.svc.findAll(user, { sede, status, vehicleId });
  }

  @Get('predictions/:vehicleId')
  @ApiOperation({ summary: 'Predicciones de accesorios para un vehÃ­culo' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER)
  getPredictions(@Param('vehicleId') vehicleId: string) {
    return this.svc.getPredictions(vehicleId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de orden de trabajo' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Asignar tÃ©cnico a la OT (solo LIDER_TECNICO)' })
  @Roles(RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER)
  assignTechnician(
    @Param('id') id: string,
    @Body() dto: AssignTechnicianDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.assignTechnician(id, dto, user);
  }

  @Patch(':id/checklist')
  @ApiOperation({ summary: 'Actualizar checklist de instalaciÃ³n (PERSONAL_TALLER)' })
  @Roles(RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER)
  updateChecklist(
    @Param('id') id: string,
    @Body() dto: UpdateChecklistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.updateChecklist(id, dto, user);
  }

  @Patch(':id/ready-for-delivery')
  @ApiOperation({ summary: 'Marcar vehÃ­culo listo para entrega (LIDER_TECNICO)' })
  @Roles(RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER)
  markReadyForDelivery(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.markReadyForDelivery(id, user);
  }
}

