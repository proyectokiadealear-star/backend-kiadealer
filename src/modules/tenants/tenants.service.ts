import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import {
  Establishment,
  ESTABLISHMENTS_SUBCOLLECTION,
  Tenant,
  TENANTS_COLLECTION,
  TenantStatus,
} from './tenant.types';

interface CachedTenant {
  tenant: Tenant | null;
  cachedAt: number;
}

/**
 * Acceso a la colección raíz `tenants`.
 *
 * Es el único repositorio del sistema que NO extiende TenantScopedRepository:
 * `tenants` es la colección que define los tenants, así que filtrarla por
 * tenantId no tendría sentido. Por eso vive fuera de la lista de ignores de
 * la regla de ESLint y accede a rawFirestore() de forma legítima.
 */
@Injectable()
export class TenantsService {
  /**
   * TenantGuard consulta el estado del concesionario en cada request. Sin
   * caché eso sería una lectura de Firestore por request. El TTL corto acota
   * la ventana en la que una suspensión sigue surtiendo efecto diferido.
   */
  private readonly cache = new Map<string, CachedTenant>();
  private readonly cacheTtlMs: number;

  constructor(private readonly firebase: FirebaseService) {
    this.cacheTtlMs = Number(process.env.TENANT_CACHE_TTL_MS ?? 60_000);
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.tenant;
    }

    const snapshot = await this.firebase
      .rawFirestore()
      .collection(TENANTS_COLLECTION)
      .doc(tenantId)
      .get();

    const tenant = snapshot.exists
      ? ({ id: snapshot.id, ...snapshot.data() } as Tenant)
      : null;

    this.cache.set(tenantId, { tenant, cachedAt: Date.now() });
    return tenant;
  }

  async isActive(tenantId: string): Promise<boolean> {
    const tenant = await this.findById(tenantId);
    return tenant?.status === TenantStatus.ACTIVE;
  }

  async listEstablishments(tenantId: string): Promise<Establishment[]> {
    const snapshot = await this.firebase
      .rawFirestore()
      .collection(TENANTS_COLLECTION)
      .doc(tenantId)
      .collection(ESTABLISHMENTS_SUBCOLLECTION)
      .get();

    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Establishment,
    );
  }

  /** Invalida la caché tras cambiar el estado o los datos de un concesionario. */
  invalidateCache(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /**
   * Ids de todos los concesionarios activos.
   *
   * Existe para jobs programados (`@Cron`) que corren sin request y por lo
   * tanto sin `TenantContext` abierto: antes de poder abrir contexto por
   * tenant con `TenantContext.run()`, el job necesita saber para cuáles
   * correr. Ver `AppointmentReminderService` para el primer consumidor.
   */
  async listActiveIds(): Promise<string[]> {
    const snapshot = await this.firebase
      .rawFirestore()
      .collection(TENANTS_COLLECTION)
      .where('status', '==', TenantStatus.ACTIVE)
      .get();

    return snapshot.docs.map((doc) => doc.id);
  }
}
