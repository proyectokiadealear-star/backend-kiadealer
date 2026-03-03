import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar notificaciones del usuario' })
  @ApiQuery({ name: 'read', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('read') read?: string,
    @Query('limit') limit?: string,
  ) {
    const onlyUnread = read === 'false';
    return this.svc.getNotifications(user.uid, user.role, user.sede, onlyUnread, Number(limit ?? 20));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar notificaciÃ³n como leÃ­da' })
  markAsRead(@Param('id') id: string) {
    return this.svc.markAsRead(id);
  }
}

