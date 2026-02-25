import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  // ── AGENDAR ENTREGA ───────────────────────────────────────
  @Post()
  @ApiOperation({
    summary: 'Agendar entrega de vehículo',
    description:
      'Prerrequisito: vehículo en estado `LISTO_PARA_ENTREGA`. ' +
      'Registra fecha, hora y asesor entregador, cambia estado a `AGENDADO` con nota en statusHistory. ' +
      'El `assignedAdvisorId` normalmente es el uid del usuario autenticado. ' +
      'Para listar asesores disponibles: `GET /users?role=ASESOR&sede={sede}&active=true`. ' +
      'Notifica `AGENDADO` al ASESOR asignado y al JEFE_TALLER. ' +
      '**Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiBody({ type: CreateAppointmentDto })
  @ApiResponse({ status: 201, description: 'Agendamiento creado. Retorna aptId, vehicleId, newStatus: AGENDADO' })
  @ApiResponse({ status: 400, description: 'Vehículo no está en estado LISTO_PARA_ENTREGA' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.create(dto, user);
  }

  // ── LISTAR AGENDAMIENTOS ──────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'Listar agendamientos',
    description:
      'JEFE_TALLER ve todas las sedes. Otros roles solo ven su sede. ' +
      'Filtrable por rango de fechas con `dateFrom` y `dateTo` (formato YYYY-MM-DD). ' +
      '**Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Fecha inicio filtro (YYYY-MM-DD)', example: '2026-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'Fecha fin filtro (YYYY-MM-DD)', example: '2026-03-31' })
  @ApiResponse({ status: 200, description: 'Lista de agendamientos ordenada por fecha ascendente' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.svc.findAll(user, dateFrom, dateTo);
  }

  // ── REAGENDAR / ACTUALIZAR ────────────────────────────────
  @Patch(':id')
  @ApiOperation({
    summary: 'Reagendar o actualizar agendamiento',
    description:
      'Permite cambiar fecha, hora o asesor asignado. ' +
      'Todos los campos son opcionales. Registra el cambio como audit trail en statusHistory del vehículo. ' +
      '**Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID del agendamiento (UUID)' })
  @ApiBody({ type: UpdateAppointmentDto })
  @ApiResponse({ status: 200, description: 'Agendamiento actualizado. Retorna aptId, updated: true' })
  @ApiResponse({ status: 404, description: 'Agendamiento no encontrado' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.update(id, dto, user);
  }
}

