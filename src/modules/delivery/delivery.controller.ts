import { Controller, Post, Get, Param, Body, UseGuards, UploadedFiles, UseInterceptors } from '@nestjs/common';
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
import { DeliveryService } from './delivery.service';
import { CreateCeremonyDto } from './dto/delivery.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Delivery')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly svc: DeliveryService) {}

  // ── EJECUTAR CEREMONIA DE ENTREGA ────────────────────
  @Post('ceremony/:vehicleId')
  @ApiOperation({
    summary: 'Ejecutar ceremonia de entrega',
    description:
      'Prerrequisitos: vehículo en estado `AGENDADO` **y** la fecha actual debe coincidir con el `scheduledDate` del agendamiento. ' +
      'Solo el asesor asignado al agendamiento puede ejecutar la ceremonia (JEFE_TALLER y SOPORTE pueden hacerlo como override). ' +
      'Carga foto con el vehículo y foto del acta firmada a Firebase Storage, ' +
      'cambia estado a `ENTREGADO`, registra en statusHistory y notifica `ESTADO_CAMBIADO` al JEFE_TALLER. ' +
      '**Fotos opcionales** — se puede confirmar sin archivos adjuntos. ' +
      '**Roles:** ASESOR, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Datos de la ceremonia. Fotos opcionales.',
    schema: {
      type: 'object',
      required: ['appointmentId'],
      properties: {
        appointmentId: { type: 'string', example: 'apt-uuid-123' },
        clientComment: { type: 'string', example: 'Cliente muy satisfecho' },
        deliveryPhoto: { type: 'string', format: 'binary', description: 'Foto del asesor con el vehículo' },
        signedActa: { type: 'string', format: 'binary', description: 'Foto del acta firmada por el cliente' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Entrega completada. Retorna vehicleId, newStatus: ENTREGADO, deliveryDate' })
  @ApiResponse({ status: 400, description: 'Vehículo no está AGENDADO o no es el día de entrega' })
  @ApiResponse({ status: 403, description: 'No eres el asesor asignado al agendamiento' })
  @ApiResponse({ status: 404, description: 'Vehículo o agendamiento no encontrado' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'deliveryPhoto', maxCount: 1 },
      { name: 'signedActa', maxCount: 1 },
    ]),
  )
  createCeremony(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateCeremonyDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files?: { deliveryPhoto?: Express.Multer.File[]; signedActa?: Express.Multer.File[] },
  ) {
    return this.svc.createCeremony(vehicleId, dto, user, {
      deliveryPhoto: files?.deliveryPhoto?.[0],
      signedActa: files?.signedActa?.[0],
    });
  }

  // ── OBTENER CEREMONIA ─────────────────────────────
  @Get('ceremony/:vehicleId')
  @ApiOperation({
    summary: 'Obtener datos de la ceremonia de entrega',
    description:
      'Retorna los datos de la ceremonia con URLs frescas de Firebase Storage para las fotos. ' +
      '**Roles:** ASESOR, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Datos de la ceremonia con deliveryPhotoUrl y signedActaUrl' })
  @ApiResponse({ status: 404, description: 'Ceremonia de entrega no encontrada' })
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO,RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  getCeremony(@Param('vehicleId') vehicleId: string) {
    return this.svc.getCeremony(vehicleId);
  }
}

