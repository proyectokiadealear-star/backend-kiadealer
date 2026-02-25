import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { DocumentationService } from './documentation.service';
import { CreateDocumentationDto } from './dto/create-documentation.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleEnum } from '../../common/enums/role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

class ChangeSedDto {
  @ApiProperty() @IsString() @IsNotEmpty() newSede: string;
}
class TransferDto {
  @ApiProperty() @IsString() @IsNotEmpty() targetConcessionaire: string;
}

@ApiTags('Documentation')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Controller('documentation')
export class DocumentationController {
  constructor(private readonly svc: DocumentationService) {}

  @Post(':vehicleId')
  @ApiOperation({ summary: 'Registrar documentaciÃ³n del vehÃ­culo' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'vehicleInvoice', maxCount: 1 },
      { name: 'giftEmail', maxCount: 1 },
      { name: 'accessoryInvoice', maxCount: 1 },
    ]),
  )
  create(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateDocumentationDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files?: {
      vehicleInvoice?: Express.Multer.File[];
      giftEmail?: Express.Multer.File[];
      accessoryInvoice?: Express.Multer.File[];
    },
  ) {
    return this.svc.create(vehicleId, dto, user, {
      vehicleInvoice: files?.vehicleInvoice?.[0],
      giftEmail: files?.giftEmail?.[0],
      accessoryInvoice: files?.accessoryInvoice?.[0],
    });
  }

  @Get(':vehicleId')
  @ApiOperation({ summary: 'Obtener documentaciÃ³n del vehÃ­culo' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER)
  findOne(@Param('vehicleId') vehicleId: string) {
    return this.svc.findOne(vehicleId);
  }

  @Patch(':vehicleId')
  @ApiOperation({ summary: 'Editar documentaciÃ³n' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER)
  update(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: Partial<CreateDocumentationDto>,
  ) {
    return this.svc.update(vehicleId, dto);
  }

  @Patch(':vehicleId/sede')
  @ApiOperation({ summary: 'Cambio de sede del vehÃ­culo' })
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER)
  changeSede(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: ChangeSedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.changeSede(vehicleId, dto.newSede, user);
  }

  @Patch(':vehicleId/transfer')
  @ApiOperation({ summary: 'Ceder vehÃ­culo a otro concesionario' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(RoleEnum.DOCUMENTACION, RoleEnum.JEFE_TALLER)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'transferDocument', maxCount: 1 }]))
  transfer(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: TransferDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files?: { transferDocument?: Express.Multer.File[] },
  ) {
    return this.svc.transferConcessionaire(vehicleId, dto.targetConcessionaire, user, files?.transferDocument?.[0]);
  }
}

