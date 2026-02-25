import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AccessoryKey, AccessoryClassification } from '../../../common/enums/accessory-key.enum';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';

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
  @ApiProperty({ description: 'Nombre completo del cliente', example: 'Pedro García López' })
  @IsString()
  @IsNotEmpty()
  clientName: string;

  @ApiProperty({ description: 'Cédula de identidad del cliente', example: '1234567890' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'Teléfono de contacto del cliente', example: '0991234567' })
  @IsString()
  @IsNotEmpty()
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
      'Clasificación de los 14 accesorios (VENDIDO / OBSEQUIADO / NO_APLICA). El campo "otros" admite notes de texto libre.',
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
  saveAsPending?: boolean;
}
