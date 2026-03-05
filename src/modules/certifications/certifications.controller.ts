import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CertificationsService } from './certifications.service';
import { CreateCertificationDto } from './dto/create-certification.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Certifications')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('certifications')
export class CertificationsController {
  constructor(private readonly svc: CertificationsService) {}

  // ── CREATE ──────────────────────────────────────────────────────
  @Post(':vehicleId')
  @ApiOperation({
    summary: 'Registrar certificación interna/externa del vehículo',
    description:
      'El vehículo debe estar en estado DOCUMENTADO. Sube la foto del vehículo y la foto de aros a Firebase Storage y cambia el estado a CERTIFICADO_STOCK. Guarda originConcessionaire y receptionDate en el vehículo. Dispara notificaciones condicionales por kilometraje alto y falta de improntas. **Roles:** ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo a certificar (UUID)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateCertificationDto })
  @ApiResponse({ status: 201, description: 'Certificación registrada y vehículo en CERTIFICADO_STOCK' })
  @ApiResponse({ status: 400, description: 'Vehículo no está en DOCUMENTADO o ya tiene certificación' })
  @ApiResponse({ status: 401, description: 'Token inválido o ausente' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'vehiclePhoto', maxCount: 1 },
      { name: 'rimsPhoto', maxCount: 1 },
    ]),
  )
  create(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateCertificationDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files?: {
      vehiclePhoto?: Express.Multer.File[];
      rimsPhoto?: Express.Multer.File[];
    },
  ) {
    return this.svc.create(vehicleId, dto, user, {
      vehiclePhoto: files?.vehiclePhoto?.[0],
      rimsPhoto: files?.rimsPhoto?.[0],
    });
  }

  // ── READ ────────────────────────────────────────────────────────
  @Get(':vehicleId')
  @ApiOperation({
    summary: 'Obtener certificación de un vehículo',
    description: 'Retorna los datos de certificación con URL firmada fresca para la foto de aros. **Roles:** todos',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Datos de certificación' })
  @ApiResponse({ status: 404, description: 'Certificación no encontrada' })
  findOne(@Param('vehicleId') vehicleId: string) {
    return this.svc.findOne(vehicleId);
  }

  // ── UPDATE ──────────────────────────────────────────────────────
  @Patch(':vehicleId')
  @ApiOperation({
    summary: 'Editar certificación',
    description:
      'Permite corregir cualquier campo de la certificación, incluyendo la foto del vehículo y la foto de aros. Si se envía una nueva foto, la anterior es eliminada de Storage. No re-dispara notificaciones. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateCertificationDto })
  @ApiResponse({ status: 200, description: 'Certificación actualizada' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Certificación no encontrada' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'vehiclePhoto', maxCount: 1 },
      { name: 'rimsPhoto', maxCount: 1 },
    ]),
  )
  update(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: Partial<CreateCertificationDto>,
    @UploadedFiles()
    files?: {
      vehiclePhoto?: Express.Multer.File[];
      rimsPhoto?: Express.Multer.File[];
    },
  ) {
    return this.svc.update(vehicleId, dto, {
      vehiclePhoto: files?.vehiclePhoto?.[0],
      rimsPhoto: files?.rimsPhoto?.[0],
    });
  }

  // ── DELETE ──────────────────────────────────────────────────────
  @Delete(':vehicleId')
  @ApiOperation({
    summary: 'Eliminar certificación',
    description: 'Elimina la certificación y revierte el vehículo a DOCUMENTADO con nota en el historial de estados. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Certificación eliminada y vehículo revertido a DOCUMENTADO' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Certificación no encontrada' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  remove(
    @Param('vehicleId') vehicleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.remove(vehicleId, user);
  }
}

