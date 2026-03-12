import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Health-check endpoint — usado por UptimeRobot para mantener
   * el servidor activo en Render (evita cold starts).
   * URL: GET https://backend-kiadealer.onrender.com/health
   * Configurar en UptimeRobot: Monitor cada 5 minutos → HTTP(s) → URL arriba.
   */
  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
