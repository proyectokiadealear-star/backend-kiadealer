import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';

/**
 * Vista de `users` con los campos que necesita el armado de destinatarios de
 * una notificación push. `users` YA migró (ver `src/modules/users/users.repository.ts`
 * — `UsersRepository extends TenantScopedRepository`), así que esta lectura
 * no necesita ningún accesor puente: `TenantScopedRepository` aplica el
 * scope de tenant de punta a punta, igual que en el resto del módulo.
 *
 * No se reutiliza `UsersService`/`UsersRepository` directamente porque:
 *  - `UsersService.findAll()` descarta `fcmTokens` a propósito (no expone
 *    tokens de push en el listado público de usuarios) — justo el campo que
 *    esta lectura necesita.
 *  - `UsersRepository` no está en los `exports` de `UsersModule`, solo
 *    `UsersService` — no se puede inyectar desde otro módulo sin tocar
 *    `users.module.ts`, fuera del alcance de esta migración.
 *
 * Por eso este repositorio, acotado a `notifications`, apunta a la misma
 * colección física `users` con su propia consulta de solo lectura.
 */
export interface NotificationRecipient extends TenantScopedDocument {
  role: RoleEnum;
  sede: SedeEnum;
  active: boolean;
  fcmTokens: string[];
}

@Injectable()
export class NotificationRecipientsRepository extends TenantScopedRepository<NotificationRecipient> {
  protected readonly collectionName = 'users';

  /**
   * Usuarios activos con ese rol, en esa sede o en `SedeEnum.ALL` (broadcast).
   *
   * `scopedQuery()` ya acota por `tenantId`; se suman `role` y `active`
   * (igualdades) y, si la sede no es `ALL`, un `in` sobre `[sede, ALL]` —
   * mismo patrón que usaba el código pre-migración. Sigue sin necesitar
   * índice compuesto: Firestore resuelve igualdades + un único `in` con sus
   * índices automáticos de campo único, sin `orderBy` de por medio.
   */
  async findActiveByRoleAndSede(
    role: RoleEnum,
    sede: SedeEnum | 'ALL',
  ): Promise<NotificationRecipient[]> {
    let query = this.scopedQuery()
      .where('role', '==', role)
      .where('active', '==', true);

    if (sede !== SedeEnum.ALL) {
      query = query.where('sede', 'in', [sede, SedeEnum.ALL]);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as NotificationRecipient,
    );
  }
}
