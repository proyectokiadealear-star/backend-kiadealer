import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  assertFails,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

/**
 * Verifica que firestore.rules cierra el acceso directo del cliente en
 * cualquier colección. Este es el control que protege contra un cliente que
 * obtenga credenciales de Firebase Auth e intente saltarse el backend.
 *
 * No cubre el aislamiento entre tenants — eso vive en el backend (ver
 * TenantScopedRepository, Fase 1) porque el Admin SDK ignora estas reglas.
 * Ver docs/design/01-multi-tenancy.md y docs/design/02-auditoria.md D-201.
 */
describe('firestore.rules — acceso directo del cliente', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-kia-dealer-rules-test',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  const collectionsDeNegocio = [
    'vehicles',
    'certifications',
    'documentations',
    'serviceOrders',
    'appointments',
    'users',
    'notifications',
    'audit_logs',
  ];

  it.each(collectionsDeNegocio)(
    'niega la lectura no autenticada de %s',
    async (collectionName) => {
      const unauthedDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(doc(unauthedDb, collectionName, 'cualquier-id')),
      );
    },
  );

  it.each(collectionsDeNegocio)(
    'niega la escritura no autenticada en %s',
    async (collectionName) => {
      const unauthedDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(unauthedDb, collectionName, 'cualquier-id'), { x: 1 }),
      );
    },
  );

  it.each(collectionsDeNegocio)(
    'niega la lectura autenticada de %s — el backend es la única puerta',
    async (collectionName) => {
      const authedDb = testEnv
        .authenticatedContext('usuario-de-prueba', { role: 'JEFE_TALLER' })
        .firestore();
      await assertFails(getDoc(doc(authedDb, collectionName, 'cualquier-id')));
    },
  );

  it('niega la escritura incluso con un claim de tenant válido', async () => {
    const authedDb = testEnv
      .authenticatedContext('usuario-de-prueba', {
        tenantId: 'kia-quito',
        role: 'ASESOR',
      })
      .firestore();
    await assertFails(
      setDoc(doc(authedDb, 'vehicles', 'v1'), {
        tenantId: 'kia-quito',
        model: 'Sportage',
      }),
    );
  });
});
