import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAppointmentDto {
  @ApiProperty() @IsString() @IsNotEmpty() vehicleId: string;
  @ApiProperty({ description: 'Fecha: YYYY-MM-DD' }) @IsDateString() scheduledDate: string;
  @ApiProperty({ description: 'Hora: HH:MM', example: '10:00' }) @IsString() scheduledTime: string;
  @ApiProperty({ description: 'UID del asesor asignado' }) @IsString() assignedAdvisorId: string;
  @ApiProperty({ description: 'Nombre del asesor para visualización' }) @IsString() assignedAdvisorName: string;
}

export class UpdateAppointmentDto {
  @ApiPropertyOptional() scheduledDate?: string;
  @ApiPropertyOptional() scheduledTime?: string;
  @ApiPropertyOptional() assignedAdvisorId?: string;
  @ApiPropertyOptional() assignedAdvisorName?: string;
}
