import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCeremonyDto {
  @ApiProperty({
    description: 'ID del agendamiento (UUID) asociado al vehículo. ' +
      'La ceremonia solo puede ejecutarse el día agendado (`scheduledDate`).',
    example: 'apt-uuid-123',
  })
  @IsString()
  @IsNotEmpty()
  appointmentId: string;

  @ApiPropertyOptional({
    description: 'Comentario libre del cliente durante la ceremonia de entrega',
    example: 'El cliente quedó muy satisfecho con la instalación de accesorios',
  })
  @IsOptional()
  @IsString()
  clientComment?: string;
}
