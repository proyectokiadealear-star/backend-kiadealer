import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogsService } from './catalogs.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class NameDto { @ApiProperty() @IsString() @IsNotEmpty() name: string; }
class NameCodeDto { @ApiProperty() @IsString() @IsNotEmpty() name: string; @ApiProperty() @IsString() @IsNotEmpty() code: string; }

@ApiTags('Catalogs')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly svc: CatalogsService) {}

  // COLORS
  @Get('colors') @ApiOperation({ summary: 'Listar colores' }) getColors() { return this.svc.getColors(); }
  @Post('colors') @ApiOperation({ summary: 'Crear color' }) @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION) createColor(@Body() dto: NameDto) { return this.svc.createColor(dto.name); }
  @Delete('colors/:id') @ApiOperation({ summary: 'Eliminar color' }) @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION) deleteColor(@Param('id') id: string) { return this.svc.deleteColor(id); }

  // MODELS
  @Get('models') @ApiOperation({ summary: 'Listar modelos' }) getModels() { return this.svc.getModels(); }
  @Post('models') @ApiOperation({ summary: 'Crear modelo' }) @Roles(RoleEnum.JEFE_TALLER) createModel(@Body() dto: NameDto) { return this.svc.createModel(dto.name); }
  @Delete('models/:id') @ApiOperation({ summary: 'Eliminar modelo' }) @Roles(RoleEnum.JEFE_TALLER) deleteModel(@Param('id') id: string) { return this.svc.deleteModel(id); }

  // CONCESSIONAIRES
  @Get('concessionaires') @ApiOperation({ summary: 'Listar concesionarios' }) getConcessionaires() { return this.svc.getConcessionaires(); }
  @Post('concessionaires') @ApiOperation({ summary: 'Crear concesionario' }) @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION) createConcessionaire(@Body() dto: NameDto) { return this.svc.createConcessionaire(dto.name); }
  @Patch('concessionaires/:id') @ApiOperation({ summary: 'Editar concesionario' }) @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION) updateConcessionaire(@Param('id') id: string, @Body() dto: NameDto) { return this.svc.updateConcessionaire(id, dto.name); }
  @Delete('concessionaires/:id') @ApiOperation({ summary: 'Eliminar concesionario' }) @Roles(RoleEnum.JEFE_TALLER) deleteConcessionaire(@Param('id') id: string) { return this.svc.deleteConcessionaire(id); }

  // SEDES
  @Get('sedes') @ApiOperation({ summary: 'Listar sedes' }) getSedes() { return this.svc.getSedes(); }
  @Post('sedes') @ApiOperation({ summary: 'Crear sede' }) @Roles(RoleEnum.JEFE_TALLER) createSede(@Body() dto: NameCodeDto) { return this.svc.createSede(dto.name, dto.code); }
}
