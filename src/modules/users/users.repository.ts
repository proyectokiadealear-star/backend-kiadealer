import { Injectable } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';
import { TenantContext } from '../../common/tenant/tenant-context';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';

/**
 * Documento `users/{uid}` — el uid de Firebase Auth es también el id del
 * documento (ver `create()` en el servicio, que siempre pasa el uid explícito).
 */
export interface UserDocument extends TenantScopedDocument {
  uid: string;
  displayName: string;
  email: string;
  role: RoleEnum;
  sede: SedeEnum;
  active: boolean;
  fcmTokens: string[];
  createdAt: unknown;
  updatedAt: unknown;
  createdBy: string;
}

/** Claims que el servicio puede pedir asignar. NUNCA incluye `tenantId` a propósito — ver `assignClaims()`. */
export interface AssignableClaims {
  role: RoleEnum;
  sede: SedeEnum;
  active: boolean;
}

@Injectable()
export class UsersRepository extends TenantScopedRepository<UserDocument> {
  protected readonly collectionName = 'users';

  /**
   * Lista usuarios del concesionario activo, con filtros opcionales.
   *
   * Sin `.orderBy()` a propósito — igual que el código original, para no
   * depender de un índice compuesto (tenantId == + los filtros) que hoy no
   * existe. El orden por `displayName` se aplica en memoria en el servicio.
   */
  async findFiltered(filters?: {
    role?: RoleEnum;
    sede?: SedeEnum;
    active?: boolean;
  }): Promise<UserDocument[]> {
    let query = this.scopedQuery();

    if (filters?.role) query = query.where('role', '==', filters.role);
    if (filters?.sede) query = query.where('sede', '==', filters.sede);
    if (filters?.active !== undefined) {
      query = query.where('active', '==', filters.active);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as UserDocument,
    );
  }

  /**
   * Agrega un token FCM al usuario, si pertenece al concesionario activo.
   *
   * Verifica pertenencia con `findById` antes de escribir — nunca se asume
   * que `uid` es siempre el del propio actor, aunque en la práctica el único
   * llamador actual (`registerFcmToken`) lo use así.
   */
  async addFcmToken(uid: string, token: string): Promise<boolean> {
    const existing = await this.findById(uid);
    if (!existing) return false;

    await this.collection()
      .doc(uid)
      .update({
        fcmTokens: FieldValue.arrayUnion(token),
        updatedAt: this.firebase.serverTimestamp(),
      });

    return true;
  }

  /**
   * Asigna custom claims de Firebase Auth para el uid dado.
   *
   * El `tenantId` SIEMPRE sale del contexto activo — nunca de un parámetro.
   * El tipo `AssignableClaims` ni siquiera admite un campo `tenantId`: es
   * imposible, a nivel de tipos, que un llamador intente colarlo acá. Ver
   * docs/design/01-multi-tenancy.md D-102.
   *
   * `setCustomUserClaims()` REEMPLAZA el objeto de claims completo, no lo
   * mergea (a diferencia de Firestore `update()`). Por eso se leen los claims
   * existentes primero: si no lo hiciéramos, cada cambio de rol/sede/active
   * pisaría en silencio `establishmentIds` u otro claim que
   * `scripts/remint-claims.js` ya haya asignado — ese es exactamente el tipo
   * de bug que hunde un despliegue sin que nadie lo note hasta que un usuario
   * queda con permisos rotos.
   */
  async assignClaims(uid: string, claims: AssignableClaims): Promise<void> {
    const { tenantId } = TenantContext.getOrThrow();
    const authUser = await this.firebase.auth().getUser(uid);

    await this.firebase.auth().setCustomUserClaims(uid, {
      ...(authUser.customClaims ?? {}),
      ...claims,
      tenantId,
    });
  }
}
