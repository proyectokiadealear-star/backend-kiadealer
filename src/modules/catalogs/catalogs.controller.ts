import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CatalogsService } from './catalogs.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import { IsString, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class NameDto {
  @ApiProperty({ description: 'Nombre del ítem. Se almacena en MAYUSCULAS.', example: 'BLANCO PERLA' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  name: string;
}

class NameCodeDto {
  @ApiProperty({ description: 'Nombre de la sede. Se almacena en MAYUSCULAS.', example: 'SURMOTOR NORTE' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  name: string;

  @ApiProperty({ description: 'Código corto de la sede. Se almacena en MAYUSCULAS.', example: 'SMN' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  code: string;
}

class AccessoryDto {
  @ApiProperty({
    description: 'Nombre visible del accesorio. Se almacena en MAYUSCULAS.',
    example: 'BOTÓN DE ENCENDIDO',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  name: string;

  @ApiProperty({
    description:
      'Clave interna del accesorio. Debe coincidir con un valor del enum AccessoryKey. Se almacena en MAYUSCULAS.',
    example: 'BOTON_ENCENDIDO',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  key: string;
}

@ApiTags('Catalogs')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly svc: CatalogsService) {}

  // ── COLORES ─────────────────────────────────────────
  @Get('colors')
  @ApiOperation({ summary: 'Listar colores del catálogo', description: 'Sin autenticación de roles. **Roles:** todos.' })
  @ApiResponse({ status: 200, description: 'Lista de colores ordenada alfabéticamente' })
  getColors() { return this.svc.getColors(); }

  @Post('colors')
  @ApiOperation({ summary: 'Crear color', description: '**Roles:** JEFE_TALLER, DOCUMENTACION, SOPORTE' })
  @ApiBody({ type: NameDto })
  @ApiResponse({ status: 201, description: 'Color creado. Nombre almacenado en MAYUSCULAS.' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION, RoleEnum.SOPORTE)
  createColor(@Body() dto: NameDto) { return this.svc.createColor(dto.name); }

  @Patch('colors/:id')
  @ApiOperation({ summary: 'Editar nombre de color', description: '**Roles:** JEFE_TALLER, DOCUMENTACION, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del color' })
  @ApiBody({ type: NameDto })
  @ApiResponse({ status: 200, description: 'Color actualizado' })
  @ApiResponse({ status: 404, description: 'Color no encontrado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION, RoleEnum.SOPORTE)
  updateColor(@Param('id') id: string, @Body() dto: NameDto) { return this.svc.updateColor(id, dto.name); }

  @Delete('colors/:id')
  @ApiOperation({ summary: 'Eliminar color', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del color' })
  @ApiResponse({ status: 200, description: 'Color eliminado' })
  @ApiResponse({ status: 404, description: 'Color no encontrado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  deleteColor(@Param('id') id: string) { return this.svc.deleteColor(id); }

  // ── MODELOS ─────────────────────────────────────────
  @Get('models')
  @ApiOperation({ summary: 'Listar modelos del catálogo', description: '**Roles:** todos.' })
  @ApiResponse({ status: 200, description: 'Lista de modelos ordenada alfabéticamente' })
  getModels() { return this.svc.getModels(); }

  @Post('models')
  @ApiOperation({ summary: 'Crear modelo', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiBody({ type: NameDto })
  @ApiResponse({ status: 201, description: 'Modelo creado. Nombre almacenado en MAYUSCULAS.' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  createModel(@Body() dto: NameDto) { return this.svc.createModel(dto.name); }

  @Patch('models/:id')
  @ApiOperation({ summary: 'Editar nombre de modelo', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del modelo' })
  @ApiBody({ type: NameDto })
  @ApiResponse({ status: 200, description: 'Modelo actualizado' })
  @ApiResponse({ status: 404, description: 'Modelo no encontrado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  updateModel(@Param('id') id: string, @Body() dto: NameDto) { return this.svc.updateModel(id, dto.name); }

  @Delete('models/:id')
  @ApiOperation({ summary: 'Eliminar modelo', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del modelo' })
  @ApiResponse({ status: 200, description: 'Modelo eliminado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  deleteModel(@Param('id') id: string) { return this.svc.deleteModel(id); }

  // ── CONCESIONARIOS ─────────────────────────────────
  @Get('concessionaires')
  @ApiOperation({ summary: 'Listar concesionarios', description: '**Roles:** todos.' })
  @ApiResponse({ status: 200, description: 'Lista de concesionarios ordenada alfabéticamente' })
  getConcessionaires() { return this.svc.getConcessionaires(); }

  @Post('concessionaires')
  @ApiOperation({ summary: 'Crear concesionario', description: '**Roles:** JEFE_TALLER, DOCUMENTACION, SOPORTE' })
  @ApiBody({ type: NameDto })
  @ApiResponse({ status: 201, description: 'Concesionario creado. Nombre almacenado en MAYUSCULAS.' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION, RoleEnum.SOPORTE)
  createConcessionaire(@Body() dto: NameDto) { return this.svc.createConcessionaire(dto.name); }

  @Patch('concessionaires/:id')
  @ApiOperation({ summary: 'Editar nombre de concesionario', description: '**Roles:** JEFE_TALLER, DOCUMENTACION, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del concesionario' })
  @ApiBody({ type: NameDto })
  @ApiResponse({ status: 200, description: 'Concesionario actualizado' })
  @ApiResponse({ status: 404, description: 'Concesionario no encontrado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION, RoleEnum.SOPORTE)
  updateConcessionaire(@Param('id') id: string, @Body() dto: NameDto) { return this.svc.updateConcessionaire(id, dto.name); }

  @Delete('concessionaires/:id')
  @ApiOperation({ summary: 'Eliminar concesionario', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del concesionario' })
  @ApiResponse({ status: 200, description: 'Concesionario eliminado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  deleteConcessionaire(@Param('id') id: string) { return this.svc.deleteConcessionaire(id); }

  // ── SEDES ───────────────────────────────────────────
  @Get('sedes')
  @ApiOperation({ summary: 'Listar sedes', description: '**Roles:** todos.' })
  @ApiResponse({ status: 200, description: 'Lista de sedes ordenada alfabéticamente' })
  getSedes() { return this.svc.getSedes(); }

  @Post('sedes')
  @ApiOperation({ summary: 'Crear sede', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiBody({ type: NameCodeDto })
  @ApiResponse({ status: 201, description: 'Sede creada. Nombre y código almacenados en MAYUSCULAS.' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  createSede(@Body() dto: NameCodeDto) { return this.svc.createSede(dto.name, dto.code); }

  @Patch('sedes/:id')
  @ApiOperation({ summary: 'Editar sede', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID de la sede' })
  @ApiBody({ type: NameCodeDto })
  @ApiResponse({ status: 200, description: 'Sede actualizada' })
  @ApiResponse({ status: 404, description: 'Sede no encontrada' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  updateSede(@Param('id') id: string, @Body() dto: NameCodeDto) { return this.svc.updateSede(id, dto.name, dto.code); }

  @Delete('sedes/:id')
  @ApiOperation({ summary: 'Eliminar sede', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID de la sede' })
  @ApiResponse({ status: 200, description: 'Sede eliminada' })
  @ApiResponse({ status: 404, description: 'Sede no encontrada' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  deleteSede(@Param('id') id: string) { return this.svc.deleteSede(id); }

  // ── ACCESORIOS ───────────────────────────────────────
  @Get('accessories')
  @ApiOperation({
    summary: 'Listar accesorios del catálogo',
    description:
      'Retorna la lista de accesorios registrados: `id`, `name` (MAYUSCULAS), `key` (MAYUSCULAS, equivalente a AccessoryKey enum). ' +
      '**Roles:** todos.',
  })
  @ApiResponse({ status: 200, description: 'Lista de accesorios ordenada alfabéticamente' })
  getAccessories() { return this.svc.getAccessories(); }

  @Post('accessories')
  @ApiOperation({
    summary: 'Crear accesorio en catálogo',
    description:
      '`key` debe coincidir con un valor del enum `AccessoryKey` (ej. `BOTON_ENCENDIDO`). ' +
      'Ambos `name` y `key` se almacenan en MAYUSCULAS. ' +
      '**Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiBody({ type: AccessoryDto })
  @ApiResponse({ status: 201, description: 'Accesorio creado con name y key en MAYUSCULAS' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  createAccessory(@Body() dto: AccessoryDto) { return this.svc.createAccessory(dto.name, dto.key); }

  @Patch('accessories/:id')
  @ApiOperation({ summary: 'Editar nombre de accesorio', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del accesorio' })
  @ApiBody({ type: NameDto })
  @ApiResponse({ status: 200, description: 'Accesorio actualizado' })
  @ApiResponse({ status: 404, description: 'Accesorio no encontrado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  updateAccessory(@Param('id') id: string, @Body() dto: NameDto) { return this.svc.updateAccessory(id, dto.name); }

  @Delete('accessories/:id')
  @ApiOperation({ summary: 'Eliminar accesorio del catálogo', description: '**Roles:** JEFE_TALLER, SOPORTE' })
  @ApiParam({ name: 'id', description: 'UUID del accesorio' })
  @ApiResponse({ status: 200, description: 'Accesorio eliminado' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  deleteAccessory(@Param('id') id: string) { return this.svc.deleteAccessory(id); }
}
