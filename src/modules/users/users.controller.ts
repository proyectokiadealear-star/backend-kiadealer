import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, RegisterFcmTokenDto } from './dto/user.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Crear usuario (solo JEFE_TALLER)' })
  @Roles(RoleEnum.JEFE_TALLER)
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.create(dto, user);
  }

  @Post('fcm-token')
  @ApiOperation({ summary: 'Registrar/actualizar FCM token del dispositivo' })
  registerFcmToken(@Body() dto: RegisterFcmTokenDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.registerFcmToken(user.uid, dto.token);
  }

  @Get()
  @ApiOperation({ summary: 'Listar usuarios' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.DOCUMENTACION ,RoleEnum.LIDER_TECNICO, RoleEnum.SUPERVISOR)
  findAll(
    @Query('role') role?: RoleEnum,
    @Query('sede') sede?: SedeEnum,
    @Query('active') active?: string,
  ) {
    return this.svc.findAll({
      role,
      sede,
      active: active !== undefined ? active === 'true' : undefined,
    });
  }

  @Get(':uid')
  @ApiOperation({ summary: 'Obtener usuario por UID' })
  @Roles(RoleEnum.JEFE_TALLER)
  findOne(@Param('uid') uid: string) {
    return this.svc.findOne(uid);
  }

  @Patch(':uid')
  @ApiOperation({ summary: 'Editar usuario (solo JEFE_TALLER)' })
  @Roles(RoleEnum.JEFE_TALLER)
  update(@Param('uid') uid: string, @Body() dto: UpdateUserDto) {
    return this.svc.update(uid, dto);
  }

  @Delete(':uid')
  @ApiOperation({ summary: 'Desactivar usuario (borrado lÃ³gico)' })
  @Roles(RoleEnum.JEFE_TALLER)
  remove(@Param('uid') uid: string) {
    return this.svc.remove(uid);
  }

  @Post(':uid/reset-password')
  @ApiOperation({ summary: 'Resetear contraseÃ±a de un usuario' })
  @Roles(RoleEnum.JEFE_TALLER)
  resetPassword(@Param('uid') uid: string) {
    return this.svc.resetPassword(uid);
  }
}

