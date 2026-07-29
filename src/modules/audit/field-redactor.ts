import { AuditPayload, RedactedValue } from './audit.types';
import { fingerprint } from './hash-chain';

/**
 * Campos con datos personales bajo la LOPDP. Nunca se almacenan en claro en
 * `audit_logs`: la retención de la auditoría es de 7 años y guardar la cédula
 * de un cliente durante ese plazo crea una obligación que nadie pidió.
 */
const DEFAULT_PII_FIELDS = [
  'cedula',
  'ruc',
  'telefono',
  'celular',
  'email',
  'correo',
  'direccion',
] as const;

function isPiiField(fieldName: string, piiFields: readonly string[]): boolean {
  const normalized = fieldName.toLowerCase();
  return piiFields.some(
    (pii) => normalized === pii || normalized.endsWith(pii),
  );
}

function redactValue(value: unknown): RedactedValue {
  return { redacted: true, fingerprint: fingerprint(value) };
}

/**
 * Sustituye los datos personales por su huella, de forma recursiva.
 *
 * La huella permite responder "¿cambió este campo entre el antes y el
 * después?" sin conservar el dato. Cuando un cliente ejerce el derecho de
 * supresión, se borra el dato de las colecciones de negocio y la auditoría
 * sigue siendo verificable porque nunca lo tuvo.
 */
export function redactPii(
  payload: AuditPayload | undefined,
  piiFields: readonly string[] = DEFAULT_PII_FIELDS,
): AuditPayload | undefined {
  if (!payload) return undefined;

  const result: AuditPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    if (isPiiField(key, piiFields)) {
      result[key] = redactValue(value);
      continue;
    }

    if (Array.isArray(value)) {
      // `Array.isArray` sobre `unknown` estrecha a `any[]`; el cast explícito
      // a `unknown[]` mantiene el tipado estricto dentro del map.
      result[key] = (value as unknown[]).map((item: unknown) =>
        item !== null && typeof item === 'object'
          ? redactPii(item as AuditPayload, piiFields)
          : item,
      );
      continue;
    }

    if (value !== null && typeof value === 'object') {
      result[key] = redactPii(value as AuditPayload, piiFields);
      continue;
    }

    result[key] = value;
  }

  return result;
}

export { DEFAULT_PII_FIELDS };
