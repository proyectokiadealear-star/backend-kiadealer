import { PartialType } from '@nestjs/swagger';
import { CreateVehicleDto } from './create-vehicle.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { VehicleStatus } from '../../../common/enums/vehicle-status.enum';
import { SedeEnum } from '../../../common/enums/sede.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';

// UpdateVehicleDto hereda todos los campos opcionales de CreateVehicleDto
// y agrega sede + status para que JEFE_TALLER / SOPORTE puedan corregir cualquier dato
export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {
  @ApiPropertyOptional({ enum: SedeEnum, description: 'Corrección manual de sede (JEFE_TALLER / SOPORTE)' })
  @IsOptional()
  @IsEnum(SedeEnum)
  sede?: SedeEnum;

  @ApiPropertyOptional({ enum: VehicleStatus, description: 'Corrección manual de estado (JEFE_TALLER / SOPORTE)' })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;
}
