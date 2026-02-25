import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CertificationsService } from './certifications.service';
import { CreateCertificationDto } from './dto/create-certification.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Certifications')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('certifications')
export class CertificationsController {
  constructor(private readonly svc: CertificationsService) {}

  @Post(':vehicleId')
  @ApiOperation({ summary: 'Registrar certificaciÃ³n interna/externa del vehÃ­culo' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(RoleEnum.ASESOR, RoleEnum.LIDER_TECNICO, RoleEnum.PERSONAL_TALLER, RoleEnum.JEFE_TALLER)
  @UseInterceptors(FileInterceptor('rimsPhoto'))
  create(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateCertificationDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() rimsPhoto?: Express.Multer.File,
  ) {
    return this.svc.create(vehicleId, dto, user, rimsPhoto);
  }

  @Get(':vehicleId')
  @ApiOperation({ summary: 'Obtener certificaciÃ³n de un vehÃ­culo' })
  findOne(@Param('vehicleId') vehicleId: string) {
    return this.svc.findOne(vehicleId);
  }

  @Patch(':vehicleId')
  @ApiOperation({ summary: 'Editar certificaciÃ³n (solo JEFE_TALLER)' })
  @Roles(RoleEnum.JEFE_TALLER)
  update(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: Partial<CreateCertificationDto>,
  ) {
    return this.svc.update(vehicleId, dto);
  }
}

