import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';
import { RoleEnum } from '../../common/enums/role.enum';

/**
 * Notificación in-app, con historial de lectura por concesionario.
 *
 * `targetSede` se mantiene como `string` (en vez de `SedeEnum`) porque el
 * payload que llega a `notify()` acepta el literal `'ALL'` además de los
 * valores del enum — igual que hacía el documento original en Firestore.
 */
export interface NotificationRecord extends TenantScopedDocument {
  type: string;
  targetRole: RoleEnum;
  targetSede: string;
  title: string;
  body: string;
  vehicleId: string | null;
  chassis: string | null;
  read: boolean;
  createdAt: unknown;
}

@Injectable()
export class NotificationsRepository extends TenantScopedRepository<NotificationRecord> {
  protected readonly collectionName = 'notifications';

  /**
   * Notificaciones del concesionario activo dirigidas a un rol.
   *
   * `scopedQuery()` ya aplica `tenantId == ctx.tenantId`; acá se suma
   * `targetRole == role`. Dos igualdades siguen sin necesitar índice
   * compuesto — Firestore las resuelve con sus índices automáticos de campo
   * único (ver el comentario original que esto reemplaza, en
   * notifications.service.ts antes de la migración). El resto del filtrado
   * (sede, leído/no leído, expiración) se hace en memoria en el service, tal
   * como antes.
   */
  async findByTargetRole(role: RoleEnum): Promise<NotificationRecord[]> {
    const snapshot = await this.scopedQuery()
      .where('targetRole', '==', role)
      .get();

    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as NotificationRecord,
    );
  }

  /**
   * Borra en lotes de 500 (límite del batch de Firestore).
   *
   * Los ids llegan siempre de una consulta ya acotada al tenant activo
   * (`findByTargetRole`), así que no hace falta reverificar pertenencia acá.
   * Usa `collection.firestore` (propiedad del `CollectionReference`, no el
   * método `rawFirestore()`) para no disparar la regla de ESLint que
   * prohíbe el acceso crudo fuera de la capa de repositorios — ver D-105.
   */
  async deleteBatch(ids: string[]): Promise<void> {
    const BATCH_SIZE = 500;
    const collectionRef = this.collection();

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = collectionRef.firestore.batch();
      ids
        .slice(i, i + BATCH_SIZE)
        .forEach((id) => batch.delete(collectionRef.doc(id)));
      await batch.commit();
    }
  }
}
