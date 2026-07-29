import { createHash } from 'node:crypto';
import { AuditEntry } from './audit.types';

/** Campos que entran en el hash. Excluye `id` y `hash`, que no existen aún. */
type HashableEntry = Omit<AuditEntry, 'id' | 'hash'>;

/**
 * Serializa un valor de forma determinista: mismas claves y mismos datos
 * producen siempre la misma cadena, sin importar el orden de inserción.
 *
 * `JSON.stringify` respeta el orden de inserción de las claves, así que dos
 * objetos equivalentes con distinto orden darían hashes distintos y el
 * verificador reportaría una ruptura falsa.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, fieldValue]) =>
        `${JSON.stringify(key)}:${canonicalize(fieldValue)}`,
    );

  return `{${entries.join(',')}}`;
}

/**
 * Calcula el hash de una entrada encadenándola con la anterior.
 *
 * Cualquier alteración del contenido —o la desaparición de una entrada
 * intermedia— rompe la cadena y el verificador lo detecta. Esta es la
 * garantía real de inmutabilidad: las reglas de Firestore no sirven porque
 * el Admin SDK las ignora. Ver docs/design/02-auditoria.md D-201.
 */
export function computeEntryHash(entry: HashableEntry): string {
  return createHash('sha256')
    .update(entry.prevHash)
    .update(canonicalize(entry))
    .digest('hex');
}

/** Huella de un dato personal, para detectar cambios sin almacenar el valor. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}
