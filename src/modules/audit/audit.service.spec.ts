import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import { AuditService } from './audit.service';
import { AuditEntry, GENESIS_HASH } from './audit.types';
import { computeEntryHash } from './hash-chain';

const makeContext = (
  overrides: Partial<TenantContextData> = {},
): TenantContextData => ({
  tenantId: 'kia-quito',
  userId: 'user-1',
  role: RoleEnum.ASESOR,
  establishmentIds: ['surmotor'],
  platformAdmin: false,
  requestId: 'req-1',
  ...overrides,
});

/**
 * Firestore en memoria con el mínimo necesario: transacciones que leen el
 * puntero de cabecera y escriben entradas. Modela el encadenamiento real,
 * así que los tests de la cadena prueban la lógica y no el mock.
 */
class FakeFirestore {
  heads = new Map<string, { hash: string }>();
  entries: AuditEntry[] = [];

  // Propiedades con arrow function: capturan `this` léxicamente, sin alias.
  collection = (name: string) => ({
    doc: (id?: string) => ({
      id: id ?? `entry-${this.entries.length + 1}`,
      _collection: name,
    }),
    where: () => ({
      orderBy: () => ({
        get: () =>
          Promise.resolve({
            docs: this.entries.map((entry) => ({
              id: entry.id,
              data: () => entry,
            })),
          }),
      }),
    }),
  });

  runTransaction = <T>(
    handler: (transaction: unknown) => Promise<T>,
  ): Promise<T> => {
    const transaction = {
      get: (ref: { id: string; _collection: string }) => {
        const head = this.heads.get(ref.id);
        return Promise.resolve({
          exists: head !== undefined,
          data: () => head,
        });
      },
      set: (
        ref: { id: string; _collection: string },
        value: Record<string, unknown>,
      ) => {
        if (ref._collection === 'audit_heads') {
          this.heads.set(ref.id, { hash: value.hash as string });
        } else {
          this.entries.push({
            ...(value as unknown as AuditEntry),
            id: ref.id,
          });
        }
      },
    };
    return handler(transaction);
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let firestore: FakeFirestore;

  beforeEach(() => {
    firestore = new FakeFirestore();
    service = new AuditService({
      rawFirestore: () => firestore,
    } as never);
  });

  const appendEntries = async (count: number, tenantId = 'kia-quito') => {
    await TenantContext.run(makeContext({ tenantId }), async () => {
      for (let index = 0; index < count; index += 1) {
        await service.append({
          action: 'VEHICLE_STATUS_CHANGED',
          entity: 'vehicles',
          entityId: `v${index}`,
        });
      }
    });
  };

  describe('append()', () => {
    it('lanza si se invoca fuera de un contexto de tenant', async () => {
      await expect(
        service.append({ action: 'X', entity: 'vehicles', entityId: 'v1' }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('registra el actor y el tenant del contexto', async () => {
      await appendEntries(1);

      expect(firestore.entries[0]).toEqual(
        expect.objectContaining({
          tenantId: 'kia-quito',
          actorUid: 'user-1',
          actorRole: RoleEnum.ASESOR,
          requestId: 'req-1',
        }),
      );
    });

    it('la primera entrada de un concesionario usa el hash génesis', async () => {
      await appendEntries(1);

      expect(firestore.entries[0].prevHash).toBe(GENESIS_HASH);
    });

    it('cada entrada referencia el hash de la anterior', async () => {
      await appendEntries(5);

      for (let index = 1; index < firestore.entries.length; index += 1) {
        expect(firestore.entries[index].prevHash).toBe(
          firestore.entries[index - 1].hash,
        );
      }
    });

    it('omite los campos ausentes en vez de escribirlos como undefined', async () => {
      // Firestore rechaza `undefined` como valor: escribir before/after/metadata
      // sin definir hacía fallar la escritura real aunque el mock la aceptara.
      await appendEntries(1);

      const stored = firestore.entries[0] as unknown as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(stored, 'before')).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(stored, 'after')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(stored, 'metadata')).toBe(
        false,
      );
      expect(Object.values(stored).includes(undefined)).toBe(false);
    });

    it('redacta los datos personales antes de persistir', async () => {
      await TenantContext.run(makeContext(), () =>
        service.append({
          action: 'DOCUMENT_UPLOADED',
          entity: 'documentations',
          entityId: 'd1',
          after: { cedula: '1712345678', model: 'Sportage' },
        }),
      );

      expect(JSON.stringify(firestore.entries[0])).not.toContain('1712345678');
      expect(firestore.entries[0].after?.model).toBe('Sportage');
    });
  });

  describe('recordCrossTenantAttempt()', () => {
    it('registra el intento en la cadena del tenant real del token', async () => {
      await TenantContext.run(makeContext(), () =>
        service.recordCrossTenantAttempt({
          collection: 'vehicles',
          documentId: 'v-ajeno',
          ownerTenantId: 'mazda-guayaquil',
        }),
      );

      expect(firestore.entries[0]).toEqual(
        expect.objectContaining({
          action: 'CROSS_TENANT_ACCESS_ATTEMPT',
          tenantId: 'kia-quito',
          entityId: 'v-ajeno',
        }),
      );
      expect(firestore.entries[0].metadata?.ownerTenantId).toBe(
        'mazda-guayaquil',
      );
    });
  });

  describe('verifyChain()', () => {
    it('reporta válida una cadena íntegra', async () => {
      await appendEntries(10);

      const result = await service.verifyChain('kia-quito');

      expect(result).toEqual({ valid: true, entriesChecked: 10 });
    });

    it('reporta válida una cadena vacía', async () => {
      const result = await service.verifyChain('sin-entradas');

      expect(result).toEqual({ valid: true, entriesChecked: 0 });
    });

    it('detecta la alteración del contenido de una entrada', async () => {
      await appendEntries(10);
      firestore.entries[3].entityId = 'alterado';

      const result = await service.verifyChain('kia-quito');

      expect(result.valid).toBe(false);
      expect(result.brokenAtPosition).toBe(4);
      expect(result.reason).toBe('HASH_MISMATCH');
    });

    it('detecta la eliminación de una entrada intermedia', async () => {
      await appendEntries(10);
      firestore.entries.splice(6, 1);

      const result = await service.verifyChain('kia-quito');

      expect(result.valid).toBe(false);
      expect(result.brokenAtPosition).toBe(7);
      expect(result.reason).toBe('BROKEN_LINK');
    });

    it('detecta la manipulación del hash génesis', async () => {
      await appendEntries(3);
      firestore.entries[0].prevHash = 'f'.repeat(64);
      firestore.entries[0].hash = computeEntryHash(
        (({ id: _id, hash: _hash, ...rest }) => rest)(firestore.entries[0]),
      );

      const result = await service.verifyChain('kia-quito');

      expect(result.valid).toBe(false);
      expect(result.brokenAtPosition).toBe(1);
      expect(result.reason).toBe('BAD_GENESIS');
    });
  });

  describe('superficie de la API', () => {
    it('no expone operaciones de modificación ni de borrado', () => {
      const methods = Object.getOwnPropertyNames(AuditService.prototype);

      expect(methods).toContain('append');
      expect(
        methods.some((name) => /^(update|delete|remove|patch)/.test(name)),
      ).toBe(false);
    });
  });
});
