import { IsOptional, IsString, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SedeEnum } from '../../../common/enums/sede.enum';
import { VehicleStatus } from '../../../common/enums/vehicle-status.enum';

export class QueryVehiclesDto {
  @ApiPropertyOptional({ enum: SedeEnum })
  @IsOptional()
  @IsEnum(SedeEnum)
  sede?: SedeEnum;

  @ApiPropertyOptional({
    description:
      'Filtrar por estado(s), separados por coma. ' +
      'Por defecto se excluyen CEDIDO y ENTREGADO (estados terminales). ' +
      'Pasar explícitamente ?status=CEDIDO o ?status=ENTREGADO para consultar el historial.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Buscar por chasis (parcial)' })
  @IsOptional()
  @IsString()
  chassis?: string;

  @ApiPropertyOptional({ description: 'Buscar por cédula del cliente' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
