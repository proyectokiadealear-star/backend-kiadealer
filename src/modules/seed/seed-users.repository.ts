import { Injectable } from '@nestjs/common';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';

/**
 * Documento `users/{uid}` visto desde el seeder.
 *
 * `UsersModule` NO exporta `UsersRepository` (solo `UsersService` — ver
 * users.module.ts): ese servicio asume un actor autenticado (`creator:
 * AuthenticatedUser` en `create()`) que en /seed no existe (ver
 * seed-platform-context.ts). Tampoco encaja de otra forma: `UsersService.create()`
 * genera su propio uid vía `auth().createUser()`, mientras que el seeder
 * necesita escribir el documento Firestore con un uid YA resuelto en Firebase
 * Auth (creado o recuperado en el propio SeedService, antes de tocar
 * Firestore) — no hay forma de pasarle ese uid.
 *
 * Por eso este repositorio propio y deliberadamente mínimo: mismo shape de
 * documento y mismo scoping por tenant que `UsersRepository` (ambos
 * extienden `TenantScopedRepository` sobre la MISMA colección `users`, sin
 * conflicto — es el mismo patrón que `VehiclesRepository` reutilizado acá
 * para vehículos), pero SIN la lógica de negocio de asignación de claims:
 * el seeder gestiona los custom claims directamente contra Firebase Auth
 * (ver `SeedService`), porque son globales y no tienen scope de tenant en
 * Firestore — mismo criterio que documenta `UsersRepository.assignClaims()`.
 */
export interface SeedUserDocument extends TenantScopedDocument {
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

@Injectable()
export class SeedUsersRepository extends TenantScopedRepository<SeedUserDocument> {
  protected readonly collectionName = 'users';
}
