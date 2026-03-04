import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Valida una cédula de identidad ecuatoriana (persona natural)
 * o un RUC de persona natural (cédula válida + sufijo '001').
 *
 * Aceptado:
 *   - Cédula: 10 dígitos
 *   - RUC persona natural: 13 dígitos (10 de cédula + '001')
 *
 * Reglas para la parte de cédula (primeros 10 dígitos):
 * 1. Primeros 2 dígitos = código de provincia (01–24).
 * 2. Tercer dígito < 6 (identifica persona natural).
 * 3. Dígito verificador (posición 10) calculado con coeficientes alternos [2,1,2,1,2,1,2,1,2].
 */
@ValidatorConstraint({ name: 'isEcuadorianCedula', async: false })
export class IsEcuadorianCedulaConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    if (typeof value !== 'string') return false;
    const clean = value.trim();

    // Determinar si es cédula (10) o RUC persona natural (13)
    let cedula: string;
    if (/^\d{10}$/.test(clean)) {
      cedula = clean;
    } else if (/^\d{13}$/.test(clean) && clean.slice(10) === '001') {
      cedula = clean.slice(0, 10);
    } else {
      return false;
    }

    // Código de provincia 01–24
    const province = parseInt(cedula.substring(0, 2), 10);
    if (province < 1 || province > 24) return false;

    // Tercer dígito < 6 → persona natural
    if (parseInt(cedula[2], 10) >= 6) return false;

    // Algoritmo de verificación
    const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let total = 0;
    for (let i = 0; i < 9; i++) {
      let value = parseInt(cedula[i], 10) * coefficients[i];
      if (value >= 10) value -= 9;
      total += value;
    }
    const expectedVerifier = (10 - (total % 10)) % 10;
    return expectedVerifier === parseInt(cedula[9], 10);
  }

  defaultMessage(): string {
    return 'Cédula o RUC inválido. Acepta cédula (10 dígitos) o RUC de persona natural (13 dígitos terminados en 001). Verifica provincia (01-24), tipo (persona natural) y dígito verificador.';
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
