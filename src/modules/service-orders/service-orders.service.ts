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
  ServiceOrdersRepository,
  ServiceOrderDocument,
  OrderAccessory,
  ChecklistItem,
  OrderPrediction,
} from './service-orders.repository';
import { VehicleFieldsRepository } from './vehicle-fields.repository';
import { DocumentationLookupRepository } from './documentation-lookup.repository';
import {
  CreateServiceOrderDto,
  AssignTechnicianDto,
  UpdateChecklistDto,
  ReopenOrderDto,
} from './dto/service-order.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  AccessoryClassification,
  AccessoryKey,
} from '../../common/enums/accessory-key.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SedeEnum } from '../../common/enums/sede.enum';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ServiceOrdersService {
  private readonly logger = new Logger(ServiceOrdersService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
    private readonly serviceOrders: ServiceOrdersRepository,
    private readonly vehicleFields: VehicleFieldsRepository,
    private readonly documentationLookup: DocumentationLookupRepository,
  ) {}

  private generateOrderNumber(sede: string): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${sede}-${dateStr}-${suffix}`;
  }

  async create(dto: CreateServiceOrderDto, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(dto.vehicleId);

    const isCertifiedNoFacturado =
      vehicle['status'] === VehicleStatus.DOCUMENTADO &&
      vehicle['certifiedWhileNoFacturado'] === true;

    const isCertifiedEarlyState =
      vehicle['status'] === VehicleStatus.DOCUMENTADO &&
      vehicle['certifiedWhileEarlyState'] === true;

    if (
      vehicle['status'] !== VehicleStatus.CERTIFICADO_STOCK &&
      !isCertifiedNoFacturado &&
      !isCertifiedEarlyState
    ) {
      throw new BadRequestException(
        `El vehículo debe estar CERTIFICADO_STOCK o DOCUMENTADO (con certificación previa) para generar OT. Estado actual: ${vehicle['status']}`,
      );
    }

    // Obtener accesorios vendidos/obsequiados de documentación. El puente
    // devuelve `null` tanto si no existe como si es de otro concesionario —
    // en ambos casos, para este tenant, "no hay documentación registrada".
    let docData: Record<string, unknown> | null;
    try {
      docData = await this.documentationLookup.findByVehicleId(dto.vehicleId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error leyendo documentación de Firestore para vehículo ${dto.vehicleId}: ${msg}`,
      );
      throw err;
    }
    if (!docData)
      throw new BadRequestException(
        'El vehículo no tiene documentación registrada',
      );

    const rawAccessories = docData['accessories'];
    const accessories: OrderAccessory[] = Array.isArray(rawAccessories)
      ? (rawAccessories as OrderAccessory[])
      : [];
    const orderAccessories = accessories.filter(
      (a) =>
        a.classification === AccessoryClassification.VENDIDO ||
        a.classification === AccessoryClassification.OBSEQUIADO,
    );

    // Algoritmo de predicción — acotado al concesionario activo, ver
    // DocumentationLookupRepository.findRecentForActiveTenant().
    const predictions = await this.runPrediction(
      orderAccessories,
      dto.vehicleId,
    );

    const orderId = uuidv4();
    // Usar número de orden proporcionado por el usuario, o generar uno automáticamente como fallback
    const orderNumber =
      dto.orderNumber?.trim() ||
      this.generateOrderNumber(vehicle['sede'] as string);
    const now = this.firebase.serverTimestamp();

    const orderData: Omit<ServiceOrderDocument, 'tenantId' | 'id'> = {
      orderNumber,
      vehicleId: dto.vehicleId,
      sede: vehicle['sede'] as string,
      chassis: vehicle['chassis'] as string,
      accessories: orderAccessories,
      predictions,
      checklist: orderAccessories.map((a) => ({
        key: a.key,
        installed: false,
      })),
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

    // El id del documento se genera acá (uuid) en vez de dejar que Firestore
    // lo autoasigne, porque orderId se usa para responder al cliente antes
    // de que la escritura confirme.
    await this.serviceOrders.create(orderData, orderId);

    await this.vehiclesService.changeStatus(
      dto.vehicleId,
      VehicleStatus.ORDEN_GENERADA,
      user,
      {
        notes: `OT ${orderNumber} generada por ${user.displayName ?? user.email}`,
        extraFields: {
          currentOrderId: orderId,
          currentOrderNumber: orderNumber,
        },
      },
    );

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

  async findAll(
    user: AuthenticatedUser,
    filters?: {
      sede?: string;
      status?: string;
      vehicleId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    // La query base ya viene acotada al tenant activo — el repositorio
    // inyecta el where('tenantId', ...) que antes no existía.
    let query = this.serviceOrders.query();

    // PERSONAL_TALLER solo ve sus OTs asignadas
    if (user.role === RoleEnum.PERSONAL_TALLER) {
      query = query.where('assignedTechnicianId', '==', user.uid);
    } else if (user.role !== RoleEnum.JEFE_TALLER) {
      query = query.where('sede', '==', user.sede);
    } else if (filters?.sede) {
      query = query.where('sede', '==', filters.sede);
    }

    // Filtrar vehicleId en Firestore cuando sea el único filtro extra
    // (evita traer toda la colección para consultas por vehículo)
    if (filters?.vehicleId) {
      query = query.where('vehicleId', '==', filters.vehicleId);
    }

    // Sin where adicionales para status para evitar índices compuestos — filtrar en memoria
    const snapshot = await query.get();
    let results = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }) as ServiceOrderDocument)
      .sort((a, b) => {
        const aTs = (a['createdAt'] as any)?._seconds ?? 0;
        const bTs = (b['createdAt'] as any)?._seconds ?? 0;
        return bTs - aTs;
      });

    if (filters?.status) {
      // Soporta múltiples status separados por coma: ?status=ASIGNADA,EN_INSTALACION
      const statusList = filters.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      results = results.filter((d) => statusList.includes(d.status));
    }

    const total = results.length;
    const page = Math.max(1, filters?.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 20));
    const totalPages = Math.ceil(total / limit);
    const data = results.slice((page - 1) * limit, page * limit);

    return { data, total, page, limit, totalPages };
  }

  async findOne(id: string): Promise<ServiceOrderDocument> {
    return this.serviceOrders.findByIdOrThrow(
      id,
      () => new NotFoundException('Orden de trabajo no encontrada'),
    );
  }

  async assignTechnician(
    orderId: string,
    dto: AssignTechnicianDto,
    user: AuthenticatedUser,
  ) {
    if (
      user.role !== RoleEnum.LIDER_TECNICO &&
      user.role !== RoleEnum.JEFE_TALLER &&
      user.role !== RoleEnum.SOPORTE
    ) {
      throw new ForbiddenException(
        'Solo el Líder Técnico puede asignar técnicos',
      );
    }

    const order = await this.findOne(orderId);
    const vehicle = await this.vehiclesService.assertExists(order.vehicleId);

    const allowedOrderStatuses = ['GENERADA', 'ASIGNADA', 'EN_INSTALACION'];
    if (!allowedOrderStatuses.includes(order.status)) {
      throw new BadRequestException(
        `La OT debe estar en estado GENERADA, ASIGNADA o EN_INSTALACION para asignar técnico. Estado actual: ${order.status}`,
      );
    }

    const previousTechnicianId: string | null =
      order.assignedTechnicianId ?? null;
    const previousTechnicianName: string | null =
      order.assignedTechnicianName ?? null;
    const isReassignment =
      !!previousTechnicianId && previousTechnicianId !== dto.technicianUid;

    await this.serviceOrders.update(orderId, {
      assignedTechnicianId: dto.technicianUid,
      assignedTechnicianName: dto.technicianName,
      assignedAt: this.firebase.serverTimestamp(),
      status: 'ASIGNADA',
      updatedAt: this.firebase.serverTimestamp(),
    });

    const historyNote = isReassignment
      ? `Técnico reasignado: ${previousTechnicianName} → ${dto.technicianName} por ${user.displayName ?? user.email}`
      : `Técnico asignado: ${dto.technicianName} por ${user.displayName ?? user.email}`;

    const currentVehicleStatus = vehicle['status'] as VehicleStatus;
    const vehicleAlreadyAdvanced =
      currentVehicleStatus === VehicleStatus.EN_INSTALACION ||
      currentVehicleStatus === VehicleStatus.INSTALACION_COMPLETA;

    if (vehicleAlreadyAdvanced) {
      // El vehículo ya avanzó más allá de ASIGNADO — solo actualizamos los campos
      // del técnico sin retroceder ni re-escribir el estado
      await this.vehicleFields.updateFields(order.vehicleId, {
        assignedTechnicianId: dto.technicianUid,
        assignedTechnicianName: dto.technicianName,
        updatedAt: this.firebase.serverTimestamp(),
      });
      await this.vehiclesService.addStatusHistory(
        order.vehicleId,
        currentVehicleStatus,
        currentVehicleStatus,
        user,
        // ServiceOrderDocument tipa `sede` como string (D-107 la retira del
        // dominio vía SedeEnum), pero VehiclesService.addStatusHistory —
        // sin migrar todavía — sigue exigiendo el enum. Cast acotado a este
        // único punto de fricción, sin reintroducir SedeEnum en el resto
        // del servicio.
        order.sede as SedeEnum,
        historyNote,
      );
    } else {
      await this.vehiclesService.changeStatus(
        order.vehicleId,
        VehicleStatus.ASIGNADO,
        user,
        {
          notes: historyNote,
          extraFields: {
            assignedTechnicianId: dto.technicianUid,
            assignedTechnicianName: dto.technicianName,
          },
        },
      );
    }

    const notifBody = `Se te asignó el vehículo ${vehicle['chassis']} para instalación`;
    const notifJobs: Promise<void>[] = [
      this.notificationsService.notify({
        type: 'TECNICO_ASIGNADO',
        targetRole: RoleEnum.PERSONAL_TALLER,
        targetSede: order.sede,
        title: '🔨 Nueva asignación de instalación',
        body: notifBody,
        vehicleId: order.vehicleId,
        chassis: vehicle['chassis'] as string,
        data: { technicianId: dto.technicianUid },
      }),
    ];

    if (isReassignment) {
      // Notificar al técnico anterior que fue removido de la OT
      notifJobs.push(
        this.notificationsService.notify({
          type: 'TECNICO_REMOVIDO',
          targetRole: RoleEnum.PERSONAL_TALLER,
          targetSede: order.sede,
          title: '⚠️ Reasignación de OT',
          body: `El vehículo ${vehicle['chassis']} fue reasignado a otro técnico`,
          vehicleId: order.vehicleId,
          chassis: vehicle['chassis'] as string,
          data: { technicianId: previousTechnicianId },
        }),
      );
    }

    await Promise.all(notifJobs);

    this.logger.log(
      `${isReassignment ? 'Reasignación' : 'Asignación'} de técnico en OT ${orderId}: ${dto.technicianUid}`,
    );
    return { orderId, assignedTechnicianId: dto.technicianUid, isReassignment };
  }

  async updateChecklist(
    orderId: string,
    dto: UpdateChecklistDto,
    user: AuthenticatedUser,
  ) {
    const order = await this.findOne(orderId);

    const allowedOrderStatuses = ['ASIGNADA', 'EN_INSTALACION'];
    if (!allowedOrderStatuses.includes(order.status)) {
      throw new BadRequestException(
        `No se puede actualizar el checklist desde el estado '${order.status}'. Estado requerido: ASIGNADA o EN_INSTALACION`,
      );
    }

    const isOverrideRole =
      user.role === RoleEnum.JEFE_TALLER || user.role === RoleEnum.SOPORTE;
    if (order.assignedTechnicianId !== user.uid && !isOverrideRole) {
      throw new ForbiddenException(
        'Solo el técnico asignado puede marcar la instalación',
      );
    }

    const checklist: ChecklistItem[] = order.checklist ?? [];
    const idx = checklist.findIndex((c) => c.key === dto.accessoryKey);
    if (idx === -1)
      throw new NotFoundException(
        `Accesorio '${dto.accessoryKey}' no encontrado en la OT`,
      );

    checklist[idx].installed = dto.installed;

    const allInstalled = checklist.every((c) => c.installed);
    const newOrderStatus = allInstalled
      ? 'INSTALACION_COMPLETA'
      : 'EN_INSTALACION';

    await this.serviceOrders.update(orderId, {
      checklist,
      status: newOrderStatus,
      updatedAt: this.firebase.serverTimestamp(),
    });

    const vehicleId = order.vehicleId;
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const vehicleNewStatus = allInstalled
      ? VehicleStatus.INSTALACION_COMPLETA
      : VehicleStatus.EN_INSTALACION;

    await this.vehiclesService.changeStatus(vehicleId, vehicleNewStatus, user, {
      notes: allInstalled
        ? `Instalación completada por ${user.displayName ?? user.email}`
        : `Accesorio '${dto.accessoryKey}' marcado como instalado por ${user.displayName ?? user.email}`,
      extraFields: allInstalled
        ? {
            installationCompleteDate: this.firebase.serverTimestamp(),
            installedBy: user.uid,
          }
        : {},
    });

    if (allInstalled) {
      await Promise.all([
        this.notificationsService.notify({
          type: 'INSTALACION_LISTA',
          targetRole: RoleEnum.LIDER_TECNICO,
          targetSede: order.sede,
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
    } else {
      // Notificar al técnico asignado que la instalación está en curso
      await this.notificationsService.notify({
        type: 'INICIO_INSTALACION',
        targetRole: RoleEnum.PERSONAL_TALLER,
        targetSede: order.sede,
        title: '🔧 Instalación en curso',
        body: `Accesorio '${dto.accessoryKey}' instalado en vehículo ${vehicle['chassis']}`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
        data: { technicianId: order.assignedTechnicianId ?? '' },
      });
    }

    return {
      orderId,
      vehicleId,
      allInstalled,
      newOrderStatus,
      vehicleNewStatus,
    };
  }

  async markReadyForDelivery(orderId: string, user: AuthenticatedUser) {
    if (
      user.role !== RoleEnum.LIDER_TECNICO &&
      user.role !== RoleEnum.JEFE_TALLER
    ) {
      throw new ForbiddenException(
        'Solo el Líder Técnico puede marcar listo para entrega',
      );
    }

    const order = await this.findOne(orderId);
    const vehicle = await this.vehiclesService.assertExists(order.vehicleId);

    if (vehicle['status'] !== VehicleStatus.INSTALACION_COMPLETA) {
      throw new BadRequestException(
        'La instalación debe estar completa para marcar listo para entrega',
      );
    }

    await this.serviceOrders.update(orderId, {
      status: 'LISTO_PARA_ENTREGA',
      updatedAt: this.firebase.serverTimestamp(),
    });

    await this.vehiclesService.changeStatus(
      order.vehicleId,
      VehicleStatus.LISTO_PARA_ENTREGA,
      user,
      {
        notes: `Instalación aprobada y marcada lista para entrega por ${user.displayName ?? user.email}`,
      },
    );

    await Promise.all([
      this.notificationsService.notify({
        type: 'LISTO_ENTREGA',
        targetRole: RoleEnum.ASESOR,
        targetSede: order.sede,
        title: '🚗 Vehículo listo para entrega',
        body: `El vehículo ${vehicle['chassis']} está listo para agendar entrega`,
        vehicleId: order.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'LISTO_ENTREGA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '🚗 Vehículo listo para entrega',
        body: `El vehículo ${vehicle['chassis']} está listo para agendar entrega`,
        vehicleId: order.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    return {
      orderId,
      vehicleId: order.vehicleId,
      newStatus: VehicleStatus.LISTO_PARA_ENTREGA,
    };
  }

  async reopenOrder(dto: ReopenOrderDto, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(dto.vehicleId);

    const allowedStatuses = [
      VehicleStatus.EN_INSTALACION,
      VehicleStatus.INSTALACION_COMPLETA,
      VehicleStatus.LISTO_PARA_ENTREGA,
    ];
    if (!allowedStatuses.includes(vehicle['status'] as VehicleStatus)) {
      throw new BadRequestException(
        'Solo se puede reabrir desde EN_INSTALACION, INSTALACION_COMPLETA o LISTO_PARA_ENTREGA',
      );
    }

    const accessoryLabels = dto.newAccessories.join(', ');
    const now = this.firebase.serverTimestamp();

    // Guardar info de reapertura en el vehículo para que documentación la consuma
    await this.vehicleFields.updateFields(dto.vehicleId, {
      isReopening: true,
      reopenReason: dto.reason,
      reopenAccessories: dto.newAccessories,
      reopenRequestedBy: user.uid,
      reopenRequestedByName: user.displayName ?? user.email,
      reopenRequestedAt: now,
    });

    // Cambiar estado a DOCUMENTACION_PENDIENTE (el statusHistory registra el motivo)
    await this.vehiclesService.changeStatus(
      dto.vehicleId,
      VehicleStatus.DOCUMENTACION_PENDIENTE,
      user,
      {
        notes: `Reapertura por ${user.displayName ?? user.email}: ${dto.reason}. Accesorios solicitados: ${accessoryLabels}`,
      },
    );

    await Promise.all([
      this.notificationsService.notify({
        type: 'REAPERTURA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '🔄 Reapertura de Orden de Trabajo',
        body: `${vehicle['chassis']} — Reapertura: ${dto.reason}. Accesorios: ${accessoryLabels}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'REAPERTURA',
        targetRole: RoleEnum.ASESOR,
        targetSede: vehicle['sede'],
        title: '🔄 Reapertura — Documentación requerida',
        body: `${vehicle['chassis']} requiere documentar accesorios adicionales: ${accessoryLabels}. Motivo: ${dto.reason}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'REAPERTURA',
        targetRole: RoleEnum.LIDER_TECNICO,
        targetSede: vehicle['sede'],
        title: '🔄 Reapertura de Orden de Trabajo',
        body: `${vehicle['chassis']} — Reapertura: ${dto.reason}. Accesorios: ${accessoryLabels}`,
        vehicleId: dto.vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    this.logger.log(
      `Reapertura solicitada para vehículo ${dto.vehicleId} por ${user.uid}`,
    );
    return {
      vehicleId: dto.vehicleId,
      newStatus: VehicleStatus.DOCUMENTACION_PENDIENTE,
      isReopening: true,
      reopenAccessories: dto.newAccessories,
      reason: dto.reason,
    };
  }

  async getPredictions(vehicleId: string): Promise<OrderPrediction[]> {
    const docData = await this.documentationLookup.findByVehicleId(vehicleId);
    if (!docData) return [];

    const raw = docData['accessories'];
    const accessories: OrderAccessory[] = Array.isArray(raw)
      ? (raw as OrderAccessory[])
      : [];
    return this.runPrediction(accessories, vehicleId);
  }

  /** Algoritmo de predicción de accesorios basado en patrones históricos */
  private async runPrediction(
    currentAccessories: OrderAccessory[],
    vehicleId: string,
  ): Promise<OrderPrediction[]> {
    const threshold = Number(process.env.PREDICTION_THRESHOLD ?? 40);

    const soldKeys = currentAccessories
      .filter(
        (a) =>
          a.classification === AccessoryClassification.VENDIDO ||
          a.classification === AccessoryClassification.OBSEQUIADO,
      )
      .map((a) => a.key);

    if (soldKeys.length === 0) return [];

    // Obtener las documentaciones históricas del concesionario ACTIVO
    // únicamente (con caché TTL de 5 min indexada por tenant — ver
    // DocumentationLookupRepository), excluyendo el vehículo actual para no
    // contaminar el historial con sus propios datos.
    const allDocs =
      await this.documentationLookup.findRecentForActiveTenant(500);
    const otherDocs = allDocs
      .filter((entry) => entry.id !== vehicleId)
      .map((entry) => entry.accessories);

    // Encontrar vehículos con al menos una de las mismas keys vendidas
    const similar = otherDocs.filter((acc) => {
      const soldInDoc = acc
        .filter(
          (a) =>
            a.classification === AccessoryClassification.VENDIDO ||
            a.classification === AccessoryClassification.OBSEQUIADO,
        )
        .map((a) => a.key);
      return soldKeys.some((k) => soldInDoc.includes(k));
    });

    if (similar.length === 0) return [];

    // Calcular probabilidad para accesorios no incluidos (excluir OTROS — no es predecible)
    const allAccessoryKeys = (Object.values(AccessoryKey) as string[]).filter(
      (k) => k !== AccessoryKey.OTROS,
    );
    const notCurrentKeys = allAccessoryKeys.filter(
      (k) => !soldKeys.includes(k),
    );

    const predictions: OrderPrediction[] = [];

    for (const key of notCurrentKeys) {
      const count = similar.filter((acc) =>
        acc.some(
          (a) =>
            a.key === key &&
            (a.classification === AccessoryClassification.VENDIDO ||
              a.classification === AccessoryClassification.OBSEQUIADO),
        ),
      ).length;

      const probability = Math.round((count / similar.length) * 100);
      if (probability >= threshold) {
        predictions.push({
          key: key,
          probability,
          reason: `El ${probability}% de clientes con accesorios similares también adquirieron ${key}`,
        });
      }
    }

    return predictions.sort((a, b) => b.probability - a.probability);
  }

  // ──────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────────

  /**
   * Finaliza manualmente la instalación de una OT (para OTs sin accesorios o generadas por seed).
   * Solo el técnico asignado, JEFE_TALLER o SOPORTE pueden finalizar.
   */
  async completeInstallation(orderId: string, user: AuthenticatedUser) {
    // Solo el técnico asignado (o roles de override) pueden finalizar
    const isOverrideRole =
      user.role === RoleEnum.JEFE_TALLER || user.role === RoleEnum.SOPORTE;
    const order = await this.findOne(orderId);
    if (order.assignedTechnicianId !== user.uid && !isOverrideRole) {
      throw new ForbiddenException(
        'Solo el técnico asignado puede finalizar la instalación',
      );
    }
    const allowedStatuses = ['ASIGNADA', 'EN_INSTALACION'];
    if (!allowedStatuses.includes(order.status)) {
      throw new BadRequestException(
        `La OT debe estar en estado ASIGNADA o EN_INSTALACION para finalizarla. Estado actual: ${order.status}`,
      );
    }
    const now = this.firebase.serverTimestamp();
    // Marcar todos los ítems del checklist como instalados (si los hay)
    const checklist: ChecklistItem[] = (order.checklist ?? []).map((c) => ({
      ...c,
      installed: true,
    }));
    await this.serviceOrders.update(orderId, {
      checklist,
      status: 'INSTALACION_COMPLETA',
      updatedAt: now,
    });
    const vehicleId = order.vehicleId;
    const vehicle = await this.vehiclesService.assertExists(vehicleId);
    await this.vehiclesService.changeStatus(
      vehicleId,
      VehicleStatus.INSTALACION_COMPLETA,
      user,
      {
        notes: `Instalación finalizada manualmente por ${user.displayName ?? user.email}${checklist.length === 0 ? ' (OT sin accesorios)' : ''}`,
        extraFields: {
          installationCompleteDate: now,
          installedBy: user.uid,
        },
      },
    );
    await Promise.all([
      this.notificationsService.notify({
        type: 'INSTALACION_LISTA',
        targetRole: RoleEnum.LIDER_TECNICO,
        targetSede: order.sede,
        title: '✅ Instalación completada',
        body: `El vehículo ${vehicle['chassis']} completó la instalación`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'INSTALACION_LISTA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '✅ Instalación completada',
        body: `El vehículo ${vehicle['chassis']} completó la instalación`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);
    this.logger.log(
      `Instalación finalizada manualmente en OT ${orderId} por ${user.uid}`,
    );
    return await this.findOne(orderId);
  }
}
