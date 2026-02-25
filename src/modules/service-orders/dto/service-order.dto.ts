import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiceOrderDto {
  @ApiProperty({ description: 'ID del vehículo', example: 'abc123' })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;
}

export class AssignTechnicianDto {
  @ApiProperty({ description: 'UID del técnico' })
  @IsString()
  @IsNotEmpty()
  technicianId: string;

  @ApiProperty({ description: 'Nombre del técnico para visualización' })
  @IsString()
  @IsNotEmpty()
  technicianName: string;
}

export class UpdateChecklistDto {
  @ApiProperty({ description: 'Clave del accesorio', example: 'aros' })
  @IsString()
  @IsNotEmpty()
  accessoryKey: string;

  @ApiProperty({ description: 'Si fue instalado' })
  installed: boolean;
}

export class ReopenOrderDto {
  @ApiProperty({ description: 'ID del vehículo' })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiProperty({ description: 'Nuevos accesorios a agregar', type: [String] })
  @IsArray()
  newAccessories: string[];

  @ApiProperty({ description: 'Motivo de la reapertura (obligatorio)' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
