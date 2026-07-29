/**
 * Firestore en memoria, mínimo, para los tests de integración de
 * SeedService.
 *
 * SeedService ya no llama a `firestore()`/`rawFirestore()` directamente
 * (salvo lo justificado en seed-platform-context.ts) — orquesta repositorios
 * reales (`TenantScopedRepository`). Para probar de verdad que el borrado
 * masivo no cruza tenants hace falta ejercitar esos repositorios reales
 * contra ALGO que se comporte como Firestore, no mockear cada llamada a
 * `.collection().where().get()` a mano (7+ colecciones, inmanejable). Este
 * fake implementa el subconjunto de la API de `firebase-admin/firestore`
 * que los repositorios usados por SeedService necesitan: `collection()`,
 * `doc()`, `where('==', ...)`, `limit()`, `get()`, `set()`, `update()`,
 * `delete()`, `add()`, subcolecciones vía `doc().collection()`, y `batch()`.
 *
 * No es un mock — es un fake con estado real (un Map por "ruta" de
 * colección), así que las aserciones de los tests leen el estado resultante
 * en vez de solo verificar qué se llamó.
 */

type FakeDoc = Record<string, unknown>;

export interface FakeFirestore {
  collection(path: string): FakeCollection;
  batch(): FakeBatch;
  /** Acceso directo de test: todos los documentos vivos de una colección. */
  dump(path: string): Array<{ id: string; data: FakeDoc }>;
}

interface FakeCollection {
  doc(id?: string): FakeDocRef;
  where(field: string, op: '==' | '>=' | '<=', value: unknown): FakeQuery;
  limit(n: number): FakeQuery;
  orderBy(): FakeQuery;
  get(): Promise<FakeSnapshot>;
  add(data: FakeDoc): Promise<FakeDocRef>;
  firestore: { batch(): FakeBatch };
}

interface FakeQuery {
  where(field: string, op: '==' | '>=' | '<=', value: unknown): FakeQuery;
  limit(n: number): FakeQuery;
  orderBy(): FakeQuery;
  startAfter(): FakeQuery;
  get(): Promise<FakeSnapshot>;
  count(): { get(): Promise<{ data(): { count: number } }> };
}

interface FakeSnapshot {
  docs: Array<{ id: string; data(): FakeDoc; ref: FakeDocRef }>;
  empty: boolean;
  size: number;
}

interface FakeDocRef {
  id: string;
  get(): Promise<
    | { exists: true; id: string; data(): FakeDoc }
    | { exists: false; data(): undefined }
  >;
  set(data: FakeDoc): Promise<void>;
  update(changes: FakeDoc): Promise<void>;
  delete(): Promise<void>;
  collection(sub: string): FakeCollection;
}

interface FakeBatch {
  delete(ref: FakeDocRef): void;
  set(ref: FakeDocRef, data: FakeDoc): void;
  commit(): Promise<void>;
}

export function createFakeFirestore(): FakeFirestore {
  const store = new Map<string, Map<string, FakeDoc>>();
  let autoId = 0;

  const mapFor = (path: string): Map<string, FakeDoc> => {
    if (!store.has(path)) store.set(path, new Map());
    return store.get(path) as Map<string, FakeDoc>;
  };

  const applyFilters = (
    path: string,
    filters: Array<[string, '==' | '>=' | '<=', unknown]>,
    limitN?: number,
  ): Array<{ id: string; data: FakeDoc }> => {
    let entries = [...mapFor(path).entries()].map(([id, data]) => ({
      id,
      data,
    }));
    for (const [field, op, value] of filters) {
      entries = entries.filter((e) => {
        const actual = e.data[field];
        if (op === '==') return actual === value;
        if (op === '>=') return (actual as never) >= (value as never);
        if (op === '<=') return (actual as never) <= (value as never);
        return true;
      });
    }
    if (limitN !== undefined) entries = entries.slice(0, limitN);
    return entries;
  };

  const makeDocRef = (path: string, id: string): FakeDocRef => ({
    id,
    get: async () => {
      const data = mapFor(path).get(id);
      return data
        ? { exists: true as const, id, data: () => data }
        : { exists: false as const, data: () => undefined };
    },
    set: async (data: FakeDoc) => {
      mapFor(path).set(id, data);
    },
    update: async (changes: FakeDoc) => {
      const existing = mapFor(path).get(id) ?? {};
      mapFor(path).set(id, { ...existing, ...changes });
    },
    delete: async () => {
      mapFor(path).delete(id);
    },
    collection: (sub: string) => makeCollection(`${path}/${id}/${sub}`),
  });

  const makeQuery = (
    path: string,
    filters: Array<[string, '==' | '>=' | '<=', unknown]>,
    limitN?: number,
  ): FakeQuery => ({
    where: (field, op, value) =>
      makeQuery(path, [...filters, [field, op, value]], limitN),
    limit: (n) => makeQuery(path, filters, n),
    orderBy: () => makeQuery(path, filters, limitN),
    startAfter: () => makeQuery(path, filters, limitN),
    get: async () => {
      const entries = applyFilters(path, filters, limitN);
      const docs = entries.map((e) => ({
        id: e.id,
        data: () => e.data,
        ref: makeDocRef(path, e.id),
      }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    count: () => ({
      get: async () => ({
        data: () => ({ count: applyFilters(path, filters, limitN).length }),
      }),
    }),
  });

  const makeBatch = (): FakeBatch => {
    const ops: Array<() => Promise<void>> = [];
    return {
      delete: (ref) => {
        // ref.delete() ya cierra sobre su propio path/id (viene de
        // makeDocRef) — el batch solo difiere la ejecución hasta commit().
        ops.push(() => ref.delete());
      },
      set: (ref, data) => {
        ops.push(() => ref.set(data));
      },
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  };

  const makeCollection = (path: string): FakeCollection => ({
    doc: (id) => makeDocRef(path, id ?? `auto-${autoId++}`),
    where: (field, op, value) => makeQuery(path, [[field, op, value]]),
    limit: (n) => makeQuery(path, [], n),
    orderBy: () => makeQuery(path, []),
    get: async () => makeQuery(path, []).get(),
    add: async (data) => {
      const id = `auto-${autoId++}`;
      mapFor(path).set(id, data);
      return makeDocRef(path, id);
    },
    firestore: { batch: makeBatch },
  });

  return {
    collection: makeCollection,
    batch: makeBatch,
    dump: (path) =>
      [...mapFor(path).entries()].map(([id, data]) => ({ id, data })),
  };
}
