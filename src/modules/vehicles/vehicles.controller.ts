import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
// FileInterceptor se usa solo en PATCH (update) — POST ya no sube foto
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { QueryVehiclesDto } from './dto/query-vehicles.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Vehicles')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly svc: VehiclesService) {}

  // ── CREATE ──────────────────────────────────────────────────────
  @Post()
  @ApiOperation({
    summary: 'Registrar vehículo (inventario contable)',
    description:
      'Crea el registro contable del vehículo con estado POR_ARRIBAR. ' +
      'Solo requiere datos de inventario (chasis, modelo, año, color). ' +
      'La foto y el concesionario de origen se registran en la certificación física. ' +
      'La sede se asigna automáticamente del claim del token. **Roles:** ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER, SOPORTE',
  })
  @ApiConsumes('application/json')
  @ApiBody({ type: CreateVehicleDto })
  @ApiResponse({ status: 201, description: 'Vehículo registrado con estado POR_ARRIBAR' })
  @ApiResponse({ status: 400, description: 'Chasis duplicado o año inválido' })
  @ApiResponse({ status: 401, description: 'Token inválido o ausente' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.DOCUMENTACION)
  create(
    @Body() dto: CreateVehicleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.create(dto, user);
  }

  // ── STATS ───────────────────────────────────────────────────────
  @Get('stats/by-sede')
  @ApiOperation({
    summary: 'KPIs de vehículos por sede',
    description: 'Retorna conteo de vehículos agrupados por sede y estado. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiResponse({ status: 200, description: 'Mapa de sede → { status: count }' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  statsBySede(@Query('sede') sede?: string) {
    return this.svc.statsBySede(sede);
  }

  @Get('stats/today-deliveries')
  @ApiOperation({
    summary: 'Entregas agendadas para hoy',
    description: 'Retorna vehículos con estado AGENDADO para la fecha actual. JEFE_TALLER y SOPORTE ven todas las sedes. **Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiResponse({ status: 200, description: 'Lista de vehículos agendados hoy' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  todayDeliveries(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.todayDeliveries(user);
  }

  // ── LIST ────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'Listar vehículos con filtros y paginación',
    description: 'Sin ?sede, cada rol ve solo su sede. JEFE_TALLER y SOPORTE ven todas. Soporta filtros por estado, chasis, cliente y paginación. **Roles:** todos',
  })
  @ApiResponse({ status: 200, description: '{ data: Vehicle[], total, page, limit }' })
  @ApiResponse({ status: 401, description: 'Token inválido o ausente' })
  findAll(
    @Query() query: QueryVehiclesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.findAll(query, user);
  }

  // ── SALE POTENTIAL (BATCH) ────────────────────────────────────────
  @Post('sale-potential-batch')
  @ApiOperation({
    summary: 'Potencial de venta en batch (múltiples vehículos)',
    description:
      'Calcula el potencial de venta de accesorios para múltiples vehículos en una sola llamada. ' +
      'Usa un único scan de la colección en vez de N scans individuales. Máximo 50 IDs. ' +
      '**Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { vehicleIds: { type: 'array', items: { type: 'string' }, maxItems: 50 } },
      required: ['vehicleIds'],
    },
  })
  @ApiResponse({ status: 200, description: 'Array de potenciales de venta para cada vehículo' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  getSalePotentialBatch(@Body() body: { vehicleIds: string[] }) {
    return this.svc.getSalePotentialBatch(body.vehicleIds ?? []);
  }

  // ── SALE POTENTIAL ──────────────────────────────────────────────
  @Get(':id/sale-potential')
  @ApiOperation({
    summary: 'Potencial de venta de accesorios del vehículo',
    description:
      'Calcula el porcentaje de accesorios vendidos/obsequiados vs los 13 disponibles (excluye «otros»). ' +
      'Incluye un potencial ponderado basado en el algoritmo de predicción y lista de oportunidades altas (prob. ≥ 40%). ' +
      '**Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Potencial de venta con desglose y predicciones' })
  @ApiResponse({ status: 400, description: 'El vehículo no tiene documentación registrada' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  getSalePotential(@Param('id') id: string) {
    return this.svc.getSalePotential(id);
  }

  // ── FIND ONE ────────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de vehículo',
    description: 'Retorna el vehículo con su certificación y documentación embebidas (si existen). JEFE_TALLER y SOPORTE pueden ver vehículos de cualquier sede. **Roles:** todos',
  })
  @ApiParam({ name: 'id', description: 'ID único del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Vehículo con certificación y documentación' })
  @ApiResponse({ status: 403, description: 'El vehículo pertenece a otra sede' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.findOne(id, user);
  }

  // ── STATUS HISTORY ──────────────────────────────────────────────
  @Get(':id/status-history')
  @ApiOperation({
    summary: 'Historial de estados del vehículo',
    description: 'Retorna todos los cambios de estado ordenados cronológicamente. **Roles:** todos',
  })
  @ApiParam({ name: 'id', description: 'ID único del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Lista de entradas del historial de estado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  getStatusHistory(@Param('id') id: string) {
    return this.svc.getStatusHistory(id);
  }

  // ── UPDATE ──────────────────────────────────────────────────────
  @Patch(':id')
  @ApiOperation({
    summary: 'Editar datos del vehículo',
    description:
      'Permite corregir cualquier campo del vehículo (incluyendo sede, status y foto). Si se envía una nueva foto, la anterior es eliminada de Firebase Storage automáticamente. Usar con precaución ya que omite las reglas de transición de estado. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID único del vehículo (UUID)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: UpdateVehicleDto })
  @ApiResponse({ status: 200, description: 'Vehículo actualizado' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  @UseInterceptors(FileInterceptor('photo'))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return this.svc.update(id, dto, photo);
  }

  // ── DELETE ──────────────────────────────────────────────────────
  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar vehículo',
    description: 'Elimina el vehículo permanentemente de la base de datos. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'id', description: 'ID único del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Vehículo eliminado' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}

