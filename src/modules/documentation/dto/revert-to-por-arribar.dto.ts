import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RevertToPorArribarDto {
  @ApiProperty({
    description: 'Motivo de la reversión / cancelación de compra',
    example: 'Cliente canceló la compra por cambio de modelo',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
