import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Valida una cédula de identidad ecuatoriana (persona natural).
 *
 * Reglas:
 * 1. Exactamente 10 dígitos numéricos.
 * 2. Primeros 2 dígitos = código de provincia (01–24).
 * 3. Tercer dígito < 6 (identifica persona natural).
 * 4. Dígito verificador (posición 10) calculado con coeficientes alternos [2,1,2,1,2,1,2,1,2].
 */
@ValidatorConstraint({ name: 'isEcuadorianCedula', async: false })
export class IsEcuadorianCedulaConstraint implements ValidatorConstraintInterface {
  validate(cedula: string): boolean {
    if (typeof cedula !== 'string') return false;
    const clean = cedula.trim();

    // Debe ser exactamente 10 dígitos
    if (!/^\d{10}$/.test(clean)) return false;

    // Código de provincia 01–24
    const province = parseInt(clean.substring(0, 2), 10);
    if (province < 1 || province > 24) return false;

    // Tercer dígito < 6 → persona natural
    if (parseInt(clean[2], 10) >= 6) return false;

    // Algoritmo de verificación
    const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let total = 0;
    for (let i = 0; i < 9; i++) {
      let value = parseInt(clean[i], 10) * coefficients[i];
      if (value >= 10) value -= 9;
      total += value;
    }
    const expectedVerifier = (10 - (total % 10)) % 10;
    return expectedVerifier === parseInt(clean[9], 10);
  }

  defaultMessage(): string {
    return 'Cédula ecuatoriana inválida. Verifica provincia (01-24), tipo (persona natural) y dígito verificador.';
  }
}

export function IsEcuadorianCedula(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsEcuadorianCedulaConstraint,
    });
  };
}
