import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendToRegistrationDto {
  @ApiProperty({
    description:
      'Fecha en que se envió el vehículo a matricular (ISO 8601). ' +
      'Marca la transición POR_ARRIBAR → ENVIADO_A_MATRICULAR.',
    example: '2026-03-05',
  })
  @IsDateString()
  registrationSentDate: string;
}
