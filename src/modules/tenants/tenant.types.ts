/** Estado operativo de un concesionario dentro de la plataforma. */
export enum TenantStatus {
  /** Opera con normalidad. */
  ACTIVE = 'ACTIVE',
  /** Suspendido (falta de pago, incumplimiento). Sus usuarios reciben 403. */
  SUSPENDED = 'SUSPENDED',
  /** Provisionado pero aún sin habilitar. Sus usuarios reciben 403. */
  PENDING = 'PENDING',
}

export interface Tenant {
  id: string;
  name: string;
  ruc: string;
  status: TenantStatus;
  plan: string;
  createdAt: Date;
}

/** Sucursal o agencia de un concesionario. Reemplaza al enum SedeEnum. */
export interface Establishment {
  id: string;
  /** Código corto usado en importaciones y reportes, p. ej. "SURMOTOR". */
  code: string;
  name: string;
  address?: string;
  active: boolean;
}

export const TENANTS_COLLECTION = 'tenants';
export const ESTABLISHMENTS_SUBCOLLECTION = 'establishments';
