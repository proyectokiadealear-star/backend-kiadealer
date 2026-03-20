import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EtlRow {
  sede: string | null;
  chassis: string | null;
  status: string | null;
  deliveryDate: string | null;
  createdAt: string | null;
  model: string | null;
  color: string | null;
  clientName: string | null;
  clientId: string | null;
  clientPhone: string | null;
}

export interface EtlResult {
  total: number;
  data: EtlRow[];
}

@Injectable()
export class ExcelService {
  private readonly logger = new Logger(ExcelService.name);

  constructor(private readonly config: ConfigService) {}

  async procesarExcel(buffer: Buffer, filename: string): Promise<EtlResult> {
    const baseUrl = this.config.getOrThrow<string>('PYTHON_SERVICE_URL');
    const url = `${baseUrl}/procesar-excel`;

    // Use Node 22 native FormData + Blob — no external package needed
    // Buffer.from() produces a copy with a plain ArrayBuffer (required by BlobPart)
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename,
    );

    this.logger.log(`Enviando Excel al ETL: ${url} (${filename}, ${buffer.length} bytes)`);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        body: form,
      });
    } catch (err) {
      this.logger.error(`ETL unreachable: ${String(err)}`);
      throw new InternalServerErrorException(
        'El servicio ETL no está disponible. Verifica que el microservicio Python esté corriendo.',
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`ETL responded ${res.status}: ${body}`);
      throw new InternalServerErrorException(
        `Error en el ETL (${res.status}): ${body || 'sin detalle'}`,
      );
    }

    return res.json() as Promise<EtlResult>;
  }
}
