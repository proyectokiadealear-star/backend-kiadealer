import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCertificationDto, ImprintsStatus } from './dto/create-certification.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Injectable()
export class CertificationsService {
  private readonly logger = new Logger(CertificationsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.firebase.firestore();
  }

  async create(
    vehicleId: string,
    dto: CreateCertificationDto,
    user: AuthenticatedUser,
    files?: {
      vehiclePhoto?: Express.Multer.File;
      rimsPhoto?: Express.Multer.File;
    },
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    if (vehicle['status'] !== VehicleStatus.DOCUMENTADO) {
      throw new BadRequestException(
        `El vehículo debe estar en estado DOCUMENTADO para certificar. Estado actual: ${vehicle['status']}`,
      );
    }

    // Checkear si ya existe certificación
    const existing = await this.db.collection('certifications').doc(vehicleId).get();
    if (existing.exists) {
      throw new BadRequestException('Este vehículo ya tiene una certificación registrada');
    }

    let rimsPhotoUrl: string | null = null;
    let vehiclePhotoUrl: string | null = null;

    // Subir foto del vehículo si viene como archivo o base64
    if (files?.vehiclePhoto) {
      const vPhotoPath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.uploadBuffer(files.vehiclePhoto.buffer, vPhotoPath, files.vehiclePhoto.mimetype);
      vehiclePhotoUrl = await this.firebase.getSignedUrl(vPhotoPath);
    } else if (dto.vehiclePhotoBase64) {
      const vPhotoPath = `vehicles/${vehicleId}/photo.jpg`;
      const buffer = Buffer.from(dto.vehiclePhotoBase64, 'base64');
      await this.firebase.uploadBuffer(buffer, vPhotoPath, 'image/jpeg');
      vehiclePhotoUrl = await this.firebase.getSignedUrl(vPhotoPath);
    }

    // Subir foto de aros si viene
    if (files?.rimsPhoto) {
      const storagePath = `vehicles/${vehicleId}/rims-photo.jpg`;
      await this.firebase.uploadBuffer(files.rimsPhoto.buffer, storagePath, files.rimsPhoto.mimetype);
      rimsPhotoUrl = await this.firebase.getSignedUrl(storagePath);
    }

    const now = this.firebase.serverTimestamp();
    const certData = {
      vehicleId,
      radio: dto.radio,
      rims: {
        status: dto.rimsStatus,
        photoUrl: rimsPhotoUrl,
      },
      seatType: dto.seatType,
      antenna: dto.antenna,
      trunkCover: dto.trunkCover,
      mileage: dto.mileage,
      imprints: dto.imprints,
      notes: dto.notes ?? null,
      certifiedAt: now,
      certifiedBy: user.uid,
    };

    await this.db.collection('certifications').doc(vehicleId).set(certData);

    // Cambiar estado del vehículo a CERTIFICADO_STOCK + guardar datos de recepción
    await this.vehiclesService.changeStatus(vehicleId, VehicleStatus.CERTIFICADO_STOCK, user, {
      extraFields: {
        certificationDate: now,
        certifiedBy: user.uid,
        originConcessionaire: dto.originConcessionaire,
        receptionDate: now,
        ...(vehiclePhotoUrl && { photoUrl: vehiclePhotoUrl }),
      },
    });

    // Notificaciones según condiciones
    if (dto.mileage > 10) {
      await Promise.all([
        this.notificationsService.notify({
          type: 'KILOMETRAJE_ALTO',
          targetRole: RoleEnum.JEFE_TALLER,
          targetSede: vehicle['sede'],
          title: '⚠️ Kilometraje alto detectado',
          body: `Vehículo ${vehicle['chassis']} tiene ${dto.mileage} km`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
        this.notificationsService.notify({
          type: 'KILOMETRAJE_ALTO',
          targetRole: RoleEnum.LIDER_TECNICO,
          targetSede: vehicle['sede'],
          title: '⚠️ Kilometraje alto detectado',
          body: `Vehículo ${vehicle['chassis']} tiene ${dto.mileage} km`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
      ]);
    }

    if (dto.imprints === ImprintsStatus.SIN_IMPRONTAS) {
      await Promise.all([
        this.notificationsService.notify({
          type: 'SIN_IMPRONTAS',
          targetRole: RoleEnum.JEFE_TALLER,
          targetSede: vehicle['sede'],
          title: '⚠️ Vehículo sin improntas',
          body: `El vehículo ${vehicle['chassis']} fue certificado sin improntas`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
        this.notificationsService.notify({
          type: 'SIN_IMPRONTAS',
          targetRole: RoleEnum.LIDER_TECNICO,
          targetSede: vehicle['sede'],
          title: '⚠️ Vehículo sin improntas',
          body: `El vehículo ${vehicle['chassis']} fue certificado sin improntas`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
        this.notificationsService.notify({
          type: 'SIN_IMPRONTAS',
          targetRole: RoleEnum.DOCUMENTACION,
          targetSede: vehicle['sede'],
          title: '⚠️ Vehículo sin improntas',
          body: `El vehículo ${vehicle['chassis']} fue certificado sin improntas`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
      ]);
    }

    // Notificar a ASESOR / LIDER_TECNICO que el vehículo está certificado (listo para OT)
    await this.notificationsService.notify({
      type: 'ESTADO_CAMBIADO',
      targetRole: RoleEnum.ASESOR,
      targetSede: vehicle['sede'],
      title: '✅ Vehículo certificado en stock',
      body: `El vehículo ${vehicle['chassis']} está certificado y listo para generar OT`,
      vehicleId,
      chassis: vehicle['chassis'] as string,
    });

    this.logger.log(`Certificación creada para vehículo ${vehicleId}`);

    return {
      vehicleId,
      newStatus: VehicleStatus.CERTIFICADO_STOCK,
      certificationDate: new Date().toISOString(),
    };
  }

  async findOne(vehicleId: string) {
    const doc = await this.db.collection('certifications').doc(vehicleId).get();
    if (!doc.exists) throw new NotFoundException('Certificación no encontrada');

    const data = doc.data() as Record<string, any>;

    // Regenerar signed URL para que nunca expire en el GET
    if (data?.rims?.photoUrl) {
      const storagePath = `vehicles/${vehicleId}/rims-photo.jpg`;
      data.rims = {
        ...data.rims,
        photoUrl: await this.firebase
          .getSignedUrl(storagePath)
          .catch(() => data.rims.photoUrl),
      };
    }

    return data;
  }

  async update(
    vehicleId: string,
    dto: Partial<CreateCertificationDto>,
    files?: {
      vehiclePhoto?: Express.Multer.File;
      rimsPhoto?: Express.Multer.File;
    },
  ) {
    const doc = await this.db.collection('certifications').doc(vehicleId).get();
    if (!doc.exists) throw new NotFoundException('Certificación no encontrada');

    const updates: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)),
      updatedAt: this.firebase.serverTimestamp(),
    };

    // Reemplazar foto del vehículo si se recibe nueva
    if (files?.vehiclePhoto) {
      const vPhotoPath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.deleteFile(vPhotoPath).catch(() => {});
      await this.firebase.uploadBuffer(files.vehiclePhoto.buffer, vPhotoPath, files.vehiclePhoto.mimetype);
      const newVUrl = await this.firebase.getSignedUrl(vPhotoPath);
      // Actualizar photoUrl en el vehículo
      await this.db.collection('vehicles').doc(vehicleId).update({ photoUrl: newVUrl });
    } else if (dto.vehiclePhotoBase64) {
      const vPhotoPath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.deleteFile(vPhotoPath).catch(() => {});
      const buffer = Buffer.from(dto.vehiclePhotoBase64, 'base64');
      await this.firebase.uploadBuffer(buffer, vPhotoPath, 'image/jpeg');
      const newVUrl = await this.firebase.getSignedUrl(vPhotoPath);
      await this.db.collection('vehicles').doc(vehicleId).update({ photoUrl: newVUrl });
    }
    // Limpiar vehiclePhotoBase64 del update de certificación (no se guarda en cert doc)
    delete updates['vehiclePhotoBase64'];

    // Actualizar originConcessionaire en el vehículo si viene
    if (dto.originConcessionaire) {
      await this.db.collection('vehicles').doc(vehicleId).update({ originConcessionaire: dto.originConcessionaire });
    }

    // Reemplazar foto de aros si se recibe nueva
    if (files?.rimsPhoto) {
      const storagePath = `vehicles/${vehicleId}/rims-photo.jpg`;
      await this.firebase.deleteFile(storagePath).catch(() => {});
      await this.firebase.uploadBuffer(files.rimsPhoto.buffer, storagePath, files.rimsPhoto.mimetype);
      const newUrl = await this.firebase.getSignedUrl(storagePath);
      updates['rims'] = { ...(doc.data()?.['rims'] ?? {}), photoUrl: newUrl };
    }

    await this.db.collection('certifications').doc(vehicleId).update(updates);
    return { vehicleId, updated: true };
  }

  async remove(vehicleId: string, user: AuthenticatedUser) {
    const doc = await this.db.collection('certifications').doc(vehicleId).get();
    if (!doc.exists) throw new NotFoundException('Certificación no encontrada');

    // Eliminar foto de aros de Firebase Storage
    await this.firebase.deleteFile(`vehicles/${vehicleId}/rims-photo.jpg`).catch(() => {});

    // Eliminar el documento de certificación
    await this.db.collection('certifications').doc(vehicleId).delete();

    // Revertir el vehículo a DOCUMENTADO para que pueda ser re-certificado
    await this.vehiclesService.changeStatus(
      vehicleId,
      VehicleStatus.DOCUMENTADO,
      user,
      {
        notes: 'Certificación eliminada por JEFE_TALLER/SOPORTE — requiere re-certificación',
        extraFields: { certificationDate: null, certifiedBy: null },
      },
    );

    this.logger.log(`Certificación eliminada para vehículo ${vehicleId} por ${user.uid}`);
    return { vehicleId, deleted: true };
  }
}
