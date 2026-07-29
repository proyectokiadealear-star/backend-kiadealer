import { RedactedValue } from './audit.types';
import { redactPii } from './field-redactor';

const asRedacted = (value: unknown): RedactedValue => value as RedactedValue;

describe('redactPii', () => {
  it('devuelve undefined si no hay payload', () => {
    expect(redactPii(undefined)).toBeUndefined();
  });

  it('sustituye la cédula por una huella', () => {
    const result = redactPii({ cedula: '1712345678' });

    expect(asRedacted(result?.cedula).redacted).toBe(true);
    expect(asRedacted(result?.cedula).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no conserva el valor original en ningún lugar del resultado', () => {
    const result = redactPii({ cedula: '1712345678', telefono: '0991234567' });

    expect(JSON.stringify(result)).not.toContain('1712345678');
    expect(JSON.stringify(result)).not.toContain('0991234567');
  });

  it('deja intactos los campos que no son datos personales', () => {
    const result = redactPii({ model: 'Sportage', status: 'ENTREGADO' });

    expect(result).toEqual({ model: 'Sportage', status: 'ENTREGADO' });
  });

  it('detecta campos por sufijo, no solo por nombre exacto', () => {
    const result = redactPii({ clienteCedula: '1712345678' });

    expect(asRedacted(result?.clienteCedula).redacted).toBe(true);
  });

  it('es insensible a mayúsculas', () => {
    const result = redactPii({ CEDULA: '1712345678' });

    expect(asRedacted(result?.CEDULA).redacted).toBe(true);
  });

  it('redacta de forma recursiva en objetos anidados', () => {
    const result = redactPii({
      cliente: { nombre: 'Ana', cedula: '1712345678' },
    });
    const cliente = result?.cliente as Record<string, unknown>;

    expect(cliente.nombre).toBe('Ana');
    expect(asRedacted(cliente.cedula).redacted).toBe(true);
  });

  it('redacta dentro de arreglos de objetos', () => {
    const result = redactPii({ contactos: [{ email: 'a@b.com' }] });
    const contactos = result?.contactos as Record<string, unknown>[];

    expect(asRedacted(contactos[0].email).redacted).toBe(true);
  });

  it('deja los arreglos de primitivos intactos', () => {
    const result = redactPii({ tags: ['nuevo', 'usado'] });

    expect(result?.tags).toEqual(['nuevo', 'usado']);
  });

  it('la huella permite detectar si el campo cambió entre antes y después', () => {
    const antes = redactPii({ cedula: '1712345678' });
    const igual = redactPii({ cedula: '1712345678' });
    const distinto = redactPii({ cedula: '0987654321' });

    expect(asRedacted(igual?.cedula).fingerprint).toBe(
      asRedacted(antes?.cedula).fingerprint,
    );
    expect(asRedacted(distinto?.cedula).fingerprint).not.toBe(
      asRedacted(antes?.cedula).fingerprint,
    );
  });

  it('acepta una lista de campos personalizada', () => {
    const result = redactPii({ placa: 'PXY-1234' }, ['placa']);

    expect(asRedacted(result?.placa).redacted).toBe(true);
  });

  it('maneja valores nulos sin romper', () => {
    expect(redactPii({ model: null })).toEqual({ model: null });
  });
});
