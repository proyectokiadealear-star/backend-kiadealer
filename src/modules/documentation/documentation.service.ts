import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateDocumentationDto } from './dto/create-documentation.dto';
import { UpdateDocumentationDto } from './dto/update-documentation.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { AccessoryClassification } from '../../common/enums/accessory-key.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Injectable()
export class DocumentationService {
  private readonly logger = new Logger(DocumentationService.name);

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
    dto: CreateDocumentationDto,
    user: AuthenticatedUser,
    files?: {
      vehicleInvoice?: Express.Multer.File;
      giftEmails: Express.Multer.File[];
      accessoryInvoices: Express.Multer.File[];
    },
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const allowedStatuses = [
      VehicleStatus.ENVIADO_A_MATRICULAR,
      VehicleStatus.DOCUMENTACION_PENDIENTE,
    ];
    if (!allowedStatuses.includes(vehicle['status'] as VehicleStatus)) {
      throw new BadRequestException(
        `El vehículo debe estar en ENVIADO_A_MATRICULAR o DOCUMENTACION_PENDIENTE para documentar. Estado actual: ${vehicle['status']}`,
      );
    }

    const isPending = String(dto.saveAsPending) === 'true';

    this.logger.log(
      `[create] saveAsPending raw="${dto.saveAsPending}" (type=${typeof dto.saveAsPending}) → isPending=${isPending} → newStatus=${isPending ? 'DOCUMENTACION_PENDIENTE' : 'DOCUMENTADO'}`,
    );

    // vehicleInvoice es obligatorio salvo que se guarde como pendiente
    if (!isPending && !files?.vehicleInvoice) {
      throw new BadRequestException(
        'La factura del vehículo (vehicleInvoice) es obligatoria para completar la documentación.',
      );
    }

    const uploadAndSign = async (file: Express.Multer.File, path: string) => {
      try {
        await this.firebase.uploadBuffer(file.buffer, path, file.mimetype);
        return this.firebase.getSignedUrl(path);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error subiendo archivo a Storage [${path}]: ${msg}`);
        throw new InternalServerErrorException(
          `Error al subir archivo a Storage: ${msg}`,
        );
      }
    };

    const basePath = `vehicles/${vehicleId}/docs`;

    // Factura de vehículo (singular)
    const vehicleInvoiceUrl = files?.vehicleInvoice
      ? await uploadAndSign(
          files.vehicleInvoice,
          `${basePath}/vehicle-invoice.pdf`,
        )
      : null;

    // Gift emails (hasta 5)
    const giftEmailUrls: string[] = [];
    for (let i = 0; i < (files?.giftEmails?.length ?? 0); i++) {
      const url = await uploadAndSign(
        files!.giftEmails[i],
        `${basePath}/gift-email-${i}.pdf`,
      );
      giftEmailUrls.push(url);
    }

    // Facturas de accesorios (hasta 5)
    const accessoryInvoiceUrls: string[] = [];
    for (let i = 0; i < (files?.accessoryInvoices?.length ?? 0); i++) {
      const url = await uploadAndSign(
        files!.accessoryInvoices[i],
        `${basePath}/accessory-invoice-${i}.pdf`,
      );
      accessoryInvoiceUrls.push(url);
    }

    // Si todos los accesorios son NO_APLICA, el vehículo pasa directo a LISTO_PARA_ENTREGA
    const accessoriesList = Array.isArray(dto.accessories)
      ? dto.accessories
      : [];

    // Punto 1 (guard defensivo): al no ser pendiente, los accesorios deben llegar como array.
    // El @Transform del DTO ya debería haber rechazado JSON inválido, pero si llegara
    // un valor no-array aquí, preferimos error explícito a guardar accessories:[].
    if (!isPending && !Array.isArray(dto.accessories)) {
      throw new BadRequestException(
        'El campo "accessories" es obligatorio y debe ser un array JSON válido para completar la documentación.',
      );
    }
    const allAccessoriesNoAplica =
      !isPending &&
      accessoriesList.length > 0 &&
      accessoriesList.every(
        (a) => a.classification === AccessoryClassification.NO_APLICA,
      );

    const now = this.firebase.serverTimestamp();
    const newStatus = isPending
      ? VehicleStatus.DOCUMENTACION_PENDIENTE
      : allAccessoriesNoAplica
        ? VehicleStatus.LISTO_PARA_ENTREGA
        : VehicleStatus.DOCUMENTADO;

    const docData = {
      vehicleId,
      clientName: dto.clientName,
      clientId: dto.clientId,
      clientPhone: dto.clientPhone,
      registrationType: dto.registrationType,
      paymentMethod: dto.paymentMethod,
      vehicleInvoiceUrl,
      giftEmailUrls,
      accessoryInvoiceUrls,
      // Retrocompat: primer elemento (o null)
      giftEmailUrl: giftEmailUrls[0] ?? null,
      accessoryInvoiceUrl: accessoryInvoiceUrls[0] ?? null,
      accessories: Array.isArray(dto.accessories)
        ? JSON.parse(JSON.stringify(dto.accessories))
        : [],
      registrationReceivedDate: dto.registrationReceivedDate ?? null,
      documentationStatus: isPending ? 'PENDIENTE' : 'COMPLETO',
      documentedAt: isPending ? null : now,
      documentedBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('documentations').doc(vehicleId).set(docData);

    await this.vehiclesService.changeStatus(vehicleId, newStatus, user, {
      notes: isPending
        ? `Documentación guardada como pendiente por ${user.displayName ?? user.email} — Cliente: ${dto.clientName} (${dto.clientId})`
        : `Vehículo documentado por ${user.displayName ?? user.email} — Cliente: ${dto.clientName} (${dto.clientId}), Pago: ${dto.paymentMethod}`,
      extraFields: {
        documentationDate: isPending ? null : now,
        documentedBy: user.uid,
        clientId: dto.clientId,
      },
    });

    if (!isPending) {
      if (allAccessoriesNoAplica) {
        // Todos los accesorios son NO_APLICA → directo a LISTO_PARA_ENTREGA
        await Promise.all([
          this.notificationsService.notify({
            type: 'ESTADO_CAMBIADO',
            targetRole: RoleEnum.ASESOR,
            targetSede: vehicle['sede'],
            title: '🚗 Vehículo listo para entrega',
            body: `El vehículo ${vehicle['chassis']} fue documentado y está listo para entrega (sin accesorios pendientes)`,
            vehicleId,
            chassis: vehicle['chassis'] as string,
          }),
          this.notificationsService.notify({
            type: 'ESTADO_CAMBIADO',
            targetRole: RoleEnum.LIDER_TECNICO,
            targetSede: vehicle['sede'],
            title: '🚗 Vehículo listo para entrega',
            body: `El vehículo ${vehicle['chassis']} fue documentado y está listo para entrega (sin accesorios pendientes)`,
            vehicleId,
            chassis: vehicle['chassis'] as string,
          }),
        ]);
      } else {
        // Tiene accesorios → notificar que está listo para accesorizar
        await Promise.all([
          this.notificationsService.notify({
            type: 'ESTADO_CAMBIADO',
            targetRole: RoleEnum.ASESOR,
            targetSede: vehicle['sede'],
            title: '📄 Vehículo documentado y listo para accesorizar',
            body: `El vehículo ${vehicle['chassis']} ha sido documentado`,
            vehicleId,
            chassis: vehicle['chassis'] as string,
          }),
          this.notificationsService.notify({
            type: 'ESTADO_CAMBIADO',
            targetRole: RoleEnum.LIDER_TECNICO,
            targetSede: vehicle['sede'],
            title: '📄 Vehículo documentado y listo para accesorizar',
            body: `El vehículo ${vehicle['chassis']} ha sido documentado`,
            vehicleId,
            chassis: vehicle['chassis'] as string,
          }),
        ]);
      }
    } else {
      // Notificar a JEFE_TALLER que hay una documentación pendiente
      await this.notificationsService.notify({
        type: 'DOCUMENTACION_PENDIENTE',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: vehicle['sede'],
        title: '⚠️ Documentación incompleta',
        body: `El vehículo ${vehicle['chassis']} tiene documentación pendiente de completar`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      });
    }

    this.logger.log(
      `Documentación ${isPending ? 'pendiente' : 'completada'} para vehículo ${vehicleId}`,
    );

    return {
      vehicleId,
      newStatus,
      documentationDate: isPending ? null : new Date().toISOString(),
    };
  }

  /**
   * Transición POR_ARRIBAR → ENVIADO_A_MATRICULAR.
   * Guarda la fecha de envío a matriculación en el vehículo.
   */
  async sendToRegistration(
    vehicleId: string,
    registrationSentDate: string,
    user: AuthenticatedUser,
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    if (vehicle['status'] !== VehicleStatus.POR_ARRIBAR) {
      throw new BadRequestException(
        `El vehículo debe estar en POR_ARRIBAR para enviar a matricular. Estado actual: ${vehicle['status']}`,
      );
    }

    await this.vehiclesService.changeStatus(
      vehicleId,
      VehicleStatus.ENVIADO_A_MATRICULAR,
      user,
      {
        notes: `Enviado a matricular por ${user.displayName ?? user.email}`,
        extraFields: { registrationSentDate },
      },
    );

    await this.notificationsService.notify({
      type: 'ESTADO_CAMBIADO',
      targetRole: RoleEnum.DOCUMENTACION,
      targetSede: vehicle['sede'],
      title: '📋 Vehículo enviado a matricular',
      body: `El vehículo ${vehicle['chassis']} fue enviado a matriculación`,
      vehicleId,
      chassis: vehicle['chassis'] as string,
    });

    this.logger.log(
      `Vehículo ${vehicleId} enviado a matricular por ${user.uid}`,
    );
    return {
      vehicleId,
      newStatus: VehicleStatus.ENVIADO_A_MATRICULAR,
      registrationSentDate,
    };
  }

  /**
   * Registra la fecha de recepción de matrícula en el vehículo.
   * No cambia el estado — el vehículo permanece en ENVIADO_A_MATRICULAR.
   */
  async receiveRegistration(
    vehicleId: string,
    registrationReceivedDate: string,
    user: AuthenticatedUser,
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const allowedForRegistration = [
      VehicleStatus.ENVIADO_A_MATRICULAR,
      VehicleStatus.DOCUMENTACION_PENDIENTE,
      VehicleStatus.DOCUMENTADO,
      VehicleStatus.CERTIFICADO_STOCK,
      VehicleStatus.ORDEN_GENERADA,
      VehicleStatus.ASIGNADO,
      VehicleStatus.EN_INSTALACION,
      VehicleStatus.INSTALACION_COMPLETA,
      VehicleStatus.LISTO_PARA_ENTREGA,
    ];
    if (!allowedForRegistration.includes(vehicle['status'] as VehicleStatus)) {
      throw new BadRequestException(
        `No se puede registrar recepción de matrícula en estado ${vehicle['status']}. Permitido desde ENVIADO_A_MATRICULAR hasta LISTO_PARA_ENTREGA.`,
      );
    }

    await this.db.collection('vehicles').doc(vehicleId).update({
      registrationReceivedDate,
      updatedAt: this.firebase.serverTimestamp(),
    });

    const currentStatus = vehicle['status'] as VehicleStatus;

    // Registrar en historial (mismo estado, evento auditable)
    await this.vehiclesService.addStatusHistory(
      vehicleId,
      currentStatus,
      currentStatus,
      user,
      vehicle['sede'],
      `Matrícula recibida el ${registrationReceivedDate} por ${user.displayName ?? user.email}`,
    );

    // Notificar a DOCUMENTACION que la matrícula llegó
    await this.notificationsService.notify({
      type: 'MATRICULA_RECIBIDA',
      targetRole: RoleEnum.DOCUMENTACION,
      targetSede: vehicle['sede'],
      title: '📋 Matrícula recibida',
      body: `La matrícula del vehículo ${vehicle['chassis']} fue recibida el ${registrationReceivedDate}`,
      vehicleId,
      chassis: vehicle['chassis'] as string,
    });

    this.logger.log(
      `Matrícula recibida para vehículo ${vehicleId} por ${user.uid}`,
    );
    return { vehicleId, registrationReceivedDate };
  }

  async findOne(vehicleId: string) {
    const doc = await this.db.collection('documentations').doc(vehicleId).get();
    if (!doc.exists) throw new NotFoundException('Documentación no encontrada');

    const data = doc.data()!;
    const basePath = `vehicles/${vehicleId}/docs`;

    // Regenerar todas las signed URLs en paralelo (antes: en serie con await)
    const giftEmailUrls: string[] = data['giftEmailUrls'] ?? [];
    const accessoryInvoiceUrls: string[] = data['accessoryInvoiceUrls'] ?? [];

    const [
      freshVehicleInvoice,
      freshGiftEmails,
      freshGiftEmailLegacy,
      freshAccessoryInvoices,
      freshAccessoryInvoiceLegacy,
    ] = await Promise.all([
      // factura del vehículo
      data['vehicleInvoiceUrl']
        ? this.firebase
            .getSignedUrl(`${basePath}/vehicle-invoice.pdf`)
            .catch(() => data['vehicleInvoiceUrl'] as string)
        : Promise.resolve(null as string | null),

      // gift emails (array)
      giftEmailUrls.length > 0
        ? Promise.all(
            giftEmailUrls.map((fallback, i) =>
              this.firebase
                .getSignedUrl(`${basePath}/gift-email-${i}.pdf`)
                .catch(() => fallback),
            ),
          )
        : Promise.resolve([] as string[]),

      // gift email legacy (singular)
      giftEmailUrls.length === 0 && data['giftEmailUrl']
        ? this.firebase
            .getSignedUrl(`${basePath}/gift-email.pdf`)
            .catch(() => data['giftEmailUrl'] as string)
        : Promise.resolve(null as string | null),

      // accessory invoices (array)
      accessoryInvoiceUrls.length > 0
        ? Promise.all(
            accessoryInvoiceUrls.map((fallback, i) =>
              this.firebase
                .getSignedUrl(`${basePath}/accessory-invoice-${i}.pdf`)
                .catch(() => fallback),
            ),
          )
        : Promise.resolve([] as string[]),

      // accessory invoice legacy (singular)
      accessoryInvoiceUrls.length === 0 && data['accessoryInvoiceUrl']
        ? this.firebase
            .getSignedUrl(`${basePath}/accessory-invoice.pdf`)
            .catch(() => data['accessoryInvoiceUrl'] as string)
        : Promise.resolve(null as string | null),
    ]);

    if (freshVehicleInvoice !== null)
      data['vehicleInvoiceUrl'] = freshVehicleInvoice;

    if (freshGiftEmails.length > 0) {
      data['giftEmailUrls'] = freshGiftEmails;
      data['giftEmailUrl'] = freshGiftEmails[0] ?? null;
    } else if (freshGiftEmailLegacy !== null) {
      data['giftEmailUrl'] = freshGiftEmailLegacy;
    }

    if (freshAccessoryInvoices.length > 0) {
      data['accessoryInvoiceUrls'] = freshAccessoryInvoices;
      data['accessoryInvoiceUrl'] = freshAccessoryInvoices[0] ?? null;
    } else if (freshAccessoryInvoiceLegacy !== null) {
      data['accessoryInvoiceUrl'] = freshAccessoryInvoiceLegacy;
    }

    return data;
  }

  async update(
    vehicleId: string,
    dto: UpdateDocumentationDto,
    user: AuthenticatedUser,
    files?: {
      vehicleInvoice?: Express.Multer.File;
      giftEmails: Express.Multer.File[];
      accessoryInvoices: Express.Multer.File[];
    },
  ) {
    const docSnap = await this.db
      .collection('documentations')
      .doc(vehicleId)
      .get();
    if (!docSnap.exists)
      throw new NotFoundException('Documentación no encontrada');

    const vehicle = await this.vehiclesService.assertExists(vehicleId);
    const existingData = docSnap.data()!;

    const { saveAsPending, accessories, ...restDto } = dto;
    const isReopening = !!vehicle['isReopening'];
    const isCompleting =
      vehicle['status'] === VehicleStatus.DOCUMENTACION_PENDIENTE &&
      // Flujo normal: requiere saveAsPending=false explícito
      // Flujo reapertura: auto-completa a menos que explícitamente saveAsPending=true
      (saveAsPending === false || (isReopening && saveAsPending !== true));

    // Punto 1: al completar una documentación pendiente, los accesorios son obligatorios.
    // Sin esta validación, un PATCH sin `accessories` deja el campo vacío en Firestore
    // y la OT se crea sin accesorios, sin ningún error visible.
    if (isCompleting && !isReopening && !Array.isArray(accessories)) {
      throw new BadRequestException(
        'El campo "accessories" es obligatorio al completar una documentación pendiente (saveAsPending=false).',
      );
    }

    const now = this.firebase.serverTimestamp();
    const updates: Record<string, unknown> = {
      ...restDto,
      ...(accessories !== undefined && {
        accessories: Array.isArray(accessories)
          ? JSON.parse(JSON.stringify(accessories))
          : [],
      }),
      updatedAt: now,
    };

    // Si se está completando la documentación pendiente, marcar como COMPLETO
    if (isCompleting) {
      updates['documentationStatus'] = 'COMPLETO';
      updates['documentedAt'] = now;
      updates['documentedBy'] = user.uid;
    }

    const basePath = `vehicles/${vehicleId}/docs`;
    const uploadAndSign = async (file: Express.Multer.File, path: string) => {
      await this.firebase.deleteFile(path);
      await this.firebase.uploadBuffer(file.buffer, path, file.mimetype);
      return this.firebase.getSignedUrl(path);
    };

    const updatedFiles: string[] = [];

    // Factura de vehículo (singular)
    if (files?.vehicleInvoice) {
      const url = await uploadAndSign(
        files.vehicleInvoice,
        `${basePath}/vehicle-invoice.pdf`,
      );
      updates['vehicleInvoiceUrl'] = url;
      updatedFiles.push('Factura vehículo');
    }

    // Gift emails (reemplaza todo el array anterior)
    if (files?.giftEmails && files.giftEmails.length > 0) {
      // Borrar archivos anteriores
      const oldUrls: string[] = existingData['giftEmailUrls'] ?? [];
      for (let i = 0; i < oldUrls.length; i++) {
        await this.firebase
          .deleteFile(`${basePath}/gift-email-${i}.pdf`)
          .catch(() => {});
      }
      // También borrar el legacy singular
      if (existingData['giftEmailUrl'] && oldUrls.length === 0) {
        await this.firebase
          .deleteFile(`${basePath}/gift-email.pdf`)
          .catch(() => {});
      }
      // Subir nuevos
      const giftEmailUrls: string[] = [];
      for (let i = 0; i < files.giftEmails.length; i++) {
        const url = await uploadAndSign(
          files.giftEmails[i],
          `${basePath}/gift-email-${i}.pdf`,
        );
        giftEmailUrls.push(url);
      }
      updates['giftEmailUrls'] = giftEmailUrls;
      updates['giftEmailUrl'] = giftEmailUrls[0] ?? null;
      updatedFiles.push('Email(s) regalo');
    }

    // Facturas de accesorios (reemplaza todo el array anterior)
    if (files?.accessoryInvoices && files.accessoryInvoices.length > 0) {
      const oldUrls: string[] = existingData['accessoryInvoiceUrls'] ?? [];
      for (let i = 0; i < oldUrls.length; i++) {
        await this.firebase
          .deleteFile(`${basePath}/accessory-invoice-${i}.pdf`)
          .catch(() => {});
      }
      if (existingData['accessoryInvoiceUrl'] && oldUrls.length === 0) {
        await this.firebase
          .deleteFile(`${basePath}/accessory-invoice.pdf`)
          .catch(() => {});
      }
      const accessoryInvoiceUrls: string[] = [];
      for (let i = 0; i < files.accessoryInvoices.length; i++) {
        const url = await uploadAndSign(
          files.accessoryInvoices[i],
          `${basePath}/accessory-invoice-${i}.pdf`,
        );
        accessoryInvoiceUrls.push(url);
      }
      updates['accessoryInvoiceUrls'] = accessoryInvoiceUrls;
      updates['accessoryInvoiceUrl'] = accessoryInvoiceUrls[0] ?? null;
      updatedFiles.push('Factura(s) accesorios');
    }

    await this.db.collection('documentations').doc(vehicleId).update(updates);

    if (isCompleting && isReopening) {
      // ── REAPERTURA: Completar documentación → ASIGNADO (la OT ya existe) ──
      const reopenAccessories: string[] = vehicle['reopenAccessories'] ?? [];
      const reopenReason: string = vehicle['reopenReason'] ?? '';
      const reopenBy: string = vehicle['reopenRequestedByName'] ?? '';

      // Buscar la OT existente del vehículo y agregar los nuevos accesorios al checklist
      const orderSnap = await this.db
        .collection('service-orders')
        .where('vehicleId', '==', vehicleId)
        .get();

      const sortedOrders = orderSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            ((b as any)['createdAt']?._seconds ?? 0) -
            ((a as any)['createdAt']?._seconds ?? 0),
        );

      if (sortedOrders.length > 0) {
        const currentOrder = sortedOrders[0] as Record<string, unknown>;
        const existingChecklist: Array<{ key: string; installed: boolean }> =
          Array.isArray(currentOrder['checklist'])
            ? (currentOrder['checklist'] as any)
            : [];
        const existingAccessories: Array<{
          key: string;
          classification: string;
        }> = Array.isArray(currentOrder['accessories'])
          ? (currentOrder['accessories'] as any)
          : [];
        const existingKeys = new Set(existingChecklist.map((c) => c.key));

        // Agregar solo los accesorios nuevos que no estaban ya en la OT
        const newChecklistItems = reopenAccessories
          .filter((key) => !existingKeys.has(key))
          .map((key) => ({ key, installed: false }));
        const newAccessoryItems = reopenAccessories
          .filter((key) => !existingKeys.has(key))
          .map((key) => ({ key, classification: 'VENDIDO' }));

        await this.db
          .collection('service-orders')
          .doc(currentOrder['id'] as string)
          .update({
            checklist: [...existingChecklist, ...newChecklistItems],
            accessories: [...existingAccessories, ...newAccessoryItems],
            status: 'ASIGNADA',
            updatedAt: now,
          });
      }

      // Limpiar flags de reapertura del vehículo
      await this.db.collection('vehicles').doc(vehicleId).update({
        isReopening: false,
        reopenReason: null,
        reopenAccessories: null,
        reopenRequestedBy: null,
        reopenRequestedByName: null,
        reopenRequestedAt: null,
      });

      const accessoryLabels = reopenAccessories.join(', ');
      await this.vehiclesService.changeStatus(
        vehicleId,
        VehicleStatus.ASIGNADO,
        user,
        {
          notes: `Reapertura completada por ${user.displayName ?? user.email}. Accesorios agregados: ${accessoryLabels}. Motivo original: ${reopenReason} (solicitado por ${reopenBy})${updatedFiles.length ? '. Archivos: ' + updatedFiles.join(', ') : ''}`,
        },
      );

      // Notificar al líder técnico y personal de taller que la OT fue actualizada
      await Promise.all([
        this.notificationsService.notify({
          type: 'REAPERTURA_COMPLETADA',
          targetRole: RoleEnum.LIDER_TECNICO,
          targetSede: vehicle['sede'],
          title: '🔄 Reapertura completada — OT actualizada',
          body: `${vehicle['chassis']}: se agregaron accesorios (${accessoryLabels}). Motivo: ${reopenReason}`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
        this.notificationsService.notify({
          type: 'REAPERTURA_COMPLETADA',
          targetRole: RoleEnum.PERSONAL_TALLER,
          targetSede: vehicle['sede'],
          title: '🔄 Reapertura completada — Nuevos accesorios por instalar',
          body: `${vehicle['chassis']}: nuevos accesorios agregados (${accessoryLabels}). Revisa tu checklist.`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
        this.notificationsService.notify({
          type: 'REAPERTURA_COMPLETADA',
          targetRole: RoleEnum.JEFE_TALLER,
          targetSede: 'ALL',
          title: '🔄 Reapertura completada',
          body: `${vehicle['chassis']}: reapertura resuelta. Accesorios: ${accessoryLabels}`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
      ]);

      this.logger.log(
        `Reapertura COMPLETADA para vehículo ${vehicleId} por ${user.uid}`,
      );
      return {
        vehicleId,
        updated: true,
        newStatus: VehicleStatus.ASIGNADO,
        isReopening: true,
        addedAccessories: reopenAccessories,
      };
    }

    if (isCompleting) {
      // Transición real de estado: DOCUMENTACION_PENDIENTE → DOCUMENTADO
      // changeStatus escribe internamente el statusHistory con el cambio de estado
      await this.vehiclesService.changeStatus(
        vehicleId,
        VehicleStatus.DOCUMENTADO,
        user,
        {
          notes: `Documentación completada por ${user.displayName ?? user.email}${updatedFiles.length ? '. Archivos: ' + updatedFiles.join(', ') : ''}`,
          extraFields: {
            documentationDate: now,
            documentedBy: user.uid,
          },
        },
      );

      // Notificar a ASESOR y LIDER_TECNICO: vehículo listo para accesorizar
      await Promise.all([
        this.notificationsService.notify({
          type: 'ESTADO_CAMBIADO',
          targetRole: RoleEnum.ASESOR,
          targetSede: vehicle['sede'],
          title: '📄 Vehículo documentado y listo para accesorizar',
          body: `El vehículo ${vehicle['chassis']} ha completado su documentación`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
        this.notificationsService.notify({
          type: 'ESTADO_CAMBIADO',
          targetRole: RoleEnum.LIDER_TECNICO,
          targetSede: vehicle['sede'],
          title: '📄 Vehículo documentado y listo para accesorizar',
          body: `El vehículo ${vehicle['chassis']} ha completado su documentación`,
          vehicleId,
          chassis: vehicle['chassis'] as string,
        }),
      ]);

      this.logger.log(
        `Documentación COMPLETADA para vehículo ${vehicleId} por ${user.uid}`,
      );
      return { vehicleId, updated: true, newStatus: VehicleStatus.DOCUMENTADO };
    }

    // Actualización parcial sin cambio de estado — audit trail en statusHistory + notificación JEFE_TALLER
    const note = updatedFiles.length
      ? `Documentación actualizada por ${user.displayName ?? user.email}. Archivos reemplazados: ${updatedFiles.join(', ')}`
      : `Documentación actualizada por ${user.displayName ?? user.email}`;

    await Promise.all([
      this.vehiclesService.addStatusHistory(
        vehicleId,
        vehicle['status'] as any,
        vehicle['status'] as any,
        user,
        vehicle['sede'] as any,
        note,
      ),
      this.notificationsService.notify({
        type: 'DOCUMENTACION_ACTUALIZADA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: vehicle['sede'],
        title: '📄 Documentación actualizada',
        body: `Documentación del vehículo ${vehicle['chassis']} fue modificada por ${user.displayName ?? user.email}`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    this.logger.log(
      `Documentación actualizada para vehículo ${vehicleId} por ${user.uid}`,
    );
    return { vehicleId, updated: true };
  }

  async remove(vehicleId: string, user: AuthenticatedUser) {
    const docSnap = await this.db
      .collection('documentations')
      .doc(vehicleId)
      .get();
    if (!docSnap.exists)
      throw new NotFoundException('Documentación no encontrada');

    const data = docSnap.data()!;
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    // Eliminar sólo los PDFs que tienen URL almacenada (evitar conflictos en Storage)
    const basePath = `vehicles/${vehicleId}/docs`;
    const deleteJobs: Promise<void>[] = [];
    if (data['vehicleInvoiceUrl'])
      deleteJobs.push(
        this.firebase.deleteFile(`${basePath}/vehicle-invoice.pdf`),
      );

    // Gift emails: array o legacy singular
    const giftEmailUrls: string[] = data['giftEmailUrls'] ?? [];
    if (giftEmailUrls.length > 0) {
      for (let i = 0; i < giftEmailUrls.length; i++) {
        deleteJobs.push(
          this.firebase.deleteFile(`${basePath}/gift-email-${i}.pdf`),
        );
      }
    } else if (data['giftEmailUrl']) {
      deleteJobs.push(this.firebase.deleteFile(`${basePath}/gift-email.pdf`));
    }

    // Facturas de accesorios: array o legacy singular
    const accessoryInvoiceUrls: string[] = data['accessoryInvoiceUrls'] ?? [];
    if (accessoryInvoiceUrls.length > 0) {
      for (let i = 0; i < accessoryInvoiceUrls.length; i++) {
        deleteJobs.push(
          this.firebase.deleteFile(`${basePath}/accessory-invoice-${i}.pdf`),
        );
      }
    } else if (data['accessoryInvoiceUrl']) {
      deleteJobs.push(
        this.firebase.deleteFile(`${basePath}/accessory-invoice.pdf`),
      );
    }
    await Promise.all(deleteJobs);

    await this.db.collection('documentations').doc(vehicleId).delete();

    // Registrar en historial y notificar a JEFE_TALLER
    await Promise.all([
      this.vehiclesService.addStatusHistory(
        vehicleId,
        vehicle['status'] as any,
        vehicle['status'] as any,
        user,
        vehicle['sede'] as any,
        `Documentación eliminada por ${user.displayName ?? user.email}`,
      ),
      this.notificationsService.notify({
        type: 'DOCUMENTACION_ELIMINADA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: vehicle['sede'],
        title: '🗑️ Documentación eliminada',
        body: `La documentación del vehículo ${vehicle['chassis']} fue eliminada por ${user.displayName ?? user.email}`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    this.logger.log(
      `Documentación eliminada para vehículo ${vehicleId} por ${user.uid}`,
    );
    return { vehicleId, deleted: true };
  }

  /** Elimina un PDF específico de Storage y limpia su URL en Firestore */
  async removeFile(
    vehicleId: string,
    fileType: 'vehicleInvoice' | 'giftEmail' | 'accessoryInvoice',
    user: AuthenticatedUser,
    index?: number,
  ) {
    const docSnap = await this.db
      .collection('documentations')
      .doc(vehicleId)
      .get();
    if (!docSnap.exists)
      throw new NotFoundException('Documentación no encontrada');

    const vehicle = await this.vehiclesService.assertExists(vehicleId);
    const data = docSnap.data()!;
    const basePath = `vehicles/${vehicleId}/docs`;
    let label: string;

    if (fileType === 'vehicleInvoice') {
      label = 'Factura vehículo';
      await this.firebase.deleteFile(`${basePath}/vehicle-invoice.pdf`);
      await this.db.collection('documentations').doc(vehicleId).update({
        vehicleInvoiceUrl: null,
        updatedAt: this.firebase.serverTimestamp(),
      });
    } else if (fileType === 'giftEmail') {
      label = 'Email regalo';
      const urls: string[] = data['giftEmailUrls'] ?? [];
      if (urls.length > 0 && index !== undefined) {
        // Eliminar un archivo específico del array
        if (index < 0 || index >= urls.length) {
          throw new BadRequestException(
            `Índice ${index} fuera de rango (0..${urls.length - 1})`,
          );
        }
        await this.firebase.deleteFile(`${basePath}/gift-email-${index}.pdf`);
        urls.splice(index, 1);
        // Re-indexar archivos restantes en Storage
        for (let i = index; i < urls.length; i++) {
          // Mover gift-email-(i+1).pdf → gift-email-i.pdf
          // Como Firebase Storage no soporta rename, re-upload no es práctico.
          // Solo limpiamos la referencia; los paths en Storage quedan con gaps pero las URLs son absolutas.
        }
        await this.db
          .collection('documentations')
          .doc(vehicleId)
          .update({
            giftEmailUrls: urls,
            giftEmailUrl: urls[0] ?? null,
            updatedAt: this.firebase.serverTimestamp(),
          });
        label = `Email regalo [${index}]`;
      } else {
        // Eliminar todos (legacy o sin index)
        if (urls.length > 0) {
          for (let i = 0; i < urls.length; i++) {
            await this.firebase
              .deleteFile(`${basePath}/gift-email-${i}.pdf`)
              .catch(() => {});
          }
        } else {
          await this.firebase
            .deleteFile(`${basePath}/gift-email.pdf`)
            .catch(() => {});
        }
        await this.db.collection('documentations').doc(vehicleId).update({
          giftEmailUrls: [],
          giftEmailUrl: null,
          updatedAt: this.firebase.serverTimestamp(),
        });
        label = 'Todos los emails regalo';
      }
    } else if (fileType === 'accessoryInvoice') {
      label = 'Factura accesorios';
      const urls: string[] = data['accessoryInvoiceUrls'] ?? [];
      if (urls.length > 0 && index !== undefined) {
        if (index < 0 || index >= urls.length) {
          throw new BadRequestException(
            `Índice ${index} fuera de rango (0..${urls.length - 1})`,
          );
        }
        await this.firebase.deleteFile(
          `${basePath}/accessory-invoice-${index}.pdf`,
        );
        urls.splice(index, 1);
        await this.db
          .collection('documentations')
          .doc(vehicleId)
          .update({
            accessoryInvoiceUrls: urls,
            accessoryInvoiceUrl: urls[0] ?? null,
            updatedAt: this.firebase.serverTimestamp(),
          });
        label = `Factura accesorios [${index}]`;
      } else {
        if (urls.length > 0) {
          for (let i = 0; i < urls.length; i++) {
            await this.firebase
              .deleteFile(`${basePath}/accessory-invoice-${i}.pdf`)
              .catch(() => {});
          }
        } else {
          await this.firebase
            .deleteFile(`${basePath}/accessory-invoice.pdf`)
            .catch(() => {});
        }
        await this.db.collection('documentations').doc(vehicleId).update({
          accessoryInvoiceUrls: [],
          accessoryInvoiceUrl: null,
          updatedAt: this.firebase.serverTimestamp(),
        });
        label = 'Todas las facturas accesorios';
      }
    } else {
      throw new BadRequestException(`Tipo de archivo inválido: ${fileType}`);
    }

    const note = `Archivo "${label}" eliminado por ${user.displayName ?? user.email}`;
    await Promise.all([
      this.vehiclesService.addStatusHistory(
        vehicleId,
        vehicle['status'] as any,
        vehicle['status'] as any,
        user,
        vehicle['sede'] as any,
        note,
      ),
      this.notificationsService.notify({
        type: 'DOCUMENTACION_ACTUALIZADA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: vehicle['sede'],
        title: '📄 Archivo de documentación eliminado',
        body: `${note} — vehículo ${vehicle['chassis']}`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    this.logger.log(
      `Archivo ${fileType}${index !== undefined ? `[${index}]` : ''} eliminado para vehículo ${vehicleId} por ${user.uid}`,
    );
    return { vehicleId, fileType, index: index ?? null, deleted: true };
  }

  /**
   * Revierte un vehículo a estado POR_ARRIBAR por cancelación de compra.
   * Elimina la documentación de Firestore, borra PDFs de Storage y
   * limpia los campos de cliente en el vehículo.
   */
  async revertToPorArribar(
    vehicleId: string,
    dto: { reason: string },
    user: AuthenticatedUser,
  ) {
    // 1. Verificar que el vehículo existe
    const vehicle = await this.vehiclesService.assertExists(vehicleId);
    const previousStatus = vehicle['status'] as VehicleStatus;

    // 2. Bloquear estados finales irreversibles
    const blockedStatuses = [VehicleStatus.ENTREGADO, VehicleStatus.CEDIDO];
    if (blockedStatuses.includes(previousStatus)) {
      throw new BadRequestException(
        `No se puede revertir un vehículo en estado ${previousStatus}. Estado final irreversible.`,
      );
    }

    // 3. Cargar documento de documentación (si existe)
    const docSnap = await this.db
      .collection('documentations')
      .doc(vehicleId)
      .get();

    // 4 & 5. Eliminar PDFs de Storage y documento de Firestore (solo si existe)
    if (docSnap.exists) {
      const data = docSnap.data()!;
      const basePath = `vehicles/${vehicleId}/docs`;
      const deleteJobs: Promise<void>[] = [];

      if (data['vehicleInvoiceUrl']) {
        deleteJobs.push(
          this.firebase
            .deleteFile(`${basePath}/vehicle-invoice.pdf`)
            .catch(() => {}),
        );
      }

      const giftEmailUrls: string[] = data['giftEmailUrls'] ?? [];
      if (giftEmailUrls.length > 0) {
        for (let i = 0; i < giftEmailUrls.length; i++) {
          deleteJobs.push(
            this.firebase
              .deleteFile(`${basePath}/gift-email-${i}.pdf`)
              .catch(() => {}),
          );
        }
      } else if (data['giftEmailUrl']) {
        deleteJobs.push(
          this.firebase
            .deleteFile(`${basePath}/gift-email.pdf`)
            .catch(() => {}),
        );
      }

      const accessoryInvoiceUrls: string[] = data['accessoryInvoiceUrls'] ?? [];
      if (accessoryInvoiceUrls.length > 0) {
        for (let i = 0; i < accessoryInvoiceUrls.length; i++) {
          deleteJobs.push(
            this.firebase
              .deleteFile(`${basePath}/accessory-invoice-${i}.pdf`)
              .catch(() => {}),
          );
        }
      } else if (data['accessoryInvoiceUrl']) {
        deleteJobs.push(
          this.firebase
            .deleteFile(`${basePath}/accessory-invoice.pdf`)
            .catch(() => {}),
        );
      }

      await Promise.all(deleteJobs);
      await this.db.collection('documentations').doc(vehicleId).delete();
    }

    // 6. Cambiar estado a POR_ARRIBAR y limpiar campos de cliente
    await this.vehiclesService.changeStatus(
      vehicleId,
      VehicleStatus.POR_ARRIBAR,
      user,
      {
        notes: `Reversión a POR_ARRIBAR por ${user.displayName ?? user.email}. Motivo: ${dto.reason}`,
        extraFields: {
          clientId: null,
          documentationDate: null,
          documentedBy: null,
          registrationSentDate: null,
          registrationReceivedDate: null,
        },
      },
    );

    // 7. Notificar a JEFE_TALLER (global) y ASESOR (sede del vehículo)
    await Promise.all([
      this.notificationsService.notify({
        type: 'REVERSION_COMPRA',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '⚠️ Compra cancelada — vehículo revertido',
        body: `Vehículo ${vehicle['chassis']} revertido a POR_ARRIBAR. Motivo: ${dto.reason}`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'REVERSION_COMPRA',
        targetRole: RoleEnum.ASESOR,
        targetSede: vehicle['sede'],
        title: '⚠️ Compra cancelada — vehículo revertido',
        body: `Vehículo ${vehicle['chassis']} revertido a POR_ARRIBAR. Motivo: ${dto.reason}`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    this.logger.log(
      `Vehículo ${vehicleId} revertido a POR_ARRIBAR por ${user.uid}. Motivo: ${dto.reason}`,
    );
    return { vehicleId, newStatus: VehicleStatus.POR_ARRIBAR, previousStatus };
  }

  /**
   * Factura un vehículo en estado NO_FACTURADO, transicionándolo a POR_ARRIBAR
   * para que ingrese al flujo normal de matriculación.
   */
  async billVehicle(
    vehicleId: string,
    user: AuthenticatedUser,
  ): Promise<{ vehicleId: string; newStatus: VehicleStatus }> {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    if (vehicle['status'] !== VehicleStatus.NO_FACTURADO) {
      throw new BadRequestException(
        `El vehículo debe estar en estado NO_FACTURADO para facturar. Estado actual: ${vehicle['status']}`,
      );
    }

    await this.vehiclesService.changeStatus(
      vehicleId,
      VehicleStatus.POR_ARRIBAR,
      user,
      {
        notes: `Vehículo facturado por ${user.displayName ?? user.email} — ingresa al flujo normal de matriculación`,
        extraFields: {
          billedAt: this.firebase.serverTimestamp(),
          billedBy: user.uid,
        },
      },
    );

    await this.notificationsService.notify({
      type: 'ESTADO_CAMBIADO',
      targetRole: RoleEnum.DOCUMENTACION,
      targetSede: vehicle['sede'],
      title: '💳 Vehículo facturado',
      body: `El vehículo ${vehicle['chassis']} fue facturado y está listo para matriculación`,
      vehicleId,
      chassis: vehicle['chassis'] as string,
    });

    this.logger.log(
      `Vehículo ${vehicleId} facturado por ${user.uid} — transición NO_FACTURADO → POR_ARRIBAR`,
    );

    return { vehicleId, newStatus: VehicleStatus.POR_ARRIBAR };
  }

  async changeSede(
    vehicleId: string,
    newSede: string,
    user: AuthenticatedUser,
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    // Cambio de sede: NO modifica el status, solo actualiza la sede y registra en historial
    await this.vehiclesService.changeStatus(
      vehicleId,
      vehicle['status'] as VehicleStatus,
      user,
      {
        notes: `Cambio de sede: ${vehicle['sede']} → ${newSede} por ${user.displayName ?? user.email}`,
        extraFields: { sede: newSede },
      },
    );

    const notifBody = `Vehículo ${vehicle['chassis']} movido de ${vehicle['sede']} a ${newSede}`;
    await Promise.all([
      // JEFE_TALLER global (ambas sedes)
      this.notificationsService.notify({
        type: 'CAMBIO_SEDE',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: 'ALL',
        title: '🔄 Cambio de sede',
        body: notifBody,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      // Roles de la sede destino que deben saber que llega un vehículo
      this.notificationsService.notify({
        type: 'CAMBIO_SEDE',
        targetRole: RoleEnum.DOCUMENTACION,
        targetSede: newSede,
        title: '🔄 Vehículo entrante por cambio de sede',
        body: notifBody,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'CAMBIO_SEDE',
        targetRole: RoleEnum.ASESOR,
        targetSede: newSede,
        title: '🔄 Vehículo entrante por cambio de sede',
        body: notifBody,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
      this.notificationsService.notify({
        type: 'CAMBIO_SEDE',
        targetRole: RoleEnum.LIDER_TECNICO,
        targetSede: newSede,
        title: '🔄 Vehículo entrante por cambio de sede',
        body: notifBody,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      }),
    ]);

    this.logger.log(
      `Sede cambiada para vehículo ${vehicleId}: ${vehicle['sede']} → ${newSede} por ${user.uid}`,
    );
    return { vehicleId, previousSede: vehicle['sede'], newSede };
  }

  async transferConcessionaire(
    vehicleId: string,
    targetConcessionaire: string,
    user: AuthenticatedUser,
    transferFile?: Express.Multer.File,
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    let transferDocUrl: string | null = null;
    if (transferFile) {
      const path = `vehicles/${vehicleId}/transfer/concession-document.pdf`;
      await this.firebase.uploadBuffer(
        transferFile.buffer,
        path,
        transferFile.mimetype,
      );
      transferDocUrl = await this.firebase.getSignedUrl(path);
    }

    await this.vehiclesService.changeStatus(
      vehicleId,
      VehicleStatus.CEDIDO,
      user,
      {
        notes: `Cedido a ${targetConcessionaire} por ${user.displayName ?? user.email}`,
        extraFields: { targetConcessionaire, transferDocUrl },
      },
    );

    await this.notificationsService.notify({
      type: 'CEDIDO',
      targetRole: RoleEnum.JEFE_TALLER,
      targetSede: 'ALL',
      title: '🚗 Vehículo cedido',
      body: `Vehículo ${vehicle['chassis']} cedido a ${targetConcessionaire}`,
      vehicleId,
      chassis: vehicle['chassis'] as string,
    });

    return { vehicleId, newStatus: VehicleStatus.CEDIDO, targetConcessionaire };
  }
}
