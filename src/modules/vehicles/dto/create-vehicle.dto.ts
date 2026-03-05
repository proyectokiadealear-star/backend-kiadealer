import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para el registro contable del vehículo (estado POR_ARRIBAR).
 * Solo datos de inventario. La foto y el concesionario de origen
 * se registran en la etapa de certificación física.
 */
export class CreateVehicleDto {
  @ApiProperty({
    description:
      'Número de chasis / VIN del vehículo. Acepta VINs internacionales (ISO 3779, 17 chars) ' +
      'y chasis ecuatorianos ensamblados por MARESA (arrancan con "8L", ej: 8LGFB8149TE011987). ' +
      'Entre 6 y 20 caracteres alfanuméricos. Se almacena en MAYUSCULAS.',
    example: '8LGFB8149TE011987',
    pattern: '^[A-Z0-9]{6,20}$',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @Matches(/^[A-Z0-9]{6,20}$/, {
    message:
      'Chasis inválido. Debe tener entre 6 y 20 caracteres alfanuméricos (A-Z, 0-9). ' +
      'Ejemplos válidos: 8LGFB8149TE011987 (ecuatoriano) o 9BFPK62M0PB001234 (internacional).',
  })
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

  // sede NO se recibe del cliente — se asigna automáticamente desde el claim del usuario (user.sede)
}
