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
import { AccessoryClassification } from '../../../common/enums/accessory-key.enum';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';
import { IsEcuadorianCedula } from '../../../common/validators/ecuador-cedula.validator';

export enum RegistrationType {
  NORMAL = 'NORMAL',
  RAPIDA = 'RAPIDA',
  EXCLUSIVA = 'EXCLUSIVA',
}

export class AccessoryItemDto {
  @ApiProperty({
    description: 'Key del accesorio, tal como viene del catálogo GET /catalogs/accessories/items (campo id/key). Se normaliza a minúsculas.',
    example: 'boton_encendido',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiPropertyOptional({
    enum: AccessoryClassification,
    description: 'Si no se envía o está vacío, se asume NO_APLICA',
    default: AccessoryClassification.NO_APLICA,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value || !Object.values(AccessoryClassification).includes(value)) {
      return AccessoryClassification.NO_APLICA;
    }
    return value;
  })
  @IsEnum(AccessoryClassification)
  classification: AccessoryClassification = AccessoryClassification.NO_APLICA;

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
      'Cédula de identidad ecuatoriana (10 dígitos) o RUC de persona natural (13 dígitos = cédula válida + 001). ' +
      'Código de provincia válido (01–24), tercer dígito < 6 y dígito verificador correcto.',
    example: '1723456789',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}(\d{3})?$/, { message: 'La cédula debe tener 10 dígitos o el RUC 13 dígitos numéricos.' })
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
    // Manejo explícito para evitar que enableImplicitConversion convierta "false" → true
    if (value === true  || value === 'true')  return true;
    if (value === false || value === 'false') return false;
    return false; // default: NO pendiente
  })
  @Type(() => String) // evita que class-transformer haga Boolean("false") = true antes del @Transform
  saveAsPending?: boolean;
}
