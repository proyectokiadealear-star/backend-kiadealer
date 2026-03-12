import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { NotificationPayload } from './interfaces/notification-payload.interface';
import { SedeEnum } from '../../common/enums/sede.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly firebase: FirebaseService) {}

  private get db() {
    return this.firebase.firestore();
  }

  async notify(payload: NotificationPayload): Promise<void> {
    try {
      // 1. Obtener usuarios con ese rol y esa sede
      const users = await this.getUsersByRoleAndSede(payload.targetRole, payload.targetSede as SedeEnum);

      // 2. Recopilar FCM tokens
      const tokens: string[] = users
        .flatMap((u) => (u['fcmTokens'] as string[]) ?? [])
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
        this.logger.log(`FCM enviado a ${tokens.length} dispositivos — tipo: ${payload.type}`);
      }

      // 4. Guardar en Firestore para in-app notifications
      await this.saveToFirestore(payload);
    } catch (error) {
      // No lanzamos el error para que el flujo principal no falle por notificaciones
      this.logger.error(`Error al enviar notificación: ${String(error)}`);
    }
  }

  private async getUsersByRoleAndSede(role: RoleEnum, sede: SedeEnum | 'ALL') {
    let query: FirebaseFirestore.Query = this.db
      .collection('users')
      .where('role', '==', role)
      .where('active', '==', true);

    // Si no busco por ALL, filtro por sede
    if (sede !== SedeEnum.ALL) {
      query = query.where('sede', 'in', [sede, SedeEnum.ALL]);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((d) => d.data());
  }

  private async saveToFirestore(payload: NotificationPayload) {
    const notifId = uuidv4();
    await this.db.collection('notifications').doc(notifId).set({
      id: notifId,
      type: payload.type,
      targetRole: payload.targetRole,
      targetSede: payload.targetSede,
      title: payload.title,
      body: payload.body,
      vehicleId: payload.vehicleId ?? null,
      chassis: payload.chassis ?? null,
      read: false,
      createdAt: this.firebase.serverTimestamp(),
    });
  }

  async getNotifications(uid: string, userRole: RoleEnum, userSede: string, onlyUnread: boolean, limit: number) {
    const safeLimit = limit ?? 50;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Single-field equality query — uses the automatic single-field index Firestore
    // creates for every field by default. No composite index required.
    const snapshot = await this.db
      .collection('notifications')
      .where('targetRole', '==', userRole)
      .get();

    const toDelete: string[] = [];
    const results: FirebaseFirestore.DocumentData[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const createdDate: Date = data['createdAt']?.toDate?.() ?? new Date(0);

      // Collect expired (>24h) docs for background cleanup
      if (createdDate < cutoff) {
        toDelete.push(doc.id);
        continue;
      }

      // Filter by sede: accept notifications for this sede or broadcast (ALL)
      if (data['targetSede'] !== userSede && data['targetSede'] !== SedeEnum.ALL) {
        continue;
      }

      // Filter by read status in-memory
      if (onlyUnread && data['read'] !== false) {
        continue;
      }

      results.push({ ...data, createdAt: createdDate.toISOString() });
    }

    // Fire-and-forget: delete expired notifications in batches of 500
    if (toDelete.length > 0) {
      this.deleteExpiredBatch(toDelete).catch((e) =>
        this.logger.warn(`Error limpiando notificaciones expiradas: ${String(e)}`),
      );
    }

    return results
      .sort((a, b) => new Date(b['createdAt']).getTime() - new Date(a['createdAt']).getTime())
      .slice(0, safeLimit);
  }

  private async deleteExpiredBatch(ids: string[]): Promise<void> {
    const BATCH_SIZE = 500;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = this.db.batch();
      ids.slice(i, i + BATCH_SIZE).forEach((id) =>
        batch.delete(this.db.collection('notifications').doc(id)),
      );
      await batch.commit();
    }
    this.logger.log(`Limpieza automática: ${ids.length} notificaciones expiradas eliminadas`);
  }

  async markAsRead(notifId: string) {
    await this.db.collection('notifications').doc(notifId).update({ read: true });
    return { id: notifId, read: true };
  }
}
