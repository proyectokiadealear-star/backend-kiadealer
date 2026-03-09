import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCeremonyDto } from './dto/delivery.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() { return this.firebase.firestore(); }

  async createCeremony(
    vehicleId: string,
    dto: CreateCeremonyDto,
    user: AuthenticatedUser,
    files?: {
      deliveryPhoto?: Express.Multer.File;
      signedActa?: Express.Multer.File;
    },
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    if (vehicle['status'] !== VehicleStatus.AGENDADO) {
      throw new BadRequestException(`El vehículo debe estar AGENDADO. Estado: ${vehicle['status']}`);
    }

    // Verificar que el asesor es el asignado al agendamiento
    const aptSnap = await this.db.collection('appointments').doc(dto.appointmentId).get();
    if (!aptSnap.exists) throw new NotFoundException('Agendamiento no encontrado');

    const apt = aptSnap.data()!;
    if (apt['assignedAdvisorId'] !== user.uid && user.role !== RoleEnum.JEFE_TALLER && user.role !== RoleEnum.SOPORTE) {
      throw new ForbiddenException('Solo el asesor asignado puede ejecutar la ceremonia de entrega');
    }

    // Validar que la entrega ocurre el día agendado
    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (apt['scheduledDate'] && apt['scheduledDate'] !== todayStr) {
      throw new BadRequestException(
        `La ceremonia solo puede ejecutarse el día agendado (${apt['scheduledDate']}). Hoy es ${todayStr}.`,
      );
    }

    const basePath = `vehicles/${vehicleId}/delivery`;
    const [deliveryPhotoUrl, signedActaUrl] = await Promise.all([
      files?.deliveryPhoto
        ? this.firebase.uploadBuffer(files.deliveryPhoto.buffer, `${basePath}/ceremony-photo.jpg`, files.deliveryPhoto.mimetype)
            .then(() => this.firebase.getSignedUrl(`${basePath}/ceremony-photo.jpg`))
        : Promise.resolve(null),
      files?.signedActa
        ? this.firebase.uploadBuffer(files.signedActa.buffer, `${basePath}/signed-acta.jpg`, files.signedActa.mimetype)
            .then(() => this.firebase.getSignedUrl(`${basePath}/signed-acta.jpg`))
        : Promise.resolve(null),
    ]);

    const now = this.firebase.serverTimestamp();

    const ceremonyData = {
      vehicleId,
      appointmentId: dto.appointmentId,
      deliveryPhotoUrl,
      signedActaUrl,
      clientComment: dto.clientComment ?? null,
      deliveredBy: user.uid,
      deliveredByName: user.displayName ?? user.email,
      createdAt: now,
    };

    await this.db.collection('deliveryCeremonies').doc(vehicleId).set(ceremonyData);

    await this.vehiclesService.changeStatus(vehicleId, VehicleStatus.ENTREGADO, user, {
      notes: `Entregado por ${user.displayName ?? user.email} — agendamiento ${dto.appointmentId}`,
      extraFields: {
        deliveryDate: now,
        deliveredBy: user.uid,
        deliveredByName: user.displayName ?? user.email,
      },
    });

    // Marcar el agendamiento como completado
    await this.db.collection('appointments').doc(dto.appointmentId).update({
      status: 'ENTREGADO',
      updatedAt: now,
    });

    await this.notificationsService.notify({
      type: 'ESTADO_CAMBIADO',
      targetRole: RoleEnum.JEFE_TALLER,
      targetSede: 'ALL',
      title: '🎉 Vehículo entregado',
      body: `El vehículo ${vehicle['chassis']} fue entregado exitosamente`,
      vehicleId,
      chassis: vehicle['chassis'] as string,
    });

    this.logger.log(`Ceremonia de entrega completada para vehículo ${vehicleId}`);

    return { vehicleId, newStatus: VehicleStatus.ENTREGADO, deliveryDate: new Date().toISOString() };
  }

  async getCeremony(vehicleId: string) {
    const doc = await this.db.collection('deliveryCeremonies').doc(vehicleId).get();
    if (!doc.exists) return null;

    const data = doc.data() as Record<string, any>;

    // Regenerar signed URLs para que nunca expiren en el GET
    if (data?.deliveryPhotoUrl) {
      data.deliveryPhotoUrl = await this.firebase
        .getSignedUrl(`vehicles/${vehicleId}/delivery/ceremony-photo.jpg`)
        .catch(() => data.deliveryPhotoUrl);
    }
    if (data?.signedActaUrl) {
      data.signedActaUrl = await this.firebase
        .getSignedUrl(`vehicles/${vehicleId}/delivery/signed-acta.jpg`)
        .catch(() => data.signedActaUrl);
    }

    return data;
  }
}
