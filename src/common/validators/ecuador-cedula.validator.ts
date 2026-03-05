import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Valida una cédula de identidad ecuatoriana o un RUC.
 *
 * Tipos soportados:
 *   - Cédula persona natural: 10 dígitos (tercer dígito 0-5)
 *   - RUC persona natural:    13 dígitos (cédula + '001', tercer dígito 0-5)
 *   - RUC sociedad pública:   13 dígitos (tercer dígito = 6)
 *   - RUC sociedad privada:   13 dígitos (tercer dígito = 9)
 */
@ValidatorConstraint({ name: 'isEcuadorianCedula', async: false })
export class IsEcuadorianCedulaConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    if (typeof value !== 'string') return false;
    const clean = value.trim();

    if (!/^\d{10}$/.test(clean) && !/^\d{13}$/.test(clean)) return false;

    // Código de provincia 01–24
    const province = parseInt(clean.substring(0, 2), 10);
    if (province < 1 || province > 24) return false;

    const thirdDigit = parseInt(clean[2], 10);

    // Persona natural (cédula 10 dígitos o RUC 13 dígitos terminado en 001)
    if (thirdDigit < 6) {
      const cedula = clean.slice(0, 10);
      if (clean.length === 13 && clean.slice(10) !== '001') return false;

      const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
      let total = 0;
      for (let i = 0; i < 9; i++) {
        let val = parseInt(cedula[i], 10) * coefficients[i];
        if (val >= 10) val -= 9;
        total += val;
      }
      const expected = (10 - (total % 10)) % 10;
      return expected === parseInt(cedula[9], 10);
    }

    // RUC sociedad pública (tercer dígito = 6, 13 dígitos, sufijo 0001)
    if (thirdDigit === 6) {
      if (clean.length !== 13) return false;
      if (clean.slice(9) !== '0001') return false;

      const coefficients = [3, 2, 7, 6, 5, 4, 3, 2];
      let total = 0;
      for (let i = 0; i < 8; i++) {
        total += parseInt(clean[i], 10) * coefficients[i];
      }
      const expected = 11 - (total % 11);
      const verifier = expected === 11 ? 0 : expected;
      return verifier === parseInt(clean[8], 10);
    }

    // RUC sociedad privada (tercer dígito = 9, 13 dígitos, sufijo 001)
    if (thirdDigit === 9) {
      if (clean.length !== 13) return false;
      if (clean.slice(10) !== '001') return false;

      const coefficients = [4, 3, 2, 7, 6, 5, 4, 3, 2];
      let total = 0;
      for (let i = 0; i < 9; i++) {
        total += parseInt(clean[i], 10) * coefficients[i];
      }
      const expected = 11 - (total % 11);
      const verifier = expected === 11 ? 0 : expected;
      return verifier === parseInt(clean[9], 10);
    }

    return false;
  }

  defaultMessage(): string {
    return 'Cédula o RUC inválido. Acepta cédula (10 dígitos), RUC persona natural (13 dígitos + 001), RUC sociedad pública (tercer dígito 6) o sociedad privada (tercer dígito 9). Verifica provincia (01-24) y dígito verificador.';
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
