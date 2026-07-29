import { setWorldConstructor, World, IWorldOptions } from '@cucumber/cucumber';

const FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
// El prefijo "demo-" es la convención de Firebase para proyectos que solo
// existen dentro del emulador: no requiere credenciales ni puede tocar por
// accidente el proyecto real declarado en .firebaserc.
export const TEST_PROJECT_ID =
  process.env.GCLOUD_PROJECT ?? 'demo-kia-dealer-test';

/**
 * Estado compartido entre los pasos de un mismo escenario. Cada escenario
 * recibe una instancia nueva (comportamiento por defecto de Cucumber), así
 * que no hay fuga de estado entre escenarios.
 *
 * Los pasos concretos (Given/When/Then) se implementan junto con el módulo
 * que prueban, en la fase que lo construye — ver docs/design/README.md §7.
 * Este World solo provee la infraestructura común: acceso HTTP a los
 * emuladores y una bolsa de atributos tipada para pasar datos entre pasos.
 */
export class KiaDealerWorld extends World {
  /** Última respuesta HTTP capturada por un paso "Cuando ...". */
  lastResponse?: { status: number; body: unknown };

  /** Último error capturado, para pasos "Entonces ... lanza un error". */
  lastError?: unknown;

  /** Bolsa genérica para datos que un paso deja y otro paso lee. */
  private readonly context = new Map<string, unknown>();

  set<T>(key: string, value: T): void {
    this.context.set(key, value);
  }

  get<T>(key: string): T {
    if (!this.context.has(key)) {
      throw new Error(
        `El escenario no tiene "${key}" en contexto. ¿Falta un paso "Dado" que lo prepare?`,
      );
    }
    return this.context.get(key) as T;
  }

  has(key: string): boolean {
    return this.context.has(key);
  }

  /** Borra todos los documentos de Firestore en el proyecto de prueba. */
  async clearFirestore(): Promise<void> {
    const url = `http://${FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`;
    await fetch(url, { method: 'DELETE' });
  }

  /** Borra todos los usuarios de Firebase Auth en el proyecto de prueba. */
  async clearAuthUsers(): Promise<void> {
    const url = `http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${TEST_PROJECT_ID}/accounts`;
    await fetch(url, { method: 'DELETE' });
  }

  /** Verifica que ambos emuladores respondan antes de correr la suite. */
  static async assertEmulatorsRunning(): Promise<void> {
    const checks = [
      { name: 'Firestore', url: `http://${FIRESTORE_EMULATOR_HOST}/` },
      { name: 'Auth', url: `http://${AUTH_EMULATOR_HOST}/` },
    ];

    for (const check of checks) {
      try {
        await fetch(check.url);
      } catch {
        throw new Error(
          `El emulador de ${check.name} no responde en ${check.url}. ` +
            'Corré la suite con "npm run test:bdd" (envuelve firebase emulators:exec) ' +
            'en vez de invocar cucumber-js directamente.',
        );
      }
    }
  }
}

setWorldConstructor(KiaDealerWorld);

export type { IWorldOptions };
