import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReceiveRegistrationDto {
  @ApiProperty({
    description:
      'Fecha en que se recibió la matrícula del vehículo (ISO 8601). ',
    example: '2026-03-10',
  })
  @IsDateString()
  registrationReceivedDate: string;
}
