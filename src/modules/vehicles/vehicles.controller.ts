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
import { ExcelService } from './excel.service';

@ApiTags('Vehicles')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly svc: VehiclesService,
    private readonly excelSvc: ExcelService,
  ) {}

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
  @ApiResponse({
    status: 201,
    description: 'Vehículo registrado con estado POR_ARRIBAR',
  })
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

  // ── CARGA MASIVA ETL — PREVIEW (sin escritura en DB) ────────────
  @Post('preview-excel')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Preview del inventario Excel KDCS (sin escribir en DB)',
    description:
      'Procesa el Excel vía ETL Python y devuelve los registros parseados **sin tocar Firestore**. ' +
      'Úsalo para mostrar una vista previa al usuario antes de confirmar la carga. **Roles:** DOCUMENTACION',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Archivo Excel KDCS (.xlsx).' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Registros parseados por el ETL: { total, data[] }' })
  @ApiResponse({ status: 401, description: 'Token inválido o ausente' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 422, description: 'Archivo inválido o columnas faltantes' })
  @ApiResponse({ status: 500, description: 'ETL no disponible o error interno' })
  @Roles(RoleEnum.DOCUMENTACION)
  async previewExcel(@UploadedFile() file: Express.Multer.File) {
    return this.excelSvc.procesarExcel(file.buffer, file.originalname);
  }

  // ── CARGA MASIVA ETL — CONFIRMAR (upsert en Firestore) ──────────
  @Post('cargar-excel')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Carga masiva de inventario desde Excel KDCS',
    description:
      'Recibe el archivo Excel KDCS, lo procesa vía el microservicio ETL Python y ejecuta ' +
      'un upsert inteligente en Firestore. Vehículos en proceso activo (ORDEN_GENERADA+) no se modifican. ' +
      '**Roles:** DOCUMENTACION',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo Excel KDCS (.xlsx). Máximo 10 MB. Header en fila 9.',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Resultado del upsert: { total, insertados, actualizados, ignorados }',
    schema: {
      type: 'object',
      properties: {
        total:       { type: 'number', example: 412 },
        insertados:  { type: 'number', example: 5 },
        actualizados:{ type: 'number', example: 23 },
        ignorados:   { type: 'number', example: 384 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token inválido o ausente' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 422, description: 'Archivo inválido o columnas faltantes' })
  @ApiResponse({ status: 500, description: 'ETL no disponible o error interno' })
  @Roles(RoleEnum.DOCUMENTACION)
  async cargarExcel(@UploadedFile() file: Express.Multer.File) {
    const { data } = await this.excelSvc.procesarExcel(file.buffer, file.originalname);
    return this.svc.syncFromJson(data);
  }

  // ── STATS ───────────────────────────────────────────────────────
  @Get('stats/by-sede')
  @ApiOperation({
    summary: 'KPIs de vehículos por sede',
    description:
      'Retorna conteo de vehículos agrupados por sede y estado. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiResponse({ status: 200, description: 'Mapa de sede → { status: count }' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE, RoleEnum.SUPERVISOR)
  statsBySede(@Query('sede') sede?: string) {
    return this.svc.statsBySede(sede);
  }

  @Get('stats/today-deliveries')
  @ApiOperation({
    summary: 'Entregas agendadas para hoy',
    description:
      'Retorna vehículos con estado AGENDADO para la fecha actual. JEFE_TALLER y SOPORTE ven todas las sedes. **Roles:** ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE',
  })
  @ApiResponse({ status: 200, description: 'Lista de vehículos agendados hoy' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
    RoleEnum.SUPERVISOR,
  )
  todayDeliveries(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.todayDeliveries(user);
  }

  // ── LIST ────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'Listar vehículos con filtros y paginación',
    description:
      'Sin ?sede, cada rol ve solo su sede. JEFE_TALLER y SOPORTE ven todas. Soporta filtros por estado, chasis, cliente y paginación. **Roles:** todos',
  })
  @ApiResponse({
    status: 200,
    description: '{ data: Vehicle[], total, page, limit }',
  })
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
      properties: {
        vehicleIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      },
      required: ['vehicleIds'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Array de potenciales de venta para cada vehículo',
  })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
  )
  getSalePotentialBatch(@Body() body: { vehicleIds: string[] }) {
    return this.svc.getSalePotentialBatch(body.vehicleIds ?? []);
  }

  // ── ENTREGADOS RESUMEN (dashboard histórico) ────────────────────
  @Get('entregados/resumen')
  @ApiOperation({
    summary: 'Resumen agregado de vehículos ENTREGADO para el dashboard histórico',
    description:
      'Calcula en tiempo real el resumen de vehículos ENTREGADO con el mismo shape que ' +
      'entregados_historico.json (metadata, kpis_seguros, analisis_temporal, analisis_categorico). ' +
      'Soporta filtros opcionales: año, sede, modelo. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiQuery({ name: 'año', required: false, type: Number, example: 2026, description: 'Filtrar por año de entrega' })
  @ApiQuery({ name: 'fechaDesde', required: false, type: String, example: '2026-02-28', description: 'Filtrar deliveryDate >= fecha (YYYY-MM-DD)' })
  @ApiQuery({ name: 'sede', required: false, type: String, description: 'Filtrar por sede (ej. SURMOTOR)' })
  @ApiQuery({ name: 'modelo', required: false, type: String, description: 'Filtrar por modelo (ej. SOLUTO)' })
  @ApiResponse({ status: 200, description: 'Shape EntregadosJSON con datos en tiempo real' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE, RoleEnum.SUPERVISOR)
  getEntregadosResumen(
    @Query('año') año?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('sede') sede?: string,
    @Query('modelo') modelo?: string,
  ) {
    return this.svc.getEntregadosResumen({
      año: año ? Number(año) : undefined,
      fechaDesde: fechaDesde || undefined,
      sede: sede || undefined,
      modelo: modelo || undefined,
    });
  }

  // ── CALL CENTER ─────────────────────────────────────────────────
  @Get('call-center')
  @ApiOperation({
    summary: 'Lista call center — vehículos DOCUMENTADO→ENTREGADO con accesorios seguro/telemetría',
    description:
      'Retorna vehículos desde DOCUMENTADO hasta ENTREGADO con información de propietario y estado ' +
      'de sus accesorios de seguro y telemetría. Respuesta paginada compatible con PaginatedResponse<T>. ' +
      '**Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Página (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Ítems por página (default 100, máx 500)' })
  @ApiQuery({ name: 'sede', required: false, type: String, description: 'Filtrar por sede' })
  @ApiQuery({ name: 'model', required: false, type: String, description: 'Filtrar por modelo (normaliza KIA prefix)' })
  @ApiQuery({ name: 'status', required: false, type: String, description: 'Estado o lista CSV de estados del pipeline call center' })
  @ApiQuery({ name: 'dateFrom', required: false, type: String, description: 'Fecha inicial yyyy-MM-dd para el período del call center' })
  @ApiQuery({ name: 'dateTo', required: false, type: String, description: 'Fecha final yyyy-MM-dd para el período del call center' })
  @ApiResponse({
    status: 200,
    description: 'PaginatedResponse<CallCenterVehicle>',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE, RoleEnum.SUPERVISOR)
  getCallCenterList(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sede') sede?: string,
    @Query('model') model?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const parsedPage = page ? Math.max(1, Number(page)) : 1;
    const parsedLimit = limit ? Math.min(Number(limit), 500) : 100;
    return this.svc.getCallCenterList(parsedPage, parsedLimit, {
      sede: sede || undefined,
      model: model || undefined,
      status: status || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
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
  @ApiResponse({
    status: 200,
    description: 'Potencial de venta con desglose y predicciones',
  })
  @ApiResponse({
    status: 400,
    description: 'El vehículo no tiene documentación registrada',
  })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(
    RoleEnum.ASESOR,
    RoleEnum.LIDER_TECNICO,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
  )
  getSalePotential(@Param('id') id: string) {
    return this.svc.getSalePotential(id);
  }

  // ── PREVIEW ENTREGADOS POR RANGO DE AÑOS ────────────────────────
  @Get('delivered/preview')
  @ApiOperation({
    summary: 'Previsualizar vehículos ENTREGADO en un rango de años',
    description:
      'Retorna la lista de vehículos con estado `ENTREGADO` cuya `deliveryDate` cae dentro del rango `fromYear`–`toYear` (inclusive). ' +
      'Úsalo **antes** de ejecutar la eliminación batch para verificar exactamente qué registros serán afectados. ' +
      'No modifica ningún dato. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiQuery({
    name: 'fromYear',
    required: true,
    type: Number,
    example: 2021,
    description: 'Año de inicio del rango (inclusive)',
  })
  @ApiQuery({
    name: 'toYear',
    required: true,
    type: Number,
    example: 2025,
    description: 'Año de fin del rango (inclusive)',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ count: number, fromYear, toYear, vehicles: [{ id, chassis, model, year, color, sede, deliveryDate }] }',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', example: 47 },
        fromYear: { type: 'number', example: 2021 },
        toYear: { type: 'number', example: 2025 },
        vehicles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              chassis: { type: 'string' },
              model: { type: 'string' },
              year: { type: 'number' },
              color: { type: 'string' },
              sede: { type: 'string' },
              deliveryDate: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  previewDeliveredByYear(
    @Query('fromYear') fromYear: string,
    @Query('toYear') toYear: string,
  ) {
    return this.svc.previewDeliveredByYear(Number(fromYear), Number(toYear));
  }

  // ── ELIMINAR ENTREGADOS POR RANGO DE AÑOS (BATCH) ───────────────
  @Delete('delivered/batch')
  @ApiOperation({
    summary: 'Eliminar vehículos ENTREGADO en un rango de años',
    description:
      '⚠️ **Operación irreversible.** Elimina permanentemente todos los vehículos con estado `ENTREGADO` ' +
      'cuya `deliveryDate` cae dentro del rango `fromYear`–`toYear` (inclusive). ' +
      'Incluye cascada completa: certifications, documentations, deliveryCeremonies, appointments, service-orders, statusHistory y Storage. ' +
      'Se recomienda ejecutar primero `GET /vehicles/delivered/preview` para confirmar el alcance. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fromYear', 'toYear'],
      properties: {
        fromYear: {
          type: 'number',
          example: 2021,
          description: 'Año de inicio del rango (inclusive)',
        },
        toYear: {
          type: 'number',
          example: 2025,
          description: 'Año de fin del rango (inclusive)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '{ deleted: number, errors: [] }',
    schema: {
      type: 'object',
      properties: {
        deleted: { type: 'number', example: 47 },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              chassis: { type: 'string' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  removeDeliveredByYear(@Body() body: { fromYear: number; toYear: number }) {
    return this.svc.removeDeliveredByYear(body.fromYear, body.toYear);
  }

  // ── FIND ONE ────────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de vehículo',
    description:
      'Retorna el vehículo con su certificación y documentación embebidas (si existen). JEFE_TALLER y SOPORTE pueden ver vehículos de cualquier sede. **Roles:** todos',
  })
  @ApiParam({ name: 'id', description: 'ID único del vehículo (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Vehículo con certificación y documentación',
  })
  @ApiResponse({
    status: 403,
    description: 'El vehículo pertenece a otra sede',
  })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.findOne(id, user);
  }

  // ── STATUS HISTORY ──────────────────────────────────────────────
  @Get(':id/status-history')
  @ApiOperation({
    summary: 'Historial de estados del vehículo',
    description:
      'Retorna todos los cambios de estado ordenados cronológicamente. **Roles:** todos',
  })
  @ApiParam({ name: 'id', description: 'ID único del vehículo (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Lista de entradas del historial de estado',
  })
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
    description:
      'Elimina el vehículo permanentemente de la base de datos. **Roles:** JEFE_TALLER, SOPORTE',
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
