import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsBoolean,
  Matches,
} from 'class-validator';
import { Transform, Type, plainToInstance } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessoryKey, AccessoryClassification } from '../../../common/enums/accessory-key.enum';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';
import { IsEcuadorianCedula } from '../../../common/validators/ecuador-cedula.validator';

export enum RegistrationType {
  NORMAL = 'NORMAL',
  RAPIDA = 'RAPIDA',
  EXCLUSIVA = 'EXCLUSIVA',
}

export class AccessoryItemDto {
  @ApiProperty({ enum: AccessoryKey })
  @IsEnum(AccessoryKey)
  key: AccessoryKey;

  @ApiProperty({ enum: AccessoryClassification })
  @IsEnum(AccessoryClassification)
  classification: AccessoryClassification;

  @ApiPropertyOptional({ description: 'Solo para el campo "otros"' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDocumentationDto {
  @ApiProperty({
    description: 'Nombre completo del cliente. Se almacena en MAYUSCULAS.',
    example: 'PEDRO GARCÍA LÓPEZ',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  clientName: string;

  @ApiProperty({
    description:
      'Cédula de identidad ecuatoriana del cliente. 10 dígitos, persona natural (dígito 3 < 6), ' +
      'código de provincia válido (01–24) y dígito verificador correcto.',
    example: '1723456789',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: 'La cédula debe tener exactamente 10 dígitos numéricos.' })
  @IsEcuadorianCedula()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  clientId: string;

  @ApiProperty({
    description:
      'Teléfono móvil ecuatoriano del cliente. Formato: 09XXXXXXXX (10 dígitos, inicia con 09).',
    example: '0991234567',
    pattern: '^09\\d{8}$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^09\d{8}$/, {
    message: 'Teléfono inválido. Debe ser un móvil ecuatoriano: 09XXXXXXXX (10 dígitos).',
  })
  clientPhone: string;

  @ApiProperty({
    enum: RegistrationType,
    description: 'Tipo de matrícula del vehículo',
    example: RegistrationType.NORMAL,
  })
  @IsEnum(RegistrationType)
  registrationType: RegistrationType;

  @ApiProperty({
    enum: PaymentMethod,
    description: 'Método de pago del vehículo',
    example: PaymentMethod.CONTADO,
  })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({
    type: [AccessoryItemDto],
    description:
      'Clasificación de los 14 accesorios (VENDIDO / OBSEQUIADO / NO_APLICA). El campo "otros" admite notes de texto libre. ' +
      'En multipart/form-data enviar como JSON serializado: `JSON.stringify([...])`.',
  })
  @Transform(({ value }) => {
    const parsed =
      typeof value === 'string'
        ? (() => { try { return JSON.parse(value); } catch { return value; } })()
        : value;
    return Array.isArray(parsed)
      ? parsed.map((item: unknown) => plainToInstance(AccessoryItemDto, item))
      : parsed;
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessoryItemDto)
  accessories: AccessoryItemDto[];

  @ApiPropertyOptional({
    description:
      'Si true → estado DOCUMENTACION_PENDIENTE (modo standby, bloquea generación de OT). Si false o ausente → DOCUMENTADO.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  saveAsPending?: boolean;
}
