import {
  Controller, Post, Body, HttpCode, HttpStatus,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiProperty, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

  /**
   * POST /seed/inspect-file
   *
   * Diagnóstico: devuelve las columnas y las primeras 3 filas del archivo
   * SIN insertar nada en Firestore. Útil para verificar nombres de columnas.
   */
  @Post('inspect-file')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['secretKey', 'file'],
      properties: {
        secretKey: { type: 'string', example: 'kia-seed-2024' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Inspeccionar columnas del archivo (diagnóstico)',
    description: 'Lee el archivo y devuelve las columnas encontradas + 3 filas de muestra. No inserta datos.',
  })
  async inspectFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('secretKey') secretKey: string,
  ) {
    if (!file) throw new BadRequestException('Se requiere un archivo (campo "file")');
    return this.seedService.inspectFile(file.buffer, file.mimetype, secretKey);
  }

  /**
   * POST /seed/from-excel
   *
   * Importa vehículos desde Excel (.xlsx/.xls) o CSV.
   * Búsqueda de columnas fuzzy: sin tildes, case-insensitive.
   * Si no sabes los nombres exactos de columna, usa /seed/inspect-file primero.
   */
  @Post('from-excel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['secretKey', 'file'],
      properties: {
        secretKey: { type: 'string', example: 'kia-seed-2024' },
        file: { type: 'string', format: 'binary' },
        clear: { type: 'string', enum: ['true', 'false'], default: 'false', description: 'Si es "true", borra todas las colecciones antes de importar (¡destructivo!)' },
      },
    },
  })
  @ApiOperation({
    summary: 'Importar vehículos desde Excel o CSV',
    description:
      'Lee la primera hoja del archivo .xlsx/.xls o el CSV y ejecuta el seed. ' +
      'Idempotente: omite chasis ya existentes. Requiere secretKey válida. ' +
      'Pasar clear=true para borrar datos existentes antes de importar (usar con precaución). ' +
      'Usa /seed/inspect-file para verificar que las columnas sean detectadas correctamente.',
  })
  async fromExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('secretKey') secretKey: string,
    @Body('clear') clear?: string,
  ) {
    if (!file) throw new BadRequestException('Se requiere un archivo Excel o CSV (campo "file")');
    return this.seedService.seedFromExcel(file.buffer, file.mimetype, secretKey, {
      clear: clear === 'true',
    });
  }

  /**
   * POST /seed/reset-to-por-arribar
   *
   * Resetea todos los vehículos en CERTIFICADO_STOCK → POR_ARRIBAR
   * sin eliminar el vehículo. Limpia certificaciones y documentaciones asociadas.
   */
  @Post('reset-to-por-arribar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset vehículos CERTIFICADO_STOCK → POR_ARRIBAR',
    description:
      'Encuentra todos los vehículos en CERTIFICADO_STOCK, elimina sus certificaciones y documentaciones, ' +
      'resetea el estado a POR_ARRIBAR y registra el cambio en el historial. ' +
      'Los datos base del vehículo (chasis, modelo, año, color, sede, datos de cliente) se conservan.',
  })
  resetToPorArribar(@Body() dto: RunSeedDto) {
    return this.seedService.resetToPorArribar(dto.secretKey);
  }
}
