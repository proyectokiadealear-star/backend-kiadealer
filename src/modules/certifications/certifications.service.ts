import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CertificationDocument,
  CertificationsRepository,
} from './certifications.repository';
import { VehicleFieldsRepository } from './vehicle-fields.repository';
import {
  CreateCertificationDto,
  ImprintsStatus,
} from './dto/create-certification.dto';
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
    private readonly certifications: CertificationsRepository,
    private readonly vehicleFields: VehicleFieldsRepository,
  ) {}

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

    const currentStatus = vehicle['status'] as VehicleStatus;

    // Determinar si es un upsert (vehículo ya certificado — ej: proviene del seed).
    // El repositorio acota la búsqueda al tenant activo: una certificación de otro
    // concesionario con este mismo vehicleId (en la práctica, imposible — los ids
    // son UUID por vehículo) se ve como inexistente, nunca como ajena.
    const existing = await this.certifications.findById(vehicleId);

    // Estados que indican que el vehículo ya pasó la fase de certificación
    const postCertificationStatuses: VehicleStatus[] = [
      VehicleStatus.CERTIFICADO_STOCK,
      VehicleStatus.ORDEN_GENERADA,
      VehicleStatus.ASIGNADO,
      VehicleStatus.EN_INSTALACION,
      VehicleStatus.INSTALACION_COMPLETA,
      VehicleStatus.LISTO_PARA_ENTREGA,
      VehicleStatus.AGENDADO,
      VehicleStatus.ENTREGADO,
      VehicleStatus.REAPERTURA_OT,
      VehicleStatus.CEDIDO,
    ];

    // Ya tiene doc de certificación
    const certDocExists = existing !== null;
    // El estado ya está en una fase post-certificación
    const alreadyInPostCertStatus =
      postCertificationStatuses.includes(currentStatus);
    // isUpsert: cualquier combinación donde no sea un CREATE puro
    const isUpsert = certDocExists || alreadyInPostCertStatus;
    // ¿Necesita avanzar el estado? Solo si el doc existe pero el estado aún no avanzó
    const needsStatusAdvance = isUpsert && !alreadyInPostCertStatus;

    // Solo bloquear si el vehículo está en un estado no permitido para certificar
    const allowedStatuses = [
      VehicleStatus.DOCUMENTADO,
      VehicleStatus.NO_FACTURADO,
      VehicleStatus.POR_ARRIBAR,
      VehicleStatus.ENVIADO_A_MATRICULAR,
      VehicleStatus.DOCUMENTACION_PENDIENTE,
    ];
    if (!isUpsert && !allowedStatuses.includes(currentStatus)) {
      throw new BadRequestException(
        `El vehículo debe estar en estado POR_ARRIBAR, ENVIADO_A_MATRICULAR, DOCUMENTACION_PENDIENTE, DOCUMENTADO o NO_FACTURADO para certificar. Estado actual: ${currentStatus}`,
      );
    }
    const isNoFacturado =
      !isUpsert && currentStatus === VehicleStatus.NO_FACTURADO;

    const earlyStatuses = [
      VehicleStatus.POR_ARRIBAR,
      VehicleStatus.ENVIADO_A_MATRICULAR,
      VehicleStatus.DOCUMENTACION_PENDIENTE,
    ];
    const isEarlyState = !isUpsert && earlyStatuses.includes(currentStatus);

    let rimsPhotoUrl: string | null = null;
    let vehiclePhotoUrl: string | null = null;

    // Subir foto del vehículo si viene como archivo o base64
    if (files?.vehiclePhoto) {
      const vPhotoPath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.uploadBuffer(
        files.vehiclePhoto.buffer,
        vPhotoPath,
        files.vehiclePhoto.mimetype,
      );
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
      await this.firebase.uploadBuffer(
        files.rimsPhoto.buffer,
        storagePath,
        files.rimsPhoto.mimetype,
      );
      rimsPhotoUrl = await this.firebase.getSignedUrl(storagePath);
    }

    const now = this.firebase.serverTimestamp();

    if (isUpsert) {
      // ── UPSERT: actualizar certificación existente (seed o re-certificación) ──
      const prevRimsPhotoUrl = existing?.rims?.photoUrl ?? null;

      const certFields = {
        vehicleId,
        radio: dto.radio,
        rims: {
          status: dto.rimsStatus,
          photoUrl: rimsPhotoUrl ?? prevRimsPhotoUrl,
        },
        seatType: dto.seatType,
        antenna: dto.antenna,
        trunkCover: dto.trunkCover,
        mileage: dto.mileage,
        imprints: dto.imprints,
        notes: dto.notes ?? null,
        certifiedAt: existing?.certifiedAt ?? now,
        certifiedBy: existing?.certifiedBy ?? user.uid,
        updatedAt: now,
        updatedBy: user.uid,
      };

      if (certDocExists) {
        await this.certifications.update(vehicleId, certFields);
      } else {
        // isUpsert por estado post-certificación sin doc previo (ej: seed
        // que solo tocó el vehículo, no la certificación).
        await this.certifications.create(certFields, vehicleId);
      }

      if (needsStatusAdvance) {
        // El vehículo aún está en DOCUMENTADO (o similar) con doc del seed —
        // hay que avanzarlo a CERTIFICADO_STOCK igual que en el flujo normal
        await this.vehiclesService.changeStatus(
          vehicleId,
          VehicleStatus.CERTIFICADO_STOCK,
          user,
          {
            notes: `Certificado (re-patch) por ${user.displayName ?? user.email} — Km: ${dto.mileage}, Improntas: ${dto.imprints}`,
            extraFields: {
              certificationDate: now,
              certifiedBy: user.uid,
              originConcessionaire: dto.originConcessionaire,
              receptionDate: now,
              ...(vehiclePhotoUrl && { photoUrl: vehiclePhotoUrl }),
            },
          },
        );
      } else {
        // El estado ya es post-certificación — solo actualizar campos del vehículo
        const vehicleUpdates: Record<string, unknown> = {
          originConcessionaire: dto.originConcessionaire,
          ...(vehiclePhotoUrl && { photoUrl: vehiclePhotoUrl }),
        };
        await this.vehicleFields.updateFields(vehicleId, vehicleUpdates);

        // Registrar en historial como corrección
        await this.vehiclesService.addStatusHistory(
          vehicleId,
          currentStatus,
          currentStatus,
          user,
          vehicle['sede'],
          `Certificación actualizada (corrección/re-certificación) por ${user.displayName ?? user.email} — Km: ${dto.mileage}, Improntas: ${dto.imprints}`,
        );
      }

      const finalStatus = needsStatusAdvance
        ? VehicleStatus.CERTIFICADO_STOCK
        : currentStatus;

      this.logger.log(
        `Certificación actualizada (upsert) para vehículo ${vehicleId} — estado final: ${finalStatus}`,
      );

      return {
        vehicleId,
        upserted: true,
        newStatus: finalStatus,
        certificationDate: new Date().toISOString(),
      };
    }

    // ── CREATE: flujo normal (vehículo en DOCUMENTADO o NO_FACTURADO sin certificación previa) ──
    const certFields = {
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

    await this.certifications.create(certFields, vehicleId);

    if (isNoFacturado) {
      // ── Branch B: vehículo en NO_FACTURADO — NO cambiar status ──
      await this.vehicleFields.updateFields(vehicleId, {
        certifiedWhileNoFacturado: true,
        certificationDate: now,
        certifiedBy: user.uid,
        originConcessionaire: dto.originConcessionaire ?? null,
        ...(vehiclePhotoUrl && { photoUrl: vehiclePhotoUrl }),
      });

      await this.vehiclesService.addStatusHistory(
        vehicleId,
        VehicleStatus.NO_FACTURADO,
        VehicleStatus.NO_FACTURADO,
        user,
        vehicle['sede'],
        `Certificado físicamente (sin factura) por ${user.displayName ?? user.email} — Km: ${dto.mileage}`,
      );

      await this.notificationsService.notify({
        type: 'ESTADO_CAMBIADO',
        targetRole: RoleEnum.DOCUMENTACION,
        targetSede: vehicle['sede'],
        title: '⚠️ Vehículo certificado sin factura',
        body: `El vehículo ${vehicle['chassis']} fue certificado físicamente pero aún no tiene factura`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      });

      this.logger.log(
        `Certificación creada (NO_FACTURADO branch) para vehículo ${vehicleId}`,
      );

      return {
        vehicleId,
        upserted: false,
        newStatus: VehicleStatus.NO_FACTURADO,
        certifiedWhileNoFacturado: true,
        certificationDate: new Date().toISOString(),
      };
    }

    // ── Branch C: vehículo en estado temprano (POR_ARRIBAR/ENVIADO_A_MATRICULAR/DOCUMENTACION_PENDIENTE) — NO cambiar status ──
    if (isEarlyState) {
      // La certificación ya se persistió arriba (certFields) — no hace falta repetirlo.
      await this.vehicleFields.updateFields(vehicleId, {
        certifiedWhileEarlyState: true,
        certificationDate: now,
        certifiedBy: user.uid,
        originConcessionaire: dto.originConcessionaire ?? null,
        ...(vehiclePhotoUrl && { photoUrl: vehiclePhotoUrl }),
      });

      await this.vehiclesService.addStatusHistory(
        vehicleId,
        currentStatus,
        currentStatus,
        user,
        vehicle['sede'],
        `Certificado físicamente (estado temprano: ${currentStatus}) por ${user.displayName ?? user.email} — Km: ${dto.mileage}`,
      );

      await this.notificationsService.notify({
        type: 'ESTADO_CAMBIADO',
        targetRole: RoleEnum.DOCUMENTACION,
        targetSede: vehicle['sede'],
        title: '⚠️ Vehículo certificado en estado temprano',
        body: `El vehículo ${vehicle['chassis']} fue certificado físicamente pero aún está en estado ${currentStatus}`,
        vehicleId,
        chassis: vehicle['chassis'] as string,
      });

      this.logger.log(
        `Certificación creada (EarlyState branch — ${currentStatus}) para vehículo ${vehicleId}`,
      );

      return {
        vehicleId,
        upserted: false,
        newStatus: currentStatus,
        certifiedWhileEarlyState: true,
        certificationDate: new Date().toISOString(),
      };
    }

    // ── Branch A: flujo normal (DOCUMENTADO) — avanzar a CERTIFICADO_STOCK ──
    // Cambiar estado del vehículo a CERTIFICADO_STOCK + guardar datos de recepción
    await this.vehiclesService.changeStatus(
      vehicleId,
      VehicleStatus.CERTIFICADO_STOCK,
      user,
      {
        notes: `Certificado por ${user.displayName ?? user.email} — Km: ${dto.mileage}, Improntas: ${dto.imprints}`,
        extraFields: {
          certificationDate: now,
          certifiedBy: user.uid,
          originConcessionaire: dto.originConcessionaire,
          receptionDate: now,
          ...(vehiclePhotoUrl && { photoUrl: vehiclePhotoUrl }),
        },
      },
    );

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
      upserted: false,
      newStatus: VehicleStatus.CERTIFICADO_STOCK,
      certificationDate: new Date().toISOString(),
    };
  }

  async findOne(vehicleId: string) {
    const cert = await this.certifications.findByIdOrThrow(
      vehicleId,
      () => new NotFoundException('Certificación no encontrada'),
    );

    // Regenerar signed URL para que nunca expire en el GET
    if (cert.rims?.photoUrl) {
      const storagePath = `vehicles/${vehicleId}/rims-photo.jpg`;
      cert.rims = {
        ...cert.rims,
        photoUrl: await this.firebase
          .getSignedUrl(storagePath)
          .catch(() => cert.rims.photoUrl),
      };
    }

    return cert;
  }

  async update(
    vehicleId: string,
    dto: Partial<CreateCertificationDto>,
    user: AuthenticatedUser,
    files?: {
      vehiclePhoto?: Express.Multer.File;
      rimsPhoto?: Express.Multer.File;
    },
  ) {
    const existing = await this.certifications.findByIdOrThrow(
      vehicleId,
      () => new NotFoundException('Certificación no encontrada'),
    );

    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const updates: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
      updatedAt: this.firebase.serverTimestamp(),
    };

    // Reemplazar foto del vehículo si se recibe nueva
    if (files?.vehiclePhoto) {
      const vPhotoPath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.deleteFile(vPhotoPath).catch(() => {});
      await this.firebase.uploadBuffer(
        files.vehiclePhoto.buffer,
        vPhotoPath,
        files.vehiclePhoto.mimetype,
      );
      const newVUrl = await this.firebase.getSignedUrl(vPhotoPath);
      // Actualizar photoUrl en el vehículo
      await this.vehicleFields.updateFields(vehicleId, { photoUrl: newVUrl });
    } else if (dto.vehiclePhotoBase64) {
      const vPhotoPath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.deleteFile(vPhotoPath).catch(() => {});
      const buffer = Buffer.from(dto.vehiclePhotoBase64, 'base64');
      await this.firebase.uploadBuffer(buffer, vPhotoPath, 'image/jpeg');
      const newVUrl = await this.firebase.getSignedUrl(vPhotoPath);
      await this.vehicleFields.updateFields(vehicleId, { photoUrl: newVUrl });
    }
    // Limpiar vehiclePhotoBase64 del update de certificación (no se guarda en cert doc)
    delete updates['vehiclePhotoBase64'];

    // Actualizar originConcessionaire en el vehículo si viene
    if (dto.originConcessionaire) {
      await this.vehicleFields.updateFields(vehicleId, {
        originConcessionaire: dto.originConcessionaire,
      });
    }

    // Reemplazar foto de aros si se recibe nueva
    if (files?.rimsPhoto) {
      const storagePath = `vehicles/${vehicleId}/rims-photo.jpg`;
      await this.firebase.deleteFile(storagePath).catch(() => {});
      await this.firebase.uploadBuffer(
        files.rimsPhoto.buffer,
        storagePath,
        files.rimsPhoto.mimetype,
      );
      const newUrl = await this.firebase.getSignedUrl(storagePath);
      updates['rims'] = { ...(existing.rims ?? {}), photoUrl: newUrl };
    }

    // `updates` mezcla campos del dto (parcial, tipado en el controlador) con
    // `updatedAt` y opcionalmente `rims` reconstruido — se castea porque ya
    // pasó por Object.fromEntries y perdió el tipado estricto del dto.
    await this.certifications.update(
      vehicleId,
      updates as Partial<Omit<CertificationDocument, 'tenantId' | 'id'>>,
    );

    // Registrar en historial los campos modificados
    const changedFields: string[] = [];
    if (dto.mileage !== undefined) changedFields.push('kilometraje');
    if (dto.imprints !== undefined) changedFields.push('improntas');
    if (dto.radio !== undefined) changedFields.push('radio');
    if (dto.rimsStatus !== undefined) changedFields.push('aros');
    if (dto.seatType !== undefined) changedFields.push('asientos');
    if (dto.antenna !== undefined) changedFields.push('antena');
    if (dto.trunkCover !== undefined) changedFields.push('cubre-maleta');
    if (dto.originConcessionaire !== undefined)
      changedFields.push('concesionario origen');
    if (files?.vehiclePhoto) changedFields.push('foto vehículo');
    if (files?.rimsPhoto) changedFields.push('foto aros');

    if (changedFields.length > 0) {
      await this.vehiclesService.addStatusHistory(
        vehicleId,
        vehicle['status'] as VehicleStatus,
        vehicle['status'] as VehicleStatus,
        user,
        vehicle['sede'],
        `Certificación actualizada (${changedFields.join(', ')}) por ${user.displayName ?? user.email}`,
      );
    }

    return { vehicleId, updated: true };
  }

  async remove(vehicleId: string, user: AuthenticatedUser) {
    await this.certifications.findByIdOrThrow(
      vehicleId,
      () => new NotFoundException('Certificación no encontrada'),
    );

    // Leer el vehículo ANTES de eliminar el cert doc (necesario para el branch)
    const vehicle = await this.vehiclesService.assertExists(vehicleId);

    const isNoFacturadoBranch =
      vehicle['certifiedWhileNoFacturado'] === true &&
      vehicle['status'] === VehicleStatus.NO_FACTURADO;

    const earlyRemoveStatuses = [
      VehicleStatus.POR_ARRIBAR,
      VehicleStatus.ENVIADO_A_MATRICULAR,
    ];
    const isEarlyStateBranch =
      vehicle['certifiedWhileEarlyState'] === true &&
      earlyRemoveStatuses.includes(vehicle['status'] as VehicleStatus);

    // Branch D: vehículo ya avanzó a DOCUMENTADO pero el flag early sigue activo
    const isDocumentadoWithEarlyFlag =
      vehicle['certifiedWhileEarlyState'] === true &&
      vehicle['status'] === VehicleStatus.DOCUMENTADO;

    // Eliminar foto de aros de Firebase Storage
    await this.firebase
      .deleteFile(`vehicles/${vehicleId}/rims-photo.jpg`)
      .catch(() => {});

    // Eliminar el documento de certificación
    await this.certifications.delete(vehicleId);

    if (isNoFacturadoBranch) {
      // Branch B: limpiar flag, el vehículo SE QUEDA en NO_FACTURADO
      await this.vehicleFields.updateFields(vehicleId, {
        certifiedWhileNoFacturado: false,
        certificationDate: null,
        certifiedBy: null,
      });

      await this.vehiclesService.addStatusHistory(
        vehicleId,
        VehicleStatus.NO_FACTURADO,
        VehicleStatus.NO_FACTURADO,
        user,
        vehicle['sede'],
        'Certificación eliminada — vehículo requiere re-certificación antes de continuar',
      );
    } else if (isEarlyStateBranch) {
      // Branch C: limpiar flag, el vehículo SE QUEDA en POR_ARRIBAR / ENVIADO_A_MATRICULAR
      const currentStatus = vehicle['status'] as VehicleStatus;
      await this.vehicleFields.updateFields(vehicleId, {
        certifiedWhileEarlyState: false,
        certificationDate: null,
        certifiedBy: null,
      });

      await this.vehiclesService.addStatusHistory(
        vehicleId,
        currentStatus,
        currentStatus,
        user,
        vehicle['sede'],
        'Certificación eliminada (estado temprano) — vehículo requiere re-certificación antes de continuar',
      );
    } else if (isDocumentadoWithEarlyFlag) {
      // Branch D: vehículo ya en DOCUMENTADO con flag early activo —
      // solo limpiar flag, NO revertir status (ya está en DOCUMENTADO)
      await this.vehicleFields.updateFields(vehicleId, {
        certifiedWhileEarlyState: false,
        certificationDate: null,
        certifiedBy: null,
      });

      await this.vehiclesService.addStatusHistory(
        vehicleId,
        VehicleStatus.DOCUMENTADO,
        VehicleStatus.DOCUMENTADO,
        user,
        vehicle['sede'],
        'Certificación eliminada — vehículo requiere re-certificación antes de continuar',
      );
    } else {
      // Branch A: comportamiento estándar — revertir a DOCUMENTADO
      await this.vehiclesService.changeStatus(
        vehicleId,
        VehicleStatus.DOCUMENTADO,
        user,
        {
          notes: `Certificación eliminada por ${user.displayName ?? user.email} — requiere re-certificación`,
          extraFields: { certificationDate: null, certifiedBy: null },
        },
      );
    }

    this.logger.log(
      `Certificación eliminada para vehículo ${vehicleId} por ${user.uid}`,
    );
    return { vehicleId, deleted: true };
  }
}
