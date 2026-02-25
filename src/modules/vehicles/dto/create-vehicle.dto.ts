import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SedeEnum } from '../../../common/enums/sede.enum';

export class CreateVehicleDto {
  @ApiProperty({ description: 'Número de chasis (único)', example: '9BFPK62M0PB001234' })
  @IsString()
  @IsNotEmpty()
  chassis: string;

  @ApiProperty({ description: 'Modelo del vehículo', example: 'Sportage' })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({ description: 'Año del vehículo (>= año actual)', example: 2026 })
  @IsNumber()
  @Min(new Date().getFullYear())
  year: number;

  @ApiProperty({ description: 'Color del vehículo', example: 'Blanco' })
  @IsString()
  @IsNotEmpty()
  color: string;

  @ApiProperty({ description: 'Concesionario de origen', example: 'LogiManta' })
  @IsString()
  @IsNotEmpty()
  originConcessionaire: string;

  @ApiProperty({ description: 'Sede donde ingresa el vehículo' })
  @IsEnum(SedeEnum)
  sede: SedeEnum;

  @ApiPropertyOptional({ description: 'Foto en base64 (si se envía como JSON)' })
  @IsOptional()
  @IsString()
  photoBase64?: string;
}
