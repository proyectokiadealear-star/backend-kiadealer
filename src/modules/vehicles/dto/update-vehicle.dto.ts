import { PartialType } from '@nestjs/swagger';
import { CreateVehicleDto } from './create-vehicle.dto';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { VehicleStatus } from '../../../common/enums/vehicle-status.enum';
import { SedeEnum } from '../../../common/enums/sede.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * UpdateVehicleDto hereda chassis/model/year/color opcionales de CreateVehicleDto
 * y agrega campos que ya no están en el create (originConcessionaire, photoBase64)
 * para que JEFE_TALLER / SOPORTE puedan corregir cualquier dato.
 */
export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {
  @ApiPropertyOptional({
    description: 'Concesionario de origen (corrección manual). Se almacena en MAYUSCULAS.',
    example: 'LOGIMANTA',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  originConcessionaire?: string;

  @ApiPropertyOptional({
    description: 'Foto del vehículo en base64 (alternativa a multipart field «photo»).',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsOptional()
  @IsString()
  photoBase64?: string;

  @ApiPropertyOptional({ enum: SedeEnum, description: 'Corrección manual de sede (JEFE_TALLER / SOPORTE)' })
  @IsOptional()
  @IsEnum(SedeEnum)
  sede?: SedeEnum;

  @ApiPropertyOptional({ enum: VehicleStatus, description: 'Corrección manual de estado (JEFE_TALLER / SOPORTE)' })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;
}
