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
  @ApiResponse({
    status: 201,
    description:
      'OT creada. Retorna orderId, orderNumber, accessories y predictions',
  })
  @ApiResponse({
    status: 400,
    description: 'Vehículo no está DOCUMENTADO o no tiene documentación',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
  )
  create(
    @Body() dto: CreateServiceOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.create(dto, user);
  }

  // ── REABRIR OT ───────────────────────────────────────────
  @Post('reopen')
  @ApiOperation({
    summary: 'Reabrir Orden de Trabajo',
    description:
      'Solo desde EN_INSTALACION, INSTALACION_COMPLETA o LISTO_PARA_ENTREGA. ' +
      'Registra los accesorios solicitados y el motivo en el vehículo, cambia estado a DOCUMENTACION_PENDIENTE ' +
      'para que el asesor actualice la documentación (PATCH). Al completar la documentación, el vehículo vuelve a ASIGNADO ' +
      'y los nuevos accesorios se agregan al checklist de la OT existente. ' +
      'Notifica a ASESOR, JEFE_TALLER y LIDER_TECNICO. **Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiBody({ type: ReopenOrderDto })
  @ApiResponse({
    status: 201,
    description:
      'Reapertura iniciada. Retorna vehicleId, newStatus: DOCUMENTACION_PENDIENTE, isReopening: true, reopenAccessories, reason',
  })
  @ApiResponse({
    status: 400,
    description:
      'Estado del vehículo no permite reapertura o newAccessories vacío/inválido',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
  )
  reopenOrder(
    @Body() dto: ReopenOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.reopenOrder(dto, user);
  }

  // ── LISTAR OTs ───────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'Listar órdenes de trabajo (paginado)',
    description:
      'JEFE_TALLER ve todas las sedes. Otros roles sólo ven su propia sede. ' +
      'PERSONAL_TALLER solo verá OTs asignadas a su uid. ' +
      'Retorna `{ data, total, page, limit, totalPages }`. **Roles:** todos',
  })
  @ApiQuery({
    name: 'sede',
    enum: SedeEnum,
    required: false,
    description: 'Filtrar por sede (solo JEFE_TALLER)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Filtrar por status. Acepta uno o varios separados por coma: GENERADA,ASIGNADA,EN_INSTALACION,INSTALACION_COMPLETA,LISTO_PARA_ENTREGA,REAPERTURA_OT',
  })
  @ApiQuery({
    name: 'vehicleId',
    required: false,
    description: 'Filtrar por vehículo',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Número de página (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    description: 'Resultados por página, máximo 100 (default: 20)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Página de órdenes de trabajo. Responde `{ data: ServiceOrder[], total, page, limit, totalPages }`',
  })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.PERSONAL_TALLER,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
  )
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sede') sede?: string,
    @Query('status') status?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.findAll(user, {
      sede,
      status,
      vehicleId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
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
  @ApiResponse({
    status: 200,
    description: 'Lista de predicciones ordenadas por probabilidad descendente',
  })
  @ApiResponse({
    status: 404,
    description: 'Vehículo o documentación no encontrada',
  })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
  )
  getPredictions(@Param('vehicleId') vehicleId: string) {
    return this.svc.getPredictions(vehicleId);
  }

  // ── DETALLE OT ───────────────────────────────────────────
  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de una orden de trabajo',
    description:
      'Retorna la OT con checklist, accesorios, predicciones y datos del técnico asignado. **Roles:** todos',
  })
  @ApiParam({ name: 'id', description: 'ID de la orden de trabajo (UUID)' })
  @ApiResponse({ status: 200, description: 'Datos completos de la OT' })
  @ApiResponse({ status: 404, description: 'Orden de trabajo no encontrada' })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.PERSONAL_TALLER,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
  )
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  // ── ASIGNAR / REASIGNAR TÉCNICO ──────────────────────────
  @Patch(':id/assign')
  @ApiOperation({
    summary: 'Asignar o reasignar técnico a la OT',
    description:
      'OT debe estar en estado GENERADA, ASIGNADA o EN_INSTALACION. ' +
      'Si ya había un técnico previo, se detecta automáticamente como **reasignación**: ' +
      'el técnico anterior recibe notificación TECNICO_REMOVIDO, el nuevo recibe TECNICO_ASIGNADO, ' +
      'y el historial registra la transición "X → Y". ' +
      'Si el vehículo ya avanzó a EN_INSTALACION o INSTALACION_COMPLETA, la reasignación actualiza el técnico ' +
      'sin retroceder el estado del vehículo. ' +
      'Para listar técnicos disponibles usar **GET /users?role=PERSONAL_TALLER&sede={sede}&active=true**. ' +
      '**Roles:** LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID de la orden de trabajo (UUID)' })
  @ApiBody({ type: AssignTechnicianDto })
  @ApiResponse({
    status: 200,
    description:
      'Técnico asignado/reasignado. Retorna orderId, assignedTechnicianId, isReassignment',
  })
  @ApiResponse({
    status: 400,
    description: 'La OT no está en estado GENERADA, ASIGNADA ni EN_INSTALACION',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Orden de trabajo no encontrada' })
  @Roles(
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.ASESOR,
    RoleEnum.SOPORTE,
  )
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
  @ApiResponse({
    status: 200,
    description:
      'Checklist actualizado. Incluye allInstalled, newOrderStatus, vehicleNewStatus',
  })
  @ApiResponse({
    status: 400,
    description: 'OT no está en estado ASIGNADA o EN_INSTALACION',
  })
  @ApiResponse({
    status: 403,
    description: 'No eres el técnico asignado a esta OT',
  })
  @ApiResponse({
    status: 404,
    description: 'Orden de trabajo o accesorio no encontrado',
  })
  @Roles(RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  updateChecklist(
    @Param('id') id: string,
    @Body() dto: UpdateChecklistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.updateChecklist(id, dto, user);
  }

  // ── FINALIZAR INSTALACIÓN MANUAL (OT sin accesorios / seed) ──
  @Patch(':id/complete-installation')
  @ApiOperation({
    summary: 'Finalizar instalación manualmente',
    description:
      'Permite al técnico asignado marcar la OT como INSTALACION_COMPLETA sin requerir ' +
      'ítems en el checklist. Útil para OTs generadas desde seed sin accesorios. ' +
      'Prerrequisito: estado ASIGNADA o EN_INSTALACION. ' +
      '**Roles:** PERSONAL_TALLER, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID de la orden de trabajo (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'OT marcada como INSTALACION_COMPLETA',
  })
  @ApiResponse({
    status: 400,
    description: 'La OT no está en estado ASIGNADA o EN_INSTALACION',
  })
  @ApiResponse({
    status: 403,
    description: 'No eres el técnico asignado a esta OT',
  })
  @ApiResponse({ status: 404, description: 'Orden de trabajo no encontrada' })
  @Roles(RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  completeInstallation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.completeInstallation(id, user);
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
  @ApiResponse({
    status: 200,
    description: 'Estado actualizado a LISTO_PARA_ENTREGA y ASESOR notificado',
  })
  @ApiResponse({ status: 400, description: 'Instalación no está completa aún' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Orden de trabajo no encontrada' })
  @Roles(RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  markReadyForDelivery(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.markReadyForDelivery(id, user);
  }
}
