import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCeremonyDto {
  @ApiProperty() @IsString() @IsNotEmpty() appointmentId: string;
  @ApiPropertyOptional({ description: 'Comentario del cliente' }) @IsOptional() @IsString() clientComment?: string;
}
