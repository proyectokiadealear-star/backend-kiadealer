import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() { return this.firebase.firestore(); }

  async create(dto: CreateAppointmentDto, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(dto.vehicleId);

    if (vehicle['status'] !== VehicleStatus.LISTO_PARA_ENTREGA) {
      throw new BadRequestException(`El vehículo debe estar LISTO_PARA_ENTREGA. Estado: ${vehicle['status']}`);
    }

    const aptId = uuidv4();
    const now = this.firebase.serverTimestamp();

    const aptData = {
      id: aptId,
      vehicleId: dto.vehicleId,
      chassis: vehicle['chassis'],
      model: vehicle['model'],
      sede: vehicle['sede'],
      scheduledDate: dto.scheduledDate,
      scheduledTime: dto.scheduledTime,
      assignedAdvisorId: dto.assignedAdvisorId,
      assignedAdvisorName: dto.assignedAdvisorName,
      status: 'AGENDADO',
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('appointments').doc(aptId).set(aptData);

    await this.vehiclesService.changeStatus(dto.vehicleId, VehicleStatus.AGENDADO, user, {
      extraFields: { appointmentId: aptId },
    });

    await Promise.all([
      this.notificationsService.notify({
        type: 'AGENDADO',
        targetRole: RoleEnum.ASESOR,
        targetSede: vehicle['sede'],
        title: '📅 Entrega agendada',
        body: `El vehículo ${vehicle['chassis']} fue agendado para el ${dto.scheduledDate} a las ${dto.scheduledTime}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
        data: { advisorId: dto.assignedAdvisorId },
      }),
      this.notificationsService.notify({
        type: 'AGENDADO',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '📅 Entrega agendada',
        body: `El vehículo ${vehicle['chassis']} fue agendado para el ${dto.scheduledDate}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    return { aptId, vehicleId: dto.vehicleId, newStatus: VehicleStatus.AGENDADO };
  }

  async findAll(user: AuthenticatedUser, dateFrom?: string, dateTo?: string) {
    let query: FirebaseFirestore.Query = this.db.collection('appointments');

    if (user.role !== RoleEnum.JEFE_TALLER) {
      query = query.where('sede', '==', user.sede);
    }

    const snapshot = await query.orderBy('scheduledDate', 'asc').get();
    let docs = snapshot.docs.map((d) => d.data());

    if (dateFrom) docs = docs.filter((d) => d['scheduledDate'] >= dateFrom);
    if (dateTo) docs = docs.filter((d) => d['scheduledDate'] <= dateTo);

    return docs;
  }

  async update(aptId: string, dto: UpdateAppointmentDto, user: AuthenticatedUser) {
    const doc = await this.db.collection('appointments').doc(aptId).get();
    if (!doc.exists) throw new NotFoundException('Agendamiento no encontrado');

    await this.db.collection('appointments').doc(aptId).update({
      ...dto,
      updatedAt: this.firebase.serverTimestamp(),
    });

    return { aptId, updated: true };
  }
}
