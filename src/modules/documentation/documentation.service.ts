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
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
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
      giftEmail?: Express.Multer.File;
      accessoryInvoice?: Express.Multer.File;
    },
  ) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const allowedStatuses = [VehicleStatus.CERTIFICADO_STOCK, VehicleStatus.DOCUMENTACION_PENDIENTE];
    if (!allowedStatuses.includes(vehicle['status'] as VehicleStatus)) {
      throw new BadRequestException(
        `El vehículo debe estar certificado para documentar. Estado actual: ${vehicle['status']}`,
      );
    }

    const isPending = dto.saveAsPending === true;

    // vehicleInvoice es obligatorio salvo que se guarde como pendiente
    if (!isPending && !files?.vehicleInvoice) {
      throw new BadRequestException('La factura del vehículo (vehicleInvoice) es obligatoria para completar la documentación.');
    }

    const uploadAndSign = async (file: Express.Multer.File, path: string) => {
      try {
        await this.firebase.uploadBuffer(file.buffer, path, file.mimetype);
        return this.firebase.getSignedUrl(path);
      } catch (err: unknown) {
        // DEBUG TEMPORAL — ver en Render Logs el objeto completo del error de Google/Storage
        console.log('=== DETALLE DEL ERROR STORAGE ===');
        console.log(JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2));
        console.log('=================================');
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error subiendo archivo a Storage [${path}]: ${msg}`);
        throw new InternalServerErrorException(`Error al subir archivo a Storage: ${msg}`);
      }
    };

    const basePath = `vehicles/${vehicleId}/docs`;
    const [vehicleInvoiceUrl, giftEmailUrl, accessoryInvoiceUrl] = await Promise.all([
      files?.vehicleInvoice
        ? uploadAndSign(files.vehicleInvoice, `${basePath}/vehicle-invoice.pdf`)
        : Promise.resolve(null),
      files?.giftEmail
        ? uploadAndSign(files.giftEmail, `${basePath}/gift-email.pdf`)
        : Promise.resolve(null),
      files?.accessoryInvoice
        ? uploadAndSign(files.accessoryInvoice, `${basePath}/accessory-invoice.pdf`)
        : Promise.resolve(null),
    ]);

    const now = this.firebase.serverTimestamp();
    const newStatus = isPending
      ? VehicleStatus.DOCUMENTACION_PENDIENTE
      : VehicleStatus.DOCUMENTADO;

    const docData = {
      vehicleId,
      clientName: dto.clientName,
      clientId: dto.clientId,
      clientPhone: dto.clientPhone,
      registrationType: dto.registrationType,
      paymentMethod: dto.paymentMethod,
      vehicleInvoiceUrl,
      giftEmailUrl,
      accessoryInvoiceUrl,
      accessories: dto.accessories,
      documentationStatus: isPending ? 'PENDIENTE' : 'COMPLETO',
      documentedAt: isPending ? null : now,
      documentedBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('documentations').doc(vehicleId).set(docData);

    await this.vehiclesService.changeStatus(vehicleId, newStatus, user, {
      extraFields: {
        documentationDate: isPending ? null : now,
        documentedBy: user.uid,
        clientId: dto.clientId,
      },
    });

    if (!isPending) {
      // Notificar a ASESOR y LIDER_TECNICO que hay un vehículo listo para accesorizar
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

    this.logger.log(`Documentación ${isPending ? 'pendiente' : 'completada'} para vehículo ${vehicleId}`);

    return { vehicleId, newStatus, documentationDate: isPending ? null : new Date().toISOString() };
  }

  async findOne(vehicleId: string) {
    const doc = await this.db.collection('documentations').doc(vehicleId).get();
    if (!doc.exists) throw new NotFoundException('Documentación no encontrada');

    const data = doc.data()!;
    // Regenerar URLs firmadas frescas
    const paths: { key: string; path: string }[] = [
      { key: 'vehicleInvoiceUrl', path: `vehicles/${vehicleId}/docs/vehicle-invoice.pdf` },
      { key: 'giftEmailUrl', path: `vehicles/${vehicleId}/docs/gift-email.pdf` },
      { key: 'accessoryInvoiceUrl', path: `vehicles/${vehicleId}/docs/accessory-invoice.pdf` },
    ];

    for (const { key, path } of paths) {
      if (data[key]) {
        data[key] = await this.firebase.getSignedUrl(path).catch(() => data[key]);
      }
    }

    return data;
  }

  async update(
    vehicleId: string,
    dto: Partial<CreateDocumentationDto>,
    user: AuthenticatedUser,
    files?: {
      vehicleInvoice?: Express.Multer.File;
      giftEmail?: Express.Multer.File;
      accessoryInvoice?: Express.Multer.File;
    },
  ) {
    const docSnap = await this.db.collection('documentations').doc(vehicleId).get();
    if (!docSnap.exists) throw new NotFoundException('Documentación no encontrada');

    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    // saveAsPending es un flag de control — no se persiste directamente en el doc
    const { saveAsPending, ...restDto } = dto;
    const isCompleting =
      saveAsPending === false &&
      vehicle['status'] === VehicleStatus.DOCUMENTACION_PENDIENTE;

    const now = this.firebase.serverTimestamp();
    const updates: Record<string, unknown> = {
      ...restDto,
      updatedAt: now,
    };

    // Si se está completando la documentación pendiente, marcar como COMPLETO
    if (isCompleting) {
      updates['documentationStatus'] = 'COMPLETO';
      updates['documentedAt'] = now;
      updates['documentedBy'] = user.uid;
    }

    // Reemplazar PDFs específicos que se reciban — solo el archivo enviado
    const basePath = `vehicles/${vehicleId}/docs`;
    const uploadAndSign = async (file: Express.Multer.File, path: string) => {
      await this.firebase.deleteFile(path);
      await this.firebase.uploadBuffer(file.buffer, path, file.mimetype);
      return this.firebase.getSignedUrl(path);
    };

    const updatedFiles: string[] = [];

    await Promise.all([
      files?.vehicleInvoice
        ? uploadAndSign(files.vehicleInvoice, `${basePath}/vehicle-invoice.pdf`)
            .then((url) => { updates['vehicleInvoiceUrl'] = url; updatedFiles.push('Factura vehículo'); })
        : Promise.resolve(),
      files?.giftEmail
        ? uploadAndSign(files.giftEmail, `${basePath}/gift-email.pdf`)
            .then((url) => { updates['giftEmailUrl'] = url; updatedFiles.push('Email regalo'); })
        : Promise.resolve(),
      files?.accessoryInvoice
        ? uploadAndSign(files.accessoryInvoice, `${basePath}/accessory-invoice.pdf`)
            .then((url) => { updates['accessoryInvoiceUrl'] = url; updatedFiles.push('Factura accesorios'); })
        : Promise.resolve(),
    ]);

    await this.db.collection('documentations').doc(vehicleId).update(updates);

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

      this.logger.log(`Documentación COMPLETADA para vehículo ${vehicleId} por ${user.uid}`);
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

    this.logger.log(`Documentación actualizada para vehículo ${vehicleId} por ${user.uid}`);
    return { vehicleId, updated: true };
  }

  async remove(vehicleId: string, user: AuthenticatedUser) {
    const docSnap = await this.db.collection('documentations').doc(vehicleId).get();
    if (!docSnap.exists) throw new NotFoundException('Documentación no encontrada');

    const data = docSnap.data()!;
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    // Eliminar sólo los PDFs que tienen URL almacenada (evitar conflictos en Storage)
    const basePath = `vehicles/${vehicleId}/docs`;
    const deleteJobs: Promise<void>[] = [];
    if (data['vehicleInvoiceUrl']) deleteJobs.push(this.firebase.deleteFile(`${basePath}/vehicle-invoice.pdf`));
    if (data['giftEmailUrl'])      deleteJobs.push(this.firebase.deleteFile(`${basePath}/gift-email.pdf`));
    if (data['accessoryInvoiceUrl']) deleteJobs.push(this.firebase.deleteFile(`${basePath}/accessory-invoice.pdf`));
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

    this.logger.log(`Documentación eliminada para vehículo ${vehicleId} por ${user.uid}`);
    return { vehicleId, deleted: true };
  }

  /** Elimina un PDF específico de Storage y limpia su URL en Firestore */
  async removeFile(
    vehicleId: string,
    fileType: 'vehicleInvoice' | 'giftEmail' | 'accessoryInvoice',
    user: AuthenticatedUser,
  ) {
    const docSnap = await this.db.collection('documentations').doc(vehicleId).get();
    if (!docSnap.exists) throw new NotFoundException('Documentación no encontrada');

    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const fileMap: Record<string, { storagePath: string; urlField: string; label: string }> = {
      vehicleInvoice:  { storagePath: `vehicles/${vehicleId}/docs/vehicle-invoice.pdf`,  urlField: 'vehicleInvoiceUrl',  label: 'Factura vehículo' },
      giftEmail:       { storagePath: `vehicles/${vehicleId}/docs/gift-email.pdf`,        urlField: 'giftEmailUrl',       label: 'Email regalo' },
      accessoryInvoice:{ storagePath: `vehicles/${vehicleId}/docs/accessory-invoice.pdf`, urlField: 'accessoryInvoiceUrl',label: 'Factura accesorios' },
    };

    const target = fileMap[fileType];
    if (!target) throw new BadRequestException(`Tipo de archivo inválido: ${fileType}`);

    await this.firebase.deleteFile(target.storagePath);
    await this.db.collection('documentations').doc(vehicleId).update({
      [target.urlField]: null,
      updatedAt: this.firebase.serverTimestamp(),
    });

    const note = `Archivo "${target.label}" eliminado por ${user.displayName ?? user.email}`;
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

    this.logger.log(`Archivo ${fileType} eliminado para vehículo ${vehicleId} por ${user.uid}`);
    return { vehicleId, fileType, deleted: true };
  }

  async changeSede(vehicleId: string, newSede: string, user: AuthenticatedUser) {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    // Cambio de sede: NO modifica el status, solo actualiza la sede y registra en historial
    await this.vehiclesService.changeStatus(vehicleId, vehicle['status'] as VehicleStatus, user, {
      notes: `Cambio de sede: ${vehicle['sede']} → ${newSede}`,
      extraFields: { sede: newSede },
    });

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

    this.logger.log(`Sede cambiada para vehículo ${vehicleId}: ${vehicle['sede']} → ${newSede} por ${user.uid}`);
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
      await this.firebase.uploadBuffer(transferFile.buffer, path, transferFile.mimetype);
      transferDocUrl = await this.firebase.getSignedUrl(path);
    }

    await this.vehiclesService.changeStatus(vehicleId, VehicleStatus.CEDIDO, user, {
      notes: `Cedido a: ${targetConcessionaire}`,
      extraFields: { targetConcessionaire, transferDocUrl },
    });

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
