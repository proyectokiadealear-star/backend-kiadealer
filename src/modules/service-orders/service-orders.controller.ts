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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { SedeEnum } from '../../common/enums/sede.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Service Orders')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(private readonly svc: ServiceOrdersService) {}

  // ── CREAR OT ──────────────────────────────────────────────
  @Post()
  @ApiOperation({
    summary: 'Generar Orden de Trabajo',
    description:
      'Prerrequisito: vehículo en estado DOCUMENTADO. ' +
      'Extrae accesorios VENDIDO/OBSEQUIADO, acepta número de orden del usuario (o lo auto-genera), ' +
      'ejecuta predicción de accesorios adicionales, cambia estado a ORDEN_GENERADA y registra en statusHistory. ' +
      '**Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiBody({ type: CreateServiceOrderDto })
  @ApiResponse({ status: 201, description: 'OT creada. Retorna orderId, orderNumber, accessories y predictions' })
  @ApiResponse({ status: 400, description: 'Vehículo no está DOCUMENTADO o no tiene documentación' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  create(@Body() dto: CreateServiceOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.create(dto, user);
  }

  // ── REABRIR OT ───────────────────────────────────────────
  @Post('reopen')
  @ApiOperation({
    summary: 'Reabrir Orden de Trabajo',
    description:
      'Solo desde EN_INSTALACION o LISTO_PARA_ENTREGA. Crea una nueva OT referenciando la anterior (previousOrderId), ' +
      'cambia estado a REAPERTURA_OT con el motivo en statusHistory. ' +
      'Notifica a JEFE_TALLER y LIDER_TECNICO. **Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiBody({ type: ReopenOrderDto })
  @ApiResponse({ status: 201, description: 'Reapertura creada. Retorna orderId, orderNumber, isReopening: true' })
  @ApiResponse({ status: 400, description: 'Estado del vehículo no permite reapertura o newAccessories vacío/inválido' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  reopenOrder(@Body() dto: ReopenOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.reopenOrder(dto, user);
  }

  // ── LISTAR OTs ───────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'Listar órdenes de trabajo',
    description:
      'JEFE_TALLER ve todas las sedes. Otros roles sólo ven su propia sede. ' +
      'PERSONAL_TALLER solo verá OTs asignadas a su uid. **Roles:** todos',
  })
  @ApiQuery({ name: 'sede', enum: SedeEnum, required: false, description: 'Filtrar por sede (solo JEFE_TALLER)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filtrar por status de OT (GENERADA, ASIGNADA, EN_INSTALACION, INSTALACION_COMPLETA, LISTO_ENTREGA, REAPERTURA)' })
  @ApiQuery({ name: 'vehicleId', required: false, description: 'Filtrar por vehículo' })
  @ApiResponse({ status: 200, description: 'Lista de órdenes de trabajo' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sede') sede?: string,
    @Query('status') status?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.svc.findAll(user, { sede, status, vehicleId });
  }

  // ── PREDICCIONES ────────────────────────────────────────
  @Get('predictions/:vehicleId')
  @ApiOperation({
    summary: 'Predicciones de accesorios para un vehículo',
    description:
      'Ejecuta el algoritmo de predicción sobre el historial de clasificaciones. ' +
      'Retorna lista de { accessoryKey, probability, reason } con probability >= umbral (default 40%). ' +
      '**Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Lista de predicciones ordenadas por probabilidad descendente' })
  @ApiResponse({ status: 404, description: 'Vehículo o documentación no encontrada' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  getPredictions(@Param('vehicleId') vehicleId: string) {
    return this.svc.getPredictions(vehicleId);
  }

  // ── DETALLE OT ───────────────────────────────────────────
  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de una orden de trabajo',
    description: 'Retorna la OT con checklist, accesorios, predicciones y datos del técnico asignado. **Roles:** todos',
  })
  @ApiParam({ name: 'id', description: 'ID de la orden de trabajo (UUID)' })
  @ApiResponse({ status: 200, description: 'Datos completos de la OT' })
  @ApiResponse({ status: 404, description: 'Orden de trabajo no encontrada' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  // ── ASIGNAR / REASIGNAR TÉCNICO ──────────────────────────
  @Patch(':id/assign')
  @ApiOperation({
    summary: 'Asignar o reasignar técnico a la OT',
    description:
      'OT debe estar en estado GENERADA o ASIGNADA. ' +
      'Si ya había un técnico previo, se detecta automáticamente como **reasignación**: ' +
      'el técnico anterior recibe notificación TECNICO_REMOVIDO, el nuevo recibe TECNICO_ASIGNADO, ' +
      'y el historial registra la transición “X → Y”. ' +
      'Para listar técnicos disponibles usar **GET /users?role=PERSONAL_TALLER&sede={sede}&active=true**. ' +
      '**Roles:** LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID de la orden de trabajo (UUID)' })
  @ApiBody({ type: AssignTechnicianDto })
  @ApiResponse({ status: 200, description: 'Técnico asignado/reasignado. Retorna orderId, assignedTechnicianId, isReassignment' })
  @ApiResponse({ status: 400, description: 'La OT no está en estado GENERADA ni ASIGNADA' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Orden de trabajo no encontrada' })
  @Roles(RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  assignTechnician(
    @Param('id') id: string,
    @Body() dto: AssignTechnicianDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.assignTechnician(id, dto, user);
  }

  // ── CHECKLIST DE INSTALACIÓN ──────────────────────────
  @Patch(':id/checklist')
  @ApiOperation({
    summary: 'Actualizar checklist de instalación',
    description:
      'Solo el técnico asignado a la OT puede marcar accesorios (JEFE_TALLER y SOPORTE pueden hacerlo como override). ' +
      'La OT debe estar en estado **ASIGNADA** o **EN_INSTALACION**. ' +
      'Al marcar el último ítem → estado automático a INSTALACION_COMPLETA + notificación `INSTALACION_LISTA` a **LIDER_TECNICO** y **JEFE_TALLER**. ' +
      'Cada cambio registra entrada en statusHistory con `installedBy` e `installationCompleteDate`. **Roles:** PERSONAL_TALLER, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID de la orden de trabajo (UUID)' })
  @ApiBody({ type: UpdateChecklistDto })
  @ApiResponse({ status: 200, description: 'Checklist actualizado. Incluye allInstalled, newOrderStatus, vehicleNewStatus' })
  @ApiResponse({ status: 400, description: 'OT no está en estado ASIGNADA o EN_INSTALACION' })
  @ApiResponse({ status: 403, description: 'No eres el técnico asignado a esta OT' })
  @ApiResponse({ status: 404, description: 'Orden de trabajo o accesorio no encontrado' })
  @Roles(RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  updateChecklist(
    @Param('id') id: string,
    @Body() dto: UpdateChecklistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.updateChecklist(id, dto, user);
  }

  // ── LISTO PARA ENTREGA ───────────────────────────────
  @Patch(':id/ready-for-delivery')
  @ApiOperation({
    summary: 'Aprobar instalación y marcar listo para entrega',
    description:
      'Exclusivo de LIDER_TECNICO. Prerrequisito: `status === INSTALACION_COMPLETA`. ' +
      'Cambia estado a LISTO_PARA_ENTREGA, registra en statusHistory y notifica `LISTO_ENTREGA` a **ASESOR** y **JEFE_TALLER**. ' +
      '**Roles:** LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID de la orden de trabajo (UUID)' })
  @ApiResponse({ status: 200, description: 'Estado actualizado a LISTO_PARA_ENTREGA y ASESOR notificado' })
  @ApiResponse({ status: 400, description: 'Instalación no está completa aún' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Orden de trabajo no encontrada' })
  @Roles(RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  markReadyForDelivery(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.markReadyForDelivery(id, user);
  }
}

