import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { SeedService } from './seed.service';

export class RunSeedDto {
  @ApiProperty({
    description: 'Clave secreta de seed (configurada en SEED_SECRET_KEY)',
    example: 'kia-seed-2024',
  })
  @IsString()
  @IsNotEmpty()
  secretKey: string;

  @ApiProperty({
    description: 'Si es true, limpia las colecciones antes de insertar datos (¡destructivo!)',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  clear?: boolean;
}

@ApiTags('Seed')
@Controller('seed')
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  /**
   * POST /seed/run
   *
   * Carga los datos iniciales en Firestore:
   *  - Catálogos: colores, modelos, concesionarios
   *  - Usuarios con roles y sedes (también en Firebase Auth)
   *  - Vehículos de demo con distintos estados
   *
   * Requiere que el campo `secretKey` coincida con la variable de entorno
   * SEED_SECRET_KEY (por defecto: kia-seed-2024).
   *
   * ⚠️  Este endpoint debe deshabilitarse o eliminarse en producción.
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ejecutar seed de base de datos',
    description:
      'Carga catálogos, usuarios y vehículos de demo en Firestore/Firebase Auth. ' +
      'Requiere secretKey válida. Idempotente: omite registros que ya existen. ' +
      'Usar `clear: true` con precaución (borra datos existentes).',
  })
  run(@Body() dto: RunSeedDto) {
    return this.seedService.runSeed(dto.secretKey, { clear: dto.clear ?? false });
  }
}
