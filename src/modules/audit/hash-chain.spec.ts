import { RoleEnum } from '../../common/enums/role.enum';
import { AuditEntry, GENESIS_HASH } from './audit.types';
import { canonicalize, computeEntryHash, fingerprint } from './hash-chain';

type HashableEntry = Omit<AuditEntry, 'id' | 'hash'>;

const makeEntry = (overrides: Partial<HashableEntry> = {}): HashableEntry => ({
  tenantId: 'kia-quito',
  actorUid: 'user-1',
  actorRole: RoleEnum.ASESOR,
  requestId: 'req-1',
  at: '2026-07-28T00:00:00.000Z',
  action: 'VEHICLE_STATUS_CHANGED',
  entity: 'vehicles',
  entityId: 'v1',
  prevHash: GENESIS_HASH,
  ...overrides,
});

describe('canonicalize', () => {
  it('produce la misma salida sin importar el orden de las claves', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
  });

  it('distingue objetos con valores distintos', () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });

  it('ordena claves anidadas de forma recursiva', () => {
    expect(canonicalize({ x: { b: 2, a: 1 } })).toBe(
      canonicalize({ x: { a: 1, b: 2 } }),
    );
  });

  it('preserva el orden de los arreglos', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('ignora las claves con valor undefined', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it('trata null y undefined como el mismo literal', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(undefined)).toBe('null');
  });
});

describe('computeEntryHash', () => {
  it('es determinista para la misma entrada', () => {
    const entry = makeEntry();
    expect(computeEntryHash(entry)).toBe(computeEntryHash(entry));
  });

  it('devuelve un sha256 en hexadecimal', () => {
    expect(computeEntryHash(makeEntry())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cambia si cambia el contenido de la entrada', () => {
    const original = computeEntryHash(makeEntry());
    const alterada = computeEntryHash(makeEntry({ entityId: 'v2' }));
    expect(alterada).not.toBe(original);
  });

  it('cambia si cambia el prevHash — es lo que encadena', () => {
    const primera = computeEntryHash(makeEntry({ prevHash: GENESIS_HASH }));
    const segunda = computeEntryHash(makeEntry({ prevHash: 'a'.repeat(64) }));
    expect(segunda).not.toBe(primera);
  });

  it('no depende del orden en que se construyó el objeto', () => {
    const base = makeEntry();
    const reordenada = {
      prevHash: base.prevHash,
      entityId: base.entityId,
      entity: base.entity,
      action: base.action,
      at: base.at,
      requestId: base.requestId,
      actorRole: base.actorRole,
      actorUid: base.actorUid,
      tenantId: base.tenantId,
    } as HashableEntry;

    expect(computeEntryHash(reordenada)).toBe(computeEntryHash(base));
  });
});

describe('fingerprint', () => {
  it('devuelve la misma huella para el mismo valor', () => {
    expect(fingerprint('1712345678')).toBe(fingerprint('1712345678'));
  });

  it('devuelve huellas distintas para valores distintos', () => {
    expect(fingerprint('1712345678')).not.toBe(fingerprint('1712345679'));
  });

  it('no contiene el valor original', () => {
    expect(fingerprint('1712345678')).not.toContain('1712345678');
  });
});
