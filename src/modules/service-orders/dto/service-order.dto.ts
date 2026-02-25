import { IsString, IsNotEmpty, IsArray, IsOptional, IsBoolean, IsEnum, ArrayMinSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessoryKey } from '../../../common/enums/accessory-key.enum';

export class CreateServiceOrderDto {
  @ApiProperty({ description: 'ID del vehículo (UUID)', example: 'abc-123' })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiPropertyOptional({
    description:
      'Número de orden ingresado por el ASESOR o LIDER_TECNICO. ' +
      'Si se omite, el sistema genera uno automáticamente con formato ORD-{sede}-{fecha}-{sufijo}.',
    example: 'OT-2026-001',
  })
  @IsOptional()
  @IsString()
  orderNumber?: string;
}

export class AssignTechnicianDto {
  @ApiProperty({ description: 'UID del técnico asignado (obtenido de GET /users?role=PERSONAL_TALLER)', example: 'uid-tecnico-xyz' })
  @IsString()
  @IsNotEmpty()
  technicianId: string;

  @ApiProperty({ description: 'Nombre del técnico para visualización', example: 'Carlos Ramírez' })
  @IsString()
  @IsNotEmpty()
  technicianName: string;
}

export class UpdateChecklistDto {
  @ApiProperty({
    description: 'Clave del accesorio a marcar',
    enum: AccessoryKey,
    example: AccessoryKey.aros,
  })
  @IsString()
  @IsNotEmpty()
  accessoryKey: string;

  @ApiProperty({ description: 'true = instalado, false = pendiente' })
  @IsBoolean()
  installed: boolean;
}

export class ReopenOrderDto {
  @ApiProperty({ description: 'ID del vehículo', example: 'abc-123' })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiProperty({
    description: 'Uno o más accesorios a agregar (valores del enum AccessoryKey, mismo listado de documentación)',
    type: [String],
    enum: AccessoryKey,
    isArray: true,
    example: [AccessoryKey.alarma, AccessoryKey.neblineros],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AccessoryKey, { each: true })
  newAccessories: string[];

  @ApiProperty({ description: 'Motivo de la reapertura (obligatorio, queda en statusHistory)', example: 'Cliente solicitó agregar neblineros' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
