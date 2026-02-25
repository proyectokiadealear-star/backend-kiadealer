import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum RimsStatus {
  VIENE = 'VIENE',
  RAYADOS = 'RAYADOS',
  NO_VINIERON = 'NO_VINIERON',
}
export enum SeatType {
  CUERO = 'CUERO',
  TELA = 'TELA',
  TELA_Y_CUERO = 'TELA_Y_CUERO',
}
export enum AntennaType {
  TIBURON = 'TIBURON',
  CONVENCIONAL = 'CONVENCIONAL',
}
export enum InstalledStatus {
  INSTALADO = 'INSTALADO',
  NO_INSTALADO = 'NO_INSTALADO',
}
export enum ImprintsStatus {
  CON_IMPRONTAS = 'CON_IMPRONTAS',
  SIN_IMPRONTAS = 'SIN_IMPRONTAS',
}

export class CreateCertificationDto {
  @ApiProperty({ enum: InstalledStatus })
  @IsEnum(InstalledStatus)
  radio: InstalledStatus;

  @ApiProperty({ enum: RimsStatus })
  @IsEnum(RimsStatus)
  rimsStatus: RimsStatus;

  @ApiProperty({ enum: SeatType })
  @IsEnum(SeatType)
  seatType: SeatType;

  @ApiProperty({ enum: AntennaType })
  @IsEnum(AntennaType)
  antenna: AntennaType;

  @ApiProperty({ enum: InstalledStatus })
  @IsEnum(InstalledStatus)
  trunkCover: InstalledStatus;

  @ApiProperty({ description: 'Kilometraje (> 10 genera alerta)', example: 5 })
  @IsNumber()
  @Min(0)
  mileage: number;

  @ApiProperty({ enum: ImprintsStatus })
  @IsEnum(ImprintsStatus)
  imprints: ImprintsStatus;

  @ApiPropertyOptional({ description: 'Nota adicional del certificador' })
  @IsOptional()
  @IsString()
  notes?: string;
}
