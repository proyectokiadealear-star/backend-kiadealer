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
import {
  CreateServiceOrderDto,
  AssignTechnicianDto,
  UpdateChecklistDto,
  ReopenOrderDto,
} from './dto/service-order.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AccessoryClassification, AccessoryKey } from '../../common/enums/accessory-key.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { v4 as uuidv4 } from 'uuid';
import { SedeEnum } from '../../common/enums/sede.enum';

@Injectable()
export class ServiceOrdersService {
  private readonly logger = new Logger(ServiceOrdersService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.firebase.firestore();
  }

  private generateOrderNumber(sede: string): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${sede}-${dateStr}-${suffix}`;
  }

  async create(dto: CreateServiceOrderDto, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(dto.vehicleId);

    if (vehicle['status'] !== VehicleStatus.DOCUMENTADO) {
      throw new BadRequestException(
        `El vehículo debe estar DOCUMENTADO para generar OT. Estado actual: ${vehicle['status']}`,
      );
    }

    // Obtener accesorios vendidos/obsequiados de documentación
    const docSnap = await this.db.collection('documentations').doc(dto.vehicleId).get();
    if (!docSnap.exists) throw new BadRequestException('El vehículo no tiene documentación registrada');

    const docData = docSnap.data()!;
    const accessories: Array<{ key: string; classification: string }> = docData['accessories'] ?? [];
    const orderAccessories = accessories.filter(
      (a) =>
        a.classification === AccessoryClassification.VENDIDO ||
        a.classification === AccessoryClassification.OBSEQUIADO,
    );

    // Algoritmo de predicción
    const predictions = await this.runPrediction(orderAccessories, dto.vehicleId);

    const orderId = uuidv4();
    // Usar número de orden proporcionado por el usuario, o generar uno automáticamente como fallback
    const orderNumber = dto.orderNumber?.trim() || this.generateOrderNumber(vehicle['sede'] as string);
    const now = this.firebase.serverTimestamp();

    const orderData = {
      id: orderId,
      orderNumber,
      vehicleId: dto.vehicleId,
      sede: vehicle['sede'],
      chassis: vehicle['chassis'],
      accessories: orderAccessories,
      predictions,
      checklist: orderAccessories.map((a) => ({ key: a.key, installed: false })),
      assignedTechnicianId: null,
      assignedTechnicianName: null,
      assignedAt: null,
      status: 'GENERADA',
      isReopening: false,
      previousOrderId: null,
      createdBy: user.uid,
      createdByName: user.displayName ?? user.email,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('serviceOrders').doc(orderId).set(orderData);

    await this.vehiclesService.changeStatus(dto.vehicleId, VehicleStatus.ORDEN_GENERADA, user, {
      notes: `OT ${orderNumber} generada por ${user.displayName ?? user.email}`,
      extraFields: { currentOrderId: orderId, currentOrderNumber: orderNumber },
    });

    await Promise.all([
      this.notificationsService.notify({
        type: 'OT_GENERADA',
        targetRole: RoleEnum.LIDER_TECNICO,
        targetSede: vehicle['sede'],
        title: '🔧 Nueva Orden de Trabajo generada',
        body: `OT ${orderNumber} lista para asignación de técnico — vehículo ${vehicle['chassis']}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'OT_GENERADA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: vehicle['sede'],
        title: '🔧 Nueva Orden de Trabajo generada',
        body: `OT ${orderNumber} generada para vehículo ${vehicle['chassis']}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    this.logger.log(`OT creada: ${orderId} (${orderNumber})`);

    return { orderId, orderNumber, accessories: orderAccessories, predictions };
  }

  async findAll(user: AuthenticatedUser, filters?: { sede?: string; status?: string; vehicleId?: string }) {
    let query: FirebaseFirestore.Query = this.db.collection('serviceOrders');

    if (user.role !== RoleEnum.JEFE_TALLER) {
      query = query.where('sede', '==', user.sede);
    } else if (filters?.sede) {
      query = query.where('sede', '==', filters.sede);
    }

    if (filters?.status) {
      query = query.where('status', '==', filters.status);
    }
    if (filters?.vehicleId) {
      query = query.where('vehicleId', '==', filters.vehicleId);
    }

    const snapshot = await query.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((d) => d.data());
  }

  async findOne(id: string) {
    const doc = await this.db.collection('serviceOrders').doc(id).get();
    if (!doc.exists) throw new NotFoundException('Orden de trabajo no encontrada');
    return doc.data();
  }

  async assignTechnician(orderId: string, dto: AssignTechnicianDto, user: AuthenticatedUser) {
    if (user.role !== RoleEnum.LIDER_TECNICO && user.role !== RoleEnum.JEFE_TALLER && user.role !== RoleEnum.SOPORTE) {
      throw new ForbiddenException('Solo el Líder Técnico puede asignar técnicos');
    }

    const order = await this.findOne(orderId);
    const vehicle = await this.vehiclesService.assertExists(order!['vehicleId']);

    const allowedOrderStatuses = ['GENERADA', 'ASIGNADA'];
    if (!allowedOrderStatuses.includes(order!['status'])) {
      throw new BadRequestException(
        `La OT debe estar en estado GENERADA o ASIGNADA para asignar técnico. Estado actual: ${order!['status']}`,
      );
    }

    const previousTechnicianId: string | null = order!['assignedTechnicianId'] ?? null;
    const previousTechnicianName: string | null = order!['assignedTechnicianName'] ?? null;
    const isReassignment = !!previousTechnicianId && previousTechnicianId !== dto.technicianId;

    await this.db.collection('serviceOrders').doc(orderId).update({
      assignedTechnicianId: dto.technicianId,
      assignedTechnicianName: dto.technicianName,
      assignedAt: this.firebase.serverTimestamp(),
      status: 'ASIGNADA',
      updatedAt: this.firebase.serverTimestamp(),
    });

    const historyNote = isReassignment
      ? `Técnico reasignado: ${previousTechnicianName} → ${dto.technicianName} por ${user.displayName ?? user.email}`
      : `Técnico asignado: ${dto.technicianName} por ${user.displayName ?? user.email}`;

    await this.vehiclesService.changeStatus(order!['vehicleId'], VehicleStatus.ASIGNADO, user, {
      notes: historyNote,
      extraFields: { assignedTechnicianId: dto.technicianId, assignedTechnicianName: dto.technicianName },
    });

    const notifBody = `Se te asignó el vehículo ${vehicle['chassis']} para instalación`;
    const notifJobs: Promise<void>[] = [
      this.notificationsService.notify({
        type: 'TECNICO_ASIGNADO',
        targetRole: RoleEnum.PERSONAL_TALLER,
        targetSede: order!['sede'],
        title: '🔨 Nueva asignación de instalación',
        body: notifBody,
        vehicleId: order!['vehicleId'],
        chassis: vehicle['chassis'] as string,
        data: { technicianId: dto.technicianId },
      }),
    ];

    if (isReassignment) {
      // Notificar al técnico anterior que fue removido de la OT
      notifJobs.push(
        this.notificationsService.notify({
          type: 'TECNICO_REMOVIDO',
          targetRole: RoleEnum.PERSONAL_TALLER,
          targetSede: order!['sede'],
          title: '⚠️ Reasignación de OT',
          body: `El vehículo ${vehicle['chassis']} fue reasignado a otro técnico`,
          vehicleId: order!['vehicleId'],
          chassis: vehicle['chassis'] as string,
          data: { technicianId: previousTechnicianId },
        }),
      );
    }

    await Promise.all(notifJobs);

    this.logger.log(`${isReassignment ? 'Reasignación' : 'Asignación'} de técnico en OT ${orderId}: ${dto.technicianId}`);
    return { orderId, assignedTechnicianId: dto.technicianId, isReassignment };
  }

  async updateChecklist(orderId: string, dto: UpdateChecklistDto, user: AuthenticatedUser) {
    const order = await this.findOne(orderId);

    const allowedOrderStatuses = ['ASIGNADA', 'EN_INSTALACION'];
    if (!allowedOrderStatuses.includes(order!['status'])) {
      throw new BadRequestException(
        `No se puede actualizar el checklist desde el estado '${order!['status']}'. Estado requerido: ASIGNADA o EN_INSTALACION`,
      );
    }

    const isOverrideRole = user.role === RoleEnum.JEFE_TALLER || user.role === RoleEnum.SOPORTE;
    if (order!['assignedTechnicianId'] !== user.uid && !isOverrideRole) {
      throw new ForbiddenException('Solo el técnico asignado puede marcar la instalación');
    }

    const checklist: Array<{ key: string; installed: boolean }> = order!['checklist'] ?? [];
    const idx = checklist.findIndex((c) => c.key === dto.accessoryKey);
    if (idx === -1) throw new NotFoundException(`Accesorio '${dto.accessoryKey}' no encontrado en la OT`);

    checklist[idx].installed = dto.installed;

    const allInstalled = checklist.every((c) => c.installed);
    const newOrderStatus = allInstalled ? 'INSTALACION_COMPLETA' : 'EN_INSTALACION';

    await this.db.collection('serviceOrders').doc(orderId).update({
      checklist,
      status: newOrderStatus,
      updatedAt: this.firebase.serverTimestamp(),
    });

    const vehicleId = order!['vehicleId'];
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const vehicleNewStatus = allInstalled
      ? VehicleStatus.INSTALACION_COMPLETA
      : VehicleStatus.EN_INSTALACION;

    await this.vehiclesService.changeStatus(vehicleId, vehicleNewStatus, user, {
      notes: allInstalled
        ? `Instalación completada por ${user.displayName ?? user.email}`
        : `Accesorio '${dto.accessoryKey}' marcado como instalado por ${user.displayName ?? user.email}`,
      extraFields: allInstalled
        ? { installationCompleteDate: this.firebase.serverTimestamp(), installedBy: user.uid }
        : {},
    });

    if (allInstalled) {
      await Promise.all([
        this.notificationsService.notify({
          type: 'INSTALACION_LISTA',
          targetRole: RoleEnum.LIDER_TECNICO,
          targetSede: order!['sede'],
          title: '✅ Instalación completada',
          body: `El vehículo ${vehicle['chassis']} completó la instalación de accesorios`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
        this.notificationsService.notify({
          type: 'INSTALACION_LISTA',
          targetRole: RoleEnum.JEFE_TALLER,
          targetSede: 'ALL',
          title: '✅ Instalación completada',
          body: `El vehículo ${vehicle['chassis']} completó la instalación de accesorios`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
      ]);
    }

    return { orderId, vehicleId, allInstalled, newOrderStatus, vehicleNewStatus };
  }

  async markReadyForDelivery(orderId: string, user: AuthenticatedUser) {
    if (user.role !== RoleEnum.LIDER_TECNICO && user.role !== RoleEnum.JEFE_TALLER) {
      throw new ForbiddenException('Solo el Líder Técnico puede marcar listo para entrega');
    }

    const order = await this.findOne(orderId);
    const vehicle = await this.vehiclesService.assertExists(order!['vehicleId']);

    if (vehicle['status'] !== VehicleStatus.INSTALACION_COMPLETA) {
      throw new BadRequestException('La instalación debe estar completa para marcar listo para entrega');
    }

    await this.db.collection('serviceOrders').doc(orderId).update({
      status: 'LISTO_ENTREGA',
      updatedAt: this.firebase.serverTimestamp(),
    });

    await this.vehiclesService.changeStatus(order!['vehicleId'], VehicleStatus.LISTO_PARA_ENTREGA, user, {
      notes: `Instalación aprobada y marcada lista para entrega por ${user.displayName ?? user.email}`,
    });

    await Promise.all([
      this.notificationsService.notify({
        type: 'LISTO_ENTREGA',
        targetRole: RoleEnum.ASESOR,
        targetSede: order!['sede'],
        title: '🚗 Vehículo listo para entrega',
        body: `El vehículo ${vehicle['chassis']} está listo para agendar entrega`,
        vehicleId: order!['vehicleId'],
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'LISTO_ENTREGA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '🚗 Vehículo listo para entrega',
        body: `El vehículo ${vehicle['chassis']} está listo para agendar entrega`,
        vehicleId: order!['vehicleId'],
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    return { orderId, vehicleId: order!['vehicleId'], newStatus: VehicleStatus.LISTO_PARA_ENTREGA };
  }

  async reopenOrder(dto: ReopenOrderDto, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(dto.vehicleId);

    const allowedStatuses = [VehicleStatus.EN_INSTALACION, VehicleStatus.LISTO_PARA_ENTREGA];
    if (!allowedStatuses.includes(vehicle['status'] as VehicleStatus)) {
      throw new BadRequestException('Solo se puede reabrir desde EN_INSTALACION o LISTO_PARA_ENTREGA');
    }

    // Obtener la OT actual
    const currentOrderSnap = await this.db
      .collection('serviceOrders')
      .where('vehicleId', '==', dto.vehicleId)
      .where('isReopening', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    const previousOrderId = currentOrderSnap.empty ? null : currentOrderSnap.docs[0].id;

    const orderId = uuidv4();
    const orderNumber = this.generateOrderNumber(vehicle['sede'] as string);
    const now = this.firebase.serverTimestamp();

    const reopenData = {
      id: orderId,
      orderNumber,
      vehicleId: dto.vehicleId,
      sede: vehicle['sede'],
      chassis: vehicle['chassis'],
      accessories: dto.newAccessories.map((key) => ({
        key,
        classification: AccessoryClassification.VENDIDO,
      })),
      predictions: [],
      checklist: dto.newAccessories.map((key) => ({ key, installed: false })),
      assignedTechnicianId: null,
      assignedTechnicianName: null,
      status: 'REAPERTURA',
      isReopening: true,
      previousOrderId,
      reason: dto.reason,
      createdBy: user.uid,
      createdByName: user.displayName ?? user.email,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('serviceOrders').doc(orderId).set(reopenData);

    await this.vehiclesService.changeStatus(dto.vehicleId, VehicleStatus.REAPERTURA_OT, user, {
      notes: dto.reason,
    });

    await Promise.all([
      this.notificationsService.notify({
        type: 'REAPERTURA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '🔄 Reapertura de Orden de Trabajo',
        body: `El vehículo ${vehicle['chassis']} tuvo reapertura de OT: ${dto.reason}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'REAPERTURA',
        targetRole: RoleEnum.LIDER_TECNICO,
        targetSede: vehicle['sede'],
        title: '🔄 Reapertura de Orden de Trabajo',
        body: `El vehículo ${vehicle['chassis']} tuvo reapertura de OT: ${dto.reason}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    return { orderId, orderNumber, isReopening: true };
  }

  async getPredictions(vehicleId: string) {
    const docSnap = await this.db.collection('documentations').doc(vehicleId).get();
    if (!docSnap.exists) return [];

    const accessories = docSnap.data()!['accessories'] ?? [];
    return this.runPrediction(accessories, vehicleId);
  }

  /** Algoritmo de predicción de accesorios basado en patrones históricos */
  private async runPrediction(
    currentAccessories: Array<{ key: string; classification: string }>,
    vehicleId: string,
  ): Promise<Array<{ key: string; probability: number; reason: string }>> {
    const threshold = Number(process.env.PREDICTION_THRESHOLD ?? 40);

    const soldKeys = currentAccessories
      .filter(
        (a) =>
          a.classification === AccessoryClassification.VENDIDO ||
          a.classification === AccessoryClassification.OBSEQUIADO,
      )
      .map((a) => a.key);

    if (soldKeys.length === 0) return [];

    // Obtener todos los vehículos con documentación
    const allDocsSnap = await this.db.collection('documentations').get();
    const allDocs = allDocsSnap.docs
      .filter((d) => d.id !== vehicleId)
      .map((d) => d.data()!['accessories'] as Array<{ key: string; classification: string }> ?? []);

    // Encontrar vehículos con al menos las mismas keys vendidas
    const similar = allDocs.filter((acc) => {
      const soldInDoc = acc
        .filter((a) => a.classification === AccessoryClassification.VENDIDO || a.classification === AccessoryClassification.OBSEQUIADO)
        .map((a) => a.key);
      return soldKeys.some((k) => soldInDoc.includes(k));
    });

    if (similar.length === 0) return [];

    // Calcular probabilidad para accesorios no incluidos
    const allAccessoryKeys = Object.values(AccessoryKey) as string[];
    const notCurrentKeys = allAccessoryKeys.filter((k) => !soldKeys.includes(k));

    const predictions: Array<{ key: string; probability: number; reason: string }> = [];

    for (const key of notCurrentKeys) {
      const count = similar.filter((acc) =>
        acc.some(
          (a) =>
            a.key === key &&
            (a.classification === AccessoryClassification.VENDIDO || a.classification === AccessoryClassification.OBSEQUIADO),
        ),
      ).length;

      const probability = Math.round((count / similar.length) * 100);
      if (probability >= threshold) {
        predictions.push({
          key: key as string,
          probability,
          reason: `El ${probability}% de clientes con accesorios similares también adquirieron ${key}`,
        });
      }
    }

    return predictions.sort((a, b) => b.probability - a.probability);
  }
}
