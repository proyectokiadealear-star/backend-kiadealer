import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
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
import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { DocumentationService } from './documentation.service';
import { CreateDocumentationDto } from './dto/create-documentation.dto';
import { SendToRegistrationDto } from './dto/send-to-registration.dto';
import { ReceiveRegistrationDto } from './dto/receive-registration.dto';
import { RevertToPorArribarDto } from './dto/revert-to-por-arribar.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ChangeSedDto {
  @ApiProperty({
    enum: SedeEnum,
    description: 'Nueva sede destino del vehículo',
  })
  @IsEnum(SedeEnum)
  newSede: SedeEnum;
}

class TransferDto {
  @ApiProperty({
    description: 'Nombre del concesionario destino',
    example: 'LogiManta',
  })
  @IsString()
  @IsNotEmpty()
  targetConcessionaire: string;
}

/** Esquema Swagger para POST multipart/form-data con archivos */
class CreateDocumentationMultipartDto {
  @ApiProperty({ example: 'PEDRO GARCIA LOPEZ' }) clientName: string;
  @ApiProperty({ example: '1723456789' }) clientId: string;
  @ApiProperty({ example: '0991234567' }) clientPhone: string;
  @ApiProperty({ enum: ['NORMAL', 'RAPIDA', 'EXCLUSIVA'] })
  registrationType: string;
  @ApiProperty({ enum: ['CONTADO', 'CREDITO'] }) paymentMethod: string;
  @ApiProperty({
    description:
      'JSON serializado. Ejemplo: [{"key":"aros","classification":"VENDIDO"},{"key":"otros","classification":"NO_APLICA"}]',
    example:
      '[{"key":"aros","classification":"VENDIDO"},{"key":"moquetas","classification":"OBSEQUIADO"}]',
  })
  accessories: string;
  @ApiPropertyOptional({ default: false }) saveAsPending?: boolean;
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'PDF — Factura del vehículo (1 archivo)',
  })
  vehicleInvoice?: Express.Multer.File;
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    description: 'PDFs — Correos de obsequio (hasta 5 archivos)',
  })
  giftEmail?: Express.Multer.File[];
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    description: 'PDFs — Facturas de accesorios (hasta 5 archivos)',
  })
  accessoryInvoice?: Express.Multer.File[];
}

/** Esquema Swagger para PATCH multipart/form-data con archivos */
class UpdateDocumentationMultipartDto {
  @ApiPropertyOptional({ example: 'PEDRO GARCIA LOPEZ' }) clientName?: string;
  @ApiPropertyOptional({ example: '1723456789' }) clientId?: string;
  @ApiPropertyOptional({ example: '0991234567' }) clientPhone?: string;
  @ApiPropertyOptional({ enum: ['NORMAL', 'RAPIDA', 'EXCLUSIVA'] })
  registrationType?: string;
  @ApiPropertyOptional({ enum: ['CONTADO', 'CREDITO'] }) paymentMethod?: string;
  @ApiPropertyOptional({
    description: 'JSON serializado (reemplaza array completo)',
    example: '[{"key":"aros","classification":"VENDIDO"}]',
  })
  accessories?: string;
  @ApiPropertyOptional({
    description:
      'false → completa la documentación pendiente y avanza a DOCUMENTADO',
  })
  saveAsPending?: boolean;
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'PDF — reemplaza factura del vehículo existente',
  })
  vehicleInvoice?: Express.Multer.File;
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    description: 'PDFs — reemplaza correos de obsequio existentes (hasta 5)',
  })
  giftEmail?: Express.Multer.File[];
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    description: 'PDFs — reemplaza facturas de accesorios existentes (hasta 5)',
  })
  accessoryInvoice?: Express.Multer.File[];
}

@ApiTags('Documentation')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('documentation')
export class DocumentationController {
  constructor(private readonly svc: DocumentationService) {}

  // ── CREATE ──────────────────────────────────────────────────────
  @Post(':vehicleId')
  @ApiOperation({
    summary: 'Registrar documentación del vehículo',
    description:
      'Asocia cliente, PDFs y clasificación de accesorios al vehículo. Con `saveAsPending=true` queda en DOCUMENTACION_PENDIENTE (bloquea OT). PDFs se suben a Firebase Storage. **Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateDocumentationMultipartDto })
  @ApiResponse({
    status: 201,
    description:
      'Documentación registrada. Estado: DOCUMENTADO o DOCUMENTACION_PENDIENTE',
  })
  @ApiResponse({
    status: 400,
    description:
      'Vehículo no está en ENVIADO_A_MATRICULAR o DOCUMENTACION_PENDIENTE',
  })
  @ApiResponse({ status: 401, description: 'Token inválido o ausente' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'vehicleInvoice', maxCount: 1 },
      { name: 'giftEmail', maxCount: 5 },
      { name: 'accessoryInvoice', maxCount: 5 },
    ]),
  )
  create(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateDocumentationDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files?: {
      vehicleInvoice?: Express.Multer.File[];
      giftEmail?: Express.Multer.File[];
      accessoryInvoice?: Express.Multer.File[];
    },
  ) {
    return this.svc.create(vehicleId, dto, user, {
      vehicleInvoice: files?.vehicleInvoice?.[0],
      giftEmails: files?.giftEmail ?? [],
      accessoryInvoices: files?.accessoryInvoice ?? [],
    });
  }

  // ── SEND TO REGISTRATION ───────────────────────────────────────
  @Patch(':vehicleId/send-to-registration')
  @ApiOperation({
    summary: 'Enviar vehículo a matriculación',
    description:
      'Transición POR_ARRIBAR → ENVIADO_A_MATRICULAR. Guarda la fecha de envío. **Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Vehículo enviado a matricular (ENVIADO_A_MATRICULAR)',
  })
  @ApiResponse({ status: 400, description: 'Vehículo no está en POR_ARRIBAR' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  sendToRegistration(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: SendToRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.sendToRegistration(
      vehicleId,
      dto.registrationSentDate,
      user,
    );
  }

  // ── RECEIVE REGISTRATION ─────────────────────────────────────────
  @Patch(':vehicleId/receive-registration')
  @ApiOperation({
    summary: 'Registrar recepción de matrícula',
    description:
      'Guarda la fecha en que se recibió la matrícula del vehículo. No cambia el estado. **Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: 'Fecha de recepción registrada' })
  @ApiResponse({
    status: 400,
    description: 'Vehículo no está en ENVIADO_A_MATRICULAR',
  })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  receiveRegistration(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: ReceiveRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.receiveRegistration(
      vehicleId,
      dto.registrationReceivedDate,
      user,
    );
  }

  // ── READ ────────────────────────────────────────────────────────
  @Get(':vehicleId')
  @ApiOperation({
    summary: 'Obtener documentación del vehículo',
    description:
      'Retorna los datos del cliente, clasificación de accesorios y URLs firmadas frescas de los PDFs. **Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Datos de documentación con URLs firmadas',
  })
  @ApiResponse({ status: 404, description: 'Documentación no encontrada' })
  @Roles(
    RoleEnum.DOCUMENTACION,
    RoleEnum.JEFE_TALLER,
    RoleEnum.SOPORTE,
    RoleEnum.BODEGUERO,
  )
  findOne(@Param('vehicleId') vehicleId: string) {
    return this.svc.findOne(vehicleId);
  }

  // ── UPDATE ──────────────────────────────────────────────────────
  @Patch(':vehicleId')
  @ApiOperation({
    summary: 'Editar documentación',
    description:
      'Permite actualizar datos del cliente, accesorios y reemplazar PDFs. Si se envían nuevos archivos, los anteriores son eliminados de Storage. **Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdateDocumentationMultipartDto })
  @ApiResponse({ status: 200, description: 'Documentación actualizada' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Documentación no encontrada' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'vehicleInvoice', maxCount: 1 },
      { name: 'giftEmail', maxCount: 5 },
      { name: 'accessoryInvoice', maxCount: 5 },
    ]),
  )
  update(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: Partial<CreateDocumentationDto>,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files?: {
      vehicleInvoice?: Express.Multer.File[];
      giftEmail?: Express.Multer.File[];
      accessoryInvoice?: Express.Multer.File[];
    },
  ) {
    return this.svc.update(vehicleId, dto, user, {
      vehicleInvoice: files?.vehicleInvoice?.[0],
      giftEmails: files?.giftEmail ?? [],
      accessoryInvoices: files?.accessoryInvoice ?? [],
    });
  }

  // ── DELETE (completo) ───────────────────────────────────────────
  @Delete(':vehicleId')
  @ApiOperation({
    summary: 'Eliminar documentación completa',
    description:
      'Elimina el documento de Firestore y sólo los PDFs que tienen URL almacenada (evita conflictos en Storage). Registra en statusHistory y notifica a JEFE_TALLER. No revierte el estado del vehículo. **Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiResponse({
    status: 200,
    description:
      'Documentación eliminada, PDFs borrados y JEFE_TALLER notificado',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Documentación no encontrada' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  remove(
    @Param('vehicleId') vehicleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.remove(vehicleId, user);
  }

  // ── DELETE (archivo específico) ─────────────────────────────────
  @Delete(':vehicleId/files/:fileType')
  @ApiOperation({
    summary: 'Eliminar un PDF específico',
    description:
      'Elimina sólo el archivo indicado de Firebase Storage y limpia su URL en Firestore. Registra en statusHistory y notifica a JEFE_TALLER. ' +
      '**fileType**: `vehicleInvoice` | `giftEmail` | `accessoryInvoice`. ' +
      'Para giftEmail/accessoryInvoice usar query param `index` (0-based) para eliminar un archivo específico del array. Sin index elimina todos. ' +
      '**Roles:** JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiParam({
    name: 'fileType',
    description: 'Tipo de archivo a eliminar',
    enum: ['vehicleInvoice', 'giftEmail', 'accessoryInvoice'],
  })
  @ApiResponse({
    status: 200,
    description: 'Archivo eliminado de Storage y URL limpiada en Firestore',
  })
  @ApiResponse({ status: 400, description: 'fileType inválido' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Documentación no encontrada' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  removeFile(
    @Param('vehicleId') vehicleId: string,
    @Param('fileType')
    fileType: 'vehicleInvoice' | 'giftEmail' | 'accessoryInvoice',
    @CurrentUser() user: AuthenticatedUser,
    @Query('index') index?: string,
  ) {
    return this.svc.removeFile(
      vehicleId,
      fileType,
      user,
      index !== undefined ? Number(index) : undefined,
    );
  }

  // ── REVERTIR A POR_ARRIBAR (cancelación de compra) ─────────────────
  @Patch(':vehicleId/revert-to-por-arribar')
  @ApiOperation({
    summary: 'Revertir vehículo a POR_ARRIBAR (cancelación de compra)',
    description:
      'Cancela la compra del vehículo: elimina la documentación de Firestore, borra todos los PDFs de Storage, ' +
      'limpia los campos de cliente (clientId, documentationDate, documentedBy, registrationSentDate, registrationReceivedDate) ' +
      'y cambia el estado a POR_ARRIBAR. ' +
      'Bloqueado si el vehículo está en estado ENTREGADO o CEDIDO (estados finales irreversibles). ' +
      '**Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiBody({ type: RevertToPorArribarDto })
  @ApiResponse({
    status: 200,
    description:
      'Vehículo revertido a POR_ARRIBAR. Documentación y PDFs eliminados.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Vehículo en estado final (ENTREGADO o CEDIDO) — no reversible. O motivo (reason) vacío.',
  })
  @ApiResponse({ status: 401, description: 'Token inválido o ausente' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  revertToPorArribar(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: RevertToPorArribarDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.revertToPorArribar(vehicleId, dto, user);
  }

  // ── CAMBIO DE SEDE ─────────────────────────────────────────────
  @Patch(':vehicleId/sede')
  @ApiOperation({
    summary: 'Cambio de sede del vehículo',
    description:
      'Reasigna el vehículo a otra sede. No cambia el estado. Registra entrada en statusHistory y notifica a JEFE_TALLER. **Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiBody({ type: ChangeSedDto })
  @ApiResponse({
    status: 200,
    description: 'Sede actualizada y notificación enviada al JEFE_TALLER',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  changeSede(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: ChangeSedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.changeSede(vehicleId, dto.newSede, user);
  }

  // ── CESIÓN ────────────────────────────────────────────────────────
  @Patch(':vehicleId/transfer')
  @ApiOperation({
    summary: 'Ceder vehículo a otro concesionario',
    description:
      'Cambia el estado a CEDIDO (estado final). Sube el documento de cesión a Firebase Storage y notifica al JEFE_TALLER. **Roles:** DOCUMENTACION, JEFE_TALLER, SOPORTE',
  })
  @ApiParam({ name: 'vehicleId', description: 'ID del vehículo (UUID)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: TransferDto })
  @ApiResponse({
    status: 200,
    description: 'Vehículo cedido y estado actualizado a CEDIDO',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Vehículo no encontrado' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER, RoleEnum.SOPORTE)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'transferDocument', maxCount: 1 }]),
  )
  transfer(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: TransferDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files?: { transferDocument?: Express.Multer.File[] },
  ) {
    return this.svc.transferConcessionaire(
      vehicleId,
      dto.targetConcessionaire,
      user,
      files?.transferDocument?.[0],
    );
  }
}
