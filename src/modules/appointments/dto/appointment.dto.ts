import { IsString, IsNotEmpty, IsDateString, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAppointmentDto {
  @ApiProperty({ description: 'ID del vehículo (UUID)', example: 'abc-123' })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiProperty({ description: 'Fecha de entrega en formato YYYY-MM-DD', example: '2026-03-15' })
  @IsDateString()
  scheduledDate: string;

  @ApiProperty({ description: 'Hora de entrega en formato HH:MM', example: '10:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledTime debe tener formato HH:MM' })
  scheduledTime: string;

  @ApiProperty({
    description:
      'UID del asesor encargado de la entrega. Por lo general es el uid del usuario autenticado ' +
      '(obtenido del token). Para listar asesores disponibles: GET /users?role=ASESOR&sede={sede}&active=true',
    example: 'uid-asesor-xyz',
  })
  @IsString()
  @IsNotEmpty()
  assignedAdvisorId: string;

  @ApiProperty({ description: 'Nombre del asesor para visualización en historia', example: 'Juan Pérez' })
  @IsString()
  @IsNotEmpty()
  assignedAdvisorName: string;
}

export class UpdateAppointmentDto {
  @ApiPropertyOptional({ description: 'Nueva fecha de entrega (YYYY-MM-DD)', example: '2026-03-20' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({ description: 'Nueva hora de entrega (HH:MM)', example: '14:30' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledTime debe tener formato HH:MM' })
  scheduledTime?: string;

  @ApiPropertyOptional({ description: 'UID del nuevo asesor asignado', example: 'uid-asesor-abc' })
  @IsOptional()
  @IsString()
  assignedAdvisorId?: string;

  @ApiPropertyOptional({ description: 'Nombre del nuevo asesor para visualización', example: 'María López' })
  @IsOptional()
  @IsString()
  assignedAdvisorName?: string;
}

export class QueryAppointmentsDto {
  @ApiPropertyOptional({ description: 'Fecha inicio filtro (YYYY-MM-DD)', example: '2026-03-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Fecha fin filtro (YYYY-MM-DD)', example: '2026-03-31' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID de vehículo específico', example: 'abc-123' })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional({ default: 1, description: 'Página solo retrocompatible. page>1 requiere cursor.' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ default: 50, description: 'Tamaño de página. Máximo 200.' })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({
    description:
      'Cursor de paginación (base64). Cursor-first con startAfter y orden estable; usar nextCursor de la respuesta.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
