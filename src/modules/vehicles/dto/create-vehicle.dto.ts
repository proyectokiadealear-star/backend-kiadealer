import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({
    description:
      'Número de chasis / VIN del vehículo (estándar ISO 3779). ' +
      '17 caracteres alfanuméricos, excluye las letras I, O y Q. ' +
      'Se almacena en MAYUSCULAS. Escaneado vía QR en la app móvil.',
    example: '9BFPK62M0PB001234',
    pattern: '^[A-HJ-NPR-Z0-9]{17}$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-HJ-NPR-Z0-9]{17}$/, {
    message:
      'Chasis inválido. Debe ser un VIN ISO 3779: 17 caracteres alfanuméricos sin las letras I, O ni Q.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  chassis: string;

  @ApiProperty({
    description: 'Modelo del vehículo (selector desde catálogo). Se almacena en MAYUSCULAS.',
    example: 'SPORTAGE',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  model: string;

  @ApiProperty({
    description:
      'Año del vehículo. Debe ser >= año actual y <= año actual + 1 (modelos nuevos).',
    example: 2026,
  })
  @IsNumber()
  @Min(2000)
  @Max(new Date().getFullYear() + 1)
  year: number;

  @ApiProperty({
    description: 'Color del vehículo (selector desde catálogo). Se almacena en MAYUSCULAS.',
    example: 'BLANCO PERLA',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  color: string;

  @ApiProperty({
    description: 'Concesionario de origen del vehículo (selector desde catálogo). Se almacena en MAYUSCULAS.',
    example: 'LOGIMANTA',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  originConcessionaire: string;

  // sede NO se recibe del cliente — se asigna automáticamente desde el claim del usuario (user.sede)

  @ApiPropertyOptional({
    description:
      'Foto del vehículo en base64 (alternativa a multipart). Si se envía como multipart/form-data, usar el field «photo».',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsOptional()
  @IsString()
  photoBase64?: string;
}
