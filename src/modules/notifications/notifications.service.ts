import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../../firebase/firebase.service';
import { NotificationPayload } from './interfaces/notification-payload.interface';
import { SedeEnum } from '../../common/enums/sede.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { NotificationsRepository } from './notifications.repository';
import { NotificationRecipientsRepository } from './notification-recipients.repository';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly notificationsRepository: NotificationsRepository,
    private readonly recipients: NotificationRecipientsRepository,
  ) {}

  async notify(payload: NotificationPayload): Promise<void> {
    try {
      // 1. Obtener usuarios con ese rol y esa sede, del concesionario activo
      const users = await this.recipients.findActiveByRoleAndSede(
        payload.targetRole,
        payload.targetSede as SedeEnum,
      );

      // 2. Recopilar FCM tokens
      const tokens: string[] = users
        .flatMap((u) => u.fcmTokens ?? [])
        .filter(Boolean);

      // 3. Enviar via FCM (multicast)
      if (tokens.length > 0) {
        await this.firebase.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: {
            type: payload.type,
            vehicleId: payload.vehicleId ?? '',
            chassis: payload.chassis ?? '',
            ...(payload.data ?? {}),
          },
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
          webpush: {
            notification: { icon: '/icons/kia-icon.png' },
          },
        });
        this.logger.log(
          `FCM enviado a ${tokens.length} dispositivos — tipo: ${payload.type}`,
        );
      }

      // 4. Guardar en Firestore para in-app notifications (scope del tenant activo)
      await this.saveNotification(payload);
    } catch (error) {
      // No lanzamos el error para que el flujo principal no falle por notificaciones
      this.logger.error(`Error al enviar notificación: ${String(error)}`);
    }
  }

  private async saveNotification(payload: NotificationPayload): Promise<void> {
    // El id se genera acá (en vez de dejar que el repositorio use uno
    // autogenerado) para preservar el id determinístico que ya usaba el
    // código original.
    const notifId = uuidv4();

    await this.notificationsRepository.create(
      {
        type: payload.type,
        targetRole: payload.targetRole,
        targetSede: payload.targetSede,
        title: payload.title,
        body: payload.body,
        vehicleId: payload.vehicleId ?? null,
        chassis: payload.chassis ?? null,
        read: false,
        createdAt: this.firebase.serverTimestamp(),
      },
      notifId,
    );
  }

  async getNotifications(
    uid: string,
    userRole: RoleEnum,
    userSede: string,
    onlyUnread: boolean,
    limit: number,
  ) {
    const safeLimit = limit ?? 50;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // El repositorio ya acota por tenantId + targetRole (ver
    // NotificationsRepository.findByTargetRole). El resto del filtrado sigue
    // en memoria, igual que antes de la migración.
    const notifications =
      await this.notificationsRepository.findByTargetRole(userRole);

    const toDelete: string[] = [];
    const results: Record<string, unknown>[] = [];

    for (const data of notifications) {
      const createdDate: Date =
        (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() ??
        new Date(0);

      // Collect expired (>24h) docs for background cleanup
      if (createdDate < cutoff) {
        toDelete.push(data.id as string);
        continue;
      }

      // Filter by sede: accept notifications for this sede or broadcast (ALL).
      // targetSede es `string` (acepta el literal 'ALL' además del enum), por
      // eso la comparación castea el enum en vez de comparar tipos distintos.
      if (
        data.targetSede !== userSede &&
        data.targetSede !== (SedeEnum.ALL as string)
      ) {
        continue;
      }

      // Filter by read status in-memory
      if (onlyUnread && data.read !== false) {
        continue;
      }

      results.push({ ...data, createdAt: createdDate.toISOString() });
    }

    // Fire-and-forget: delete expired notifications in batches of 500
    if (toDelete.length > 0) {
      this.notificationsRepository
        .deleteBatch(toDelete)
        .catch((e) =>
          this.logger.warn(
            `Error limpiando notificaciones expiradas: ${String(e)}`,
          ),
        );
    }

    return results
      .sort(
        (a, b) =>
          new Date(b['createdAt'] as string).getTime() -
          new Date(a['createdAt'] as string).getTime(),
      )
      .slice(0, safeLimit);
  }

  /**
   * Marca como leída una notificación del concesionario activo.
   *
   * `update()` (heredado de TenantScopedRepository) devuelve `null` tanto si
   * el id no existe como si pertenece a otro concesionario — acá se traduce
   * a 404, nunca a 403 (D-104): un acceso cruzado no puede confirmar que la
   * notificación existe en otro tenant.
   */
  async markAsRead(notifId: string) {
    const updated = await this.notificationsRepository.update(notifId, {
      read: true,
    });

    if (!updated) {
      throw new NotFoundException('Notificación no encontrada');
    }

    return { id: notifId, read: true };
  }
}
