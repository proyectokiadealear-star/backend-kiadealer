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
  @ApiProperty({ example: 'Pedro García' })
  @IsString()
  @IsNotEmpty()
  clientName: string;

  @ApiProperty({ description: 'Cédula del cliente', example: '1234567890' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ example: '0991234567' })
  @IsString()
  @IsNotEmpty()
  clientPhone: string;

  @ApiProperty({ enum: RegistrationType })
  @IsEnum(RegistrationType)
  registrationType: RegistrationType;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CONTADO })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({ type: [AccessoryItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessoryItemDto)
  accessories: AccessoryItemDto[];

  @ApiPropertyOptional({
    description: 'Si true, guarda como DOCUMENTACION_PENDIENTE (sin finalizar)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  saveAsPending?: boolean;
}
