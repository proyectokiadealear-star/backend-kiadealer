import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HomeService } from './home.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Home')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('home')
export class HomeController {
  constructor(private readonly homeSvc: HomeService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Resumen del dashboard home (mobile)',
    description:
      'Consolida en un único request los conteos de vehículos por estado, ' +
      'entregas del día, notificaciones no leídas, órdenes activas y ' +
      'vehículos en instalación del técnico. ' +
      'Evita los 9 requests paralelos que hacía el cliente móvil. ' +
      '**Roles:** todos',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ counts, recentVehicles, deliveries, notifCount, activeOrders, myWork }',
  })
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.homeSvc.getSummary(user);
  }
}
