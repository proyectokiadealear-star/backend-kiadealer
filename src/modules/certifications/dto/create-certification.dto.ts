import { IsEnum, IsNumber, IsOptional, IsString, Min, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export enum RimsStatus {
  BUENOS = 'BUENOS',
  CON_DEFECTOS = 'CON_DEFECTOS',
  AUSENTES = 'AUSENTES',
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
  @ApiProperty({
    enum: InstalledStatus,
    description: 'Estado del radio del vehículo',
    example: InstalledStatus.INSTALADO,
  })
  @IsEnum(InstalledStatus)
  radio: InstalledStatus;

  @ApiProperty({
    enum: RimsStatus,
    description: 'Estado de los aros. Si se envía como multipart/form-data, adjuntar foto en el field «rims Photo».',
    example: RimsStatus.BUENOS,
  })
  @IsEnum(RimsStatus)
  rimsStatus: RimsStatus;

  @ApiProperty({
    enum: SeatType,
    description: 'Tipo de tapizado de los asientos',
    example: SeatType.CUERO,
  })
  @IsEnum(SeatType)
  seatType: SeatType;

  @ApiProperty({
    enum: AntennaType,
    description: 'Tipo de antena del vehículo',
    example: AntennaType.TIBURON,
  })
  @IsEnum(AntennaType)
  antenna: AntennaType;

  @ApiProperty({
    enum: InstalledStatus,
    description: 'Estado del cubre maletas',
    example: InstalledStatus.INSTALADO,
  })
  @IsEnum(InstalledStatus)
  trunkCover: InstalledStatus;

  @ApiProperty({
    description: 'Kilometraje del vehículo al ingresar. Se genera notificación KILOMETRAJE_ALTO si supera 10 km.',
    example: 5,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  mileage: number;

  @ApiProperty({
    enum: ImprintsStatus,
    description: 'Estado de las improntas. SIN_IMPRONTAS dispara notificación a JEFE_TALLER, LIDER_TECNICO y DOCUMENTACION.',
    example: ImprintsStatus.CON_IMPRONTAS,
  })
  @IsEnum(ImprintsStatus)
  imprints: ImprintsStatus;

  @ApiPropertyOptional({
    description: 'Observación adicional del certificador (texto libre)',
    example: 'Rayadura leve en puerta delantera derecha',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description: 'Concesionario de origen del vehículo (se guarda en mayúsculas en el vehículo)',
    example: 'QUITO MOTORS',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.toUpperCase() : value)
  originConcessionaire: string;

  @ApiPropertyOptional({
    description:
      'Foto del vehículo en Base64. Se sube a Storage como la foto principal del vehículo en vehicles/{id}/photo.jpg',
  })
  @IsOptional()
  @IsString()
  vehiclePhotoBase64?: string;
}
