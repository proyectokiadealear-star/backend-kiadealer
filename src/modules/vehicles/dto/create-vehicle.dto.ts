import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({
    description: 'Número de chasis único del vehículo (escaneado vía QR en la app móvil)',
    example: '9BFPK62M0PB001234',
  })
  @IsString()
  @IsNotEmpty()
  chassis: string;

  @ApiProperty({
    description: 'Modelo del vehículo (selector desde catálogo)',
    example: 'Sportage',
  })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({
    description: 'Año del vehículo. El servidor valida dinámicamente que sea >= año actual.',
    example: 2026,
  })
  @IsNumber()
  year: number;

  @ApiProperty({
    description: 'Color del vehículo (selector desde catálogo)',
    example: 'Blanco Perla',
  })
  @IsString()
  @IsNotEmpty()
  color: string;

  @ApiProperty({
    description: 'Concesionario de origen del vehículo (selector desde catálogo)',
    example: 'LogiManta',
  })
  @IsString()
  @IsNotEmpty()
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
