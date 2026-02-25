import { Controller, Post, Get, Param, Body, UseGuards, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { CreateCeremonyDto } from './dto/delivery.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Delivery')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly svc: DeliveryService) {}

  @Post('ceremony/:vehicleId')
  @ApiOperation({ summary: 'Ejecutar ceremonia de entrega' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(RoleEnum.ASESOR, RoleEnum.JEFE_TALLER)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'deliveryPhoto', maxCount: 1 },
      { name: 'signedActa', maxCount: 1 },
    ]),
  )
  createCeremony(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateCeremonyDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files?: { deliveryPhoto?: Express.Multer.File[]; signedActa?: Express.Multer.File[] },
  ) {
    return this.svc.createCeremony(vehicleId, dto, user, {
      deliveryPhoto: files?.deliveryPhoto?.[0],
      signedActa: files?.signedActa?.[0],
    });
  }

  @Get('ceremony/:vehicleId')
  @ApiOperation({ summary: 'Obtener ceremonia de entrega' })
  @Roles(RoleEnum.JEFE_TALLER, RoleEnum.ASESOR)
  getCeremony(@Param('vehicleId') vehicleId: string) {
    return this.svc.getCeremony(vehicleId);
  }
}

