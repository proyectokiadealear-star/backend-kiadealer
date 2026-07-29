import { ConflictException, Injectable } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

/**
 * Tipos de catálogo soportados. Cada uno vive en su propia subcolección
 * `catalogs/{tipo}/items`, ya poblada en producción — la migración no puede
 * cambiar esa forma sin invalidar los datos ya sembrados.
 */
export const CATALOG_TYPES = [
  'colors',
  'models',
  'concessionaires',
  'sedes',
  'accessories',
] as const;

export type CatalogType = (typeof CATALOG_TYPES)[number];

/** Token de inyección por tipo de catálogo — uno por subcolección. */
export const CATALOG_REPOSITORY_TOKENS: Record<CatalogType, symbol> = {
  colors: Symbol('COLORS_REPOSITORY'),
  models: Symbol('MODELS_REPOSITORY'),
  concessionaires: Symbol('CONCESSIONAIRES_REPOSITORY'),
  sedes: Symbol('SEDES_REPOSITORY'),
  accessories: Symbol('ACCESSORIES_REPOSITORY'),
};

export interface CatalogItem extends TenantScopedDocument {
  name: string;
  code?: string;
  key?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/**
 * Repositorio de un catálogo puntual (colores, modelos, concesionarios,
 * sedes o accesorios).
 *
 * La colección real es la subcolección `catalogs/{tipo}/items`, no una
 * colección raíz — TenantScopedRepository asume esto último. No hizo falta
 * sobreescribir `collection()`: alcanza con fijar `collectionName` al path
 * completo, porque el SDK de Firestore resuelve `.collection('catalogs/
 * colors/items')` igual que `.collection('colors')` — cualquier path con
 * número impar de segmentos (colección → documento → colección → ...) es una
 * referencia de colección válida.
 *
 * OJO — la subcolección es compartida por TODOS los concesionarios (un solo
 * `catalogs/colors/items` para todos, no uno por tenant): así estaba antes de
 * esta migración y sigue así, porque particionarla por tenant implicaría
 * migrar los datos ya sembrados, fuera del alcance de este cambio. Por eso
 * el id determinístico se prefija con el tenantId — ver `buildItemId()`.
 */
@Injectable()
export class CatalogItemsRepository extends TenantScopedRepository<CatalogItem> {
  protected readonly collectionName: string;

  constructor(
    firebase: FirebaseService,
    audit: AuditService,
    private readonly catalogType: CatalogType,
  ) {
    super(firebase, audit);
    this.collectionName = `catalogs/${catalogType}/items`;
  }

  /**
   * Igual al slug que usa SeedService: mismo nombre siempre produce el mismo
   * slug. Ese determinismo es lo que permite detectar duplicados sin un
   * índice adicional.
   */
  private toSlugId(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  /**
   * Prefija el slug con el tenantId porque la subcolección física es
   * compartida entre concesionarios (ver comentario de clase): sin el
   * prefijo, dos concesionarios dando de alta el mismo nombre ("BLANCO
   * PERLA") terminarían escribiendo el mismo documento y el segundo pisaría
   * al primero.
   */
  private buildItemId(tenantId: string, name: string): string {
    return `${tenantId}__${this.toSlugId(name)}`;
  }

  /**
   * Lista ordenada alfabéticamente por nombre.
   *
   * El orden se aplica en memoria y no con `.orderBy('name')` en Firestore
   * para no depender de un índice compuesto (tenantId ==, name asc) que hoy
   * no existe — los catálogos son chicos por naturaleza, así que el costo es
   * despreciable.
   */
  async findAllSorted(): Promise<CatalogItem[]> {
    const items = await this.findAll();
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Crea un ítem con id determinístico (ver `buildItemId`).
   *
   * Verifica duplicado por existencia del documento antes de escribir, igual
   * que hacía el servicio original — con la salvedad de que el id ahora
   * incluye el tenantId, así que el duplicado se evalúa por concesionario.
   */
  async createItem(
    data: Omit<CatalogItem, 'tenantId' | 'id' | 'createdAt'>,
  ): Promise<CatalogItem> {
    const { tenantId } = TenantContext.getOrThrow();
    const id = this.buildItemId(tenantId, data.name);

    const existing = await this.collection().doc(id).get();
    if (existing.exists) {
      throw new ConflictException(
        `Ya existe un ítem con el nombre "${data.name}" en el catálogo '${this.catalogType}'. ID: ${id}`,
      );
    }

    return this.create(
      { ...data, createdAt: this.firebase.serverTimestamp() } as Omit<
        CatalogItem,
        'tenantId' | 'id'
      >,
      id,
    );
  }

  /** Actualiza sellando `updatedAt`; delega el chequeo de pertenencia a la base. */
  async updateItem(
    id: string,
    changes: Partial<Omit<CatalogItem, 'tenantId' | 'id'>>,
  ): Promise<CatalogItem | null> {
    return this.update(id, {
      ...changes,
      updatedAt: this.firebase.serverTimestamp(),
    });
  }
}
