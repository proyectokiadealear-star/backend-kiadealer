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
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
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

  @Post()
  @ApiOperation({ summary: 'Ingresar vehÃ­culo al taller' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER)
  @UseInterceptors(FileInterceptor('photo'))
  create(
    @Body() dto: CreateVehicleDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return this.svc.create(dto, user, photo);
  }

  @Get('stats/by-sede')
  @ApiOperation({ summary: 'KPIs por sede (solo JEFE_TALLER)' })
  @Roles(RoleEnum.JEFE_TALLER)
  statsBySede() {
    return this.svc.statsBySede();
  }

  @Get('stats/today-deliveries')
  @ApiOperation({ summary: 'Entregas agendadas para hoy' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER)
  todayDeliveries(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.todayDeliveries(user);
  }

  @Get()
  @ApiOperation({ summary: 'Listar vehÃ­culos con filtros y paginaciÃ³n' })
  findAll(
    @Query() query: QueryVehiclesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.findAll(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de vehÃ­culo (incluye certificaciÃ³n y documentaciÃ³n)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.findOne(id, user);
  }

  @Get(':id/status-history')
  @ApiOperation({ summary: 'Historial de estados del vehÃ­culo' })
  getStatusHistory(@Param('id') id: string) {
    return this.svc.getStatusHistory(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar datos del vehÃ­culo (solo JEFE_TALLER)' })
  @Roles(RoleEnum.JEFE_TALLER)
  update(@Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar vehÃ­culo (solo JEFE_TALLER)' })
  @Roles(RoleEnum.JEFE_TALLER)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}

