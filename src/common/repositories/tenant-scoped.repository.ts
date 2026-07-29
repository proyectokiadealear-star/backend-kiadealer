import { Query } from 'firebase-admin/firestore';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuditService } from '../../modules/audit/audit.service';
import { TenantContext } from '../tenant/tenant-context';

/** Todo documento con scope de concesionario lleva su tenantId. */
export interface TenantScopedDocument {
  id?: string;
  tenantId: string;
}

/**
 * Base de todo repositorio con scope de concesionario.
 *
 * Aplica `where('tenantId','==',ctx.tenantId)` a TODA consulta, sin que el
 * servicio que la usa tenga que acordarse. Los services no reciben ni pasan
 * `tenantId`: si un método de servicio tiene ese parámetro, el diseño está
 * mal, porque alguien podría pasarle uno distinto al del token.
 *
 * Ver docs/design/01-multi-tenancy.md D-103.
 */
export abstract class TenantScopedRepository<T extends TenantScopedDocument> {
  protected abstract readonly collectionName: string;

  constructor(
    protected readonly firebase: FirebaseService,
    protected readonly audit: AuditService,
  ) {}

  /**
   * Consulta base, siempre acotada al concesionario activo.
   *
   * Lanza excepción si no hay contexto: una consulta fuera de request revienta
   * en vez de devolver datos de todos los tenants (fallo cerrado).
   */
  protected scopedQuery(): Query {
    const { tenantId } = TenantContext.getOrThrow();
    return this.collection().where('tenantId', '==', tenantId);
  }

  protected collection() {
    return this.firebase.rawFirestore().collection(this.collectionName);
  }

  /**
   * Contexto del concesionario activo, o excepción si no hay.
   *
   * Lo exponen las subclases que necesitan el `tenantId` para construir
   * escrituras propias (lotes, ids compuestos), sin tener que importar
   * TenantContext en cada repositorio.
   */
  protected currentContext() {
    return TenantContext.getOrThrow();
  }

  /**
   * Crea un documento en el concesionario activo.
   *
   * El `tenantId` del contexto pisa cualquier valor presente en el payload —
   * es la defensa contra un cliente que intente escribir en otro
   * concesionario mandando su id en el body. Ver REQ-004.
   */
  async create(data: Omit<T, 'tenantId' | 'id'>, id?: string): Promise<T> {
    const { tenantId } = TenantContext.getOrThrow();
    const payload = { ...data, tenantId } as T;

    const ref = id ? this.collection().doc(id) : this.collection().doc();
    await ref.set(payload);

    return { ...payload, id: ref.id };
  }

  /**
   * Devuelve el documento, o `null` si no existe o pertenece a otro
   * concesionario.
   *
   * Un acceso cruzado devuelve `null` (traducido a 404 por el controlador),
   * nunca 403: un 403 confirmaría que el recurso existe en otro
   * concesionario, lo que permite enumerar inventario ajeno.
   * Ver docs/design/01-multi-tenancy.md D-104.
   */
  async findById(id: string): Promise<T | null> {
    const { tenantId } = TenantContext.getOrThrow();
    const snapshot = await this.collection().doc(id).get();

    if (!snapshot.exists) return null;

    const data = { id: snapshot.id, ...snapshot.data() } as T;

    if (data.tenantId !== tenantId) {
      await this.audit.recordCrossTenantAttempt({
        collection: this.collectionName,
        documentId: id,
        ownerTenantId: data.tenantId,
      });
      return null;
    }

    return data;
  }

  /** Igual que `findById`, pero lanza si no hay resultado. */
  async findByIdOrThrow(id: string, notFound: () => Error): Promise<T> {
    const found = await this.findById(id);
    if (!found) throw notFound();
    return found;
  }

  async findAll(): Promise<T[]> {
    const snapshot = await this.scopedQuery().get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);
  }

  /**
   * Actualiza un documento del concesionario activo.
   *
   * Verifica pertenencia antes de escribir y nunca permite reasignar el
   * `tenantId`: mover un documento entre concesionarios es una operación de
   * plataforma, no una actualización de negocio.
   */
  async update(
    id: string,
    changes: Partial<Omit<T, 'tenantId' | 'id'>>,
  ): Promise<T | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    await this.collection().doc(id).update(changes);
    return { ...existing, ...changes } as T;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;

    await this.collection().doc(id).delete();
    return true;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.findById(id)) !== null;
  }

  /**
   * Cuenta documentos del concesionario activo sin traerlos.
   *
   * Usa el agregado `count()` de Firestore: cobra por índice leído, no por
   * documento. Reemplaza al patrón de traer la colección entera solo para
   * medir su tamaño, que es una de las rutas de lectura masiva detectadas en
   * el diagnóstico.
   */
  async count(query: Query = this.scopedQuery()): Promise<number> {
    const snapshot = await query.count().get();
    return snapshot.data().count;
  }

  /**
   * Paginación por cursor sobre una consulta ya acotada al concesionario.
   *
   * Pide `limit + 1` documentos para saber si hay página siguiente sin
   * necesidad de una consulta extra. El cursor viaja en base64 y lleva el
   * valor del campo de orden más el id del documento, que actúa como
   * desempate estable cuando dos documentos comparten el mismo valor.
   *
   * El cursor NO lleva el tenantId: es opaco para el cliente y el scope
   * siempre se reaplica desde el contexto, así que un cursor de otro
   * concesionario no puede usarse para saltar de tenant.
   */
  async paginate(
    options: PaginateOptions,
    baseQuery?: Query,
  ): Promise<Page<T>> {
    const {
      limit,
      cursor,
      orderByField = 'createdAt',
      direction = 'desc',
    } = options;

    let query = (baseQuery ?? this.scopedQuery())
      .orderBy(orderByField, direction)
      .orderBy('__name__', direction);

    const decoded = decodeCursor(cursor);
    if (decoded) {
      query = query.startAfter(decoded.value, decoded.docId);
    }

    const snapshot = await query.limit(limit + 1).get();
    const hasMore = snapshot.docs.length > limit;
    const pageDocs = snapshot.docs.slice(0, limit);
    const items = pageDocs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);

    const lastDoc = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && lastDoc
        ? encodeCursor(lastDoc.get(orderByField), lastDoc.id)
        : null;

    return { items, nextCursor, hasMore };
  }
}

export interface PaginateOptions {
  limit: number;
  cursor?: string | null;
  orderByField?: string;
  direction?: 'asc' | 'desc';
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface DecodedCursor {
  value: unknown;
  docId: string;
}

export function encodeCursor(value: unknown, docId: string): string {
  return Buffer.from(JSON.stringify({ value, docId }), 'utf8').toString(
    'base64',
  );
}

/**
 * Devuelve `null` ante un cursor ausente o corrupto en vez de lanzar: un
 * cursor inválido degrada a "primera página", que es preferible a un 500 por
 * un valor que el cliente pudo haber truncado o alterado.
 */
export function decodeCursor(cursor?: string | null): DecodedCursor | null {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64').toString('utf8'),
    ) as Partial<DecodedCursor>;

    if (typeof parsed?.docId !== 'string' || !('value' in parsed)) return null;
    return { value: parsed.value, docId: parsed.docId };
  } catch {
    return null;
  }
}
