import { Firestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { RoleEnum } from '../../src/common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../src/common/tenant/tenant-context';
import { AuditService } from '../../src/modules/audit/audit.service';
import { FirebaseService } from '../../src/firebase/firebase.service';
import { VehiclesRepository } from '../../src/modules/vehicles/vehicles.repository';

const PROJECT_ID = 'demo-kia-dealer-test';
const TENANT_A = 'kia-quito';
const TENANT_B = 'mazda-guayaquil';

const contextFor = (tenantId: string): TenantContextData => ({
  tenantId,
  userId: `user-${tenantId}`,
  role: RoleEnum.ASESOR,
  establishmentIds: [],
  platformAdmin: false,
  requestId: `req-${tenantId}`,
});

/**
 * VehiclesRepository contra Firestore real (emulado).
 *
 * Los tests unitarios usan mocks, y un mock acepta cosas que Firestore
 * rechaza — ya pasó una vez con los valores `undefined` en audit_logs. Acá se
 * ejercita lo que solo la base real puede probar: que la subcolección
 * `statusHistory` quede efectivamente aislada, que los batches respeten sus
 * límites y que `merge` preserve los campos que la importación no trae.
 */
describe('VehiclesRepository contra Firestore real', () => {
  let firestore: Firestore;
  let repository: VehiclesRepository;

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: PROJECT_ID });
    }
    firestore = admin.firestore();

    const firebase = {
      rawFirestore: () => firestore,
    } as unknown as FirebaseService;
    repository = new VehiclesRepository(firebase, new AuditService(firebase));
  });

  afterEach(async () => {
    for (const name of ['vehicles', 'audit_logs', 'audit_heads']) {
      const snapshot = await firestore.collection(name).get();
      await Promise.all(
        snapshot.docs.map(async (doc) => {
          const history = await doc.ref.collection('statusHistory').get();
          await Promise.all(history.docs.map((entry) => entry.ref.delete()));
          await doc.ref.delete();
        }),
      );
    }
  });

  afterAll(async () => {
    await admin.app().delete();
  });

  const seedVehicle = (tenantId: string, id: string) =>
    firestore
      .collection('vehicles')
      .doc(id)
      .set({ tenantId, chassis: `CH-${id}`, status: 'POR_ARRIBAR' });

  const seedHistory = (vehicleId: string, count: number) =>
    Promise.all(
      Array.from({ length: count }, (_unused, index) =>
        firestore
          .collection('vehicles')
          .doc(vehicleId)
          .collection('statusHistory')
          .add({
            status: `S${index}`,
            changedBy: 'user-1',
            changedAt: new Date(2026, 0, index + 1).toISOString(),
          }),
      ),
    );

  describe('aislamiento de la subcolección statusHistory', () => {
    it('no expone el historial de un vehículo de otro concesionario', async () => {
      await seedVehicle(TENANT_B, 'v-de-b');
      await seedHistory('v-de-b', 3);

      const history = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.getStatusHistory('v-de-b'),
      );

      expect(history).toBeNull();
    });

    it('devuelve el historial del vehículo propio, más reciente primero', async () => {
      await seedVehicle(TENANT_A, 'v-de-a');
      await seedHistory('v-de-a', 3);

      const history = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.getStatusHistory('v-de-a'),
      );

      expect(history).toHaveLength(3);
      expect(history?.[0].status).toBe('S2');
    });

    it('no escribe en el historial de un vehículo ajeno', async () => {
      await seedVehicle(TENANT_B, 'v-de-b');

      const written = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.addStatusHistory('v-de-b', {
          status: 'ENTREGADO',
          changedBy: 'intruso',
          changedAt: new Date().toISOString(),
        }),
      );

      expect(written).toBe(false);
      const stored = await firestore
        .collection('vehicles')
        .doc('v-de-b')
        .collection('statusHistory')
        .get();
      expect(stored.empty).toBe(true);
    });
  });

  describe('deleteManyWithHistory()', () => {
    it('borra el vehículo propio junto con toda su subcolección', async () => {
      await seedVehicle(TENANT_A, 'v1');
      await seedHistory('v1', 4);

      const deleted = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.deleteManyWithHistory(['v1']),
      );

      expect(deleted).toEqual(['v1']);
      expect((await firestore.collection('vehicles').doc('v1').get()).exists).toBe(
        false,
      );
      const history = await firestore
        .collection('vehicles')
        .doc('v1')
        .collection('statusHistory')
        .get();
      expect(history.empty).toBe(true);
    });

    it('deja intacto el vehículo de otro concesionario', async () => {
      await seedVehicle(TENANT_A, 'v1');
      await seedVehicle(TENANT_B, 'v-de-b');

      const deleted = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.deleteManyWithHistory(['v1', 'v-de-b']),
      );

      expect(deleted).toEqual(['v1']);
      expect(
        (await firestore.collection('vehicles').doc('v-de-b').get()).exists,
      ).toBe(true);
    });
  });

  describe('upsertMany()', () => {
    it('fuerza el tenantId del contexto aunque el payload traiga otro', async () => {
      await TenantContext.run(contextFor(TENANT_A), () =>
        repository.upsertMany([
          { id: 'v1', data: { chassis: 'ABC', tenantId: TENANT_B } },
        ]),
      );

      const stored = await firestore.collection('vehicles').doc('v1').get();
      expect(stored.data()?.tenantId).toBe(TENANT_A);
    });

    it('merge preserva los campos que la importación no trae', async () => {
      await firestore.collection('vehicles').doc('v1').set({
        tenantId: TENANT_A,
        chassis: 'ABC',
        photoUrl: 'https://foto-cargada-por-el-taller',
      });

      await TenantContext.run(contextFor(TENANT_A), () =>
        repository.upsertMany([{ id: 'v1', data: { status: 'MATRICULADO' } }]),
      );

      const stored = await firestore.collection('vehicles').doc('v1').get();
      expect(stored.data()?.photoUrl).toBe(
        'https://foto-cargada-por-el-taller',
      );
      expect(stored.data()?.status).toBe('MATRICULADO');
    });

    it('escribe un lote que supera el límite de 500 de Firestore', async () => {
      const documents = Array.from({ length: 520 }, (_unused, index) => ({
        id: `bulk-${index}`,
        data: { chassis: `CH-${index}` },
      }));

      const written = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.upsertMany(documents),
      );

      expect(written).toBe(520);
      const count = await firestore
        .collection('vehicles')
        .where('tenantId', '==', TENANT_A)
        .count()
        .get();
      expect(count.data().count).toBe(520);
    });
  });

  describe('query()', () => {
    it('la consulta base solo alcanza vehículos del concesionario activo', async () => {
      await Promise.all([
        seedVehicle(TENANT_A, 'a1'),
        seedVehicle(TENANT_A, 'a2'),
        seedVehicle(TENANT_B, 'b1'),
      ]);

      const snapshot = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.query().get(),
      );

      expect(snapshot.size).toBe(2);
      expect(
        snapshot.docs.every((doc) => doc.data().tenantId === TENANT_A),
      ).toBe(true);
    });

    it('los filtros encadenados no pueden sacar la consulta del scope', async () => {
      await Promise.all([
        seedVehicle(TENANT_A, 'a1'),
        seedVehicle(TENANT_B, 'b1'),
      ]);

      // Aunque el filtro apunte al otro concesionario, el where('tenantId')
      // ya aplicado por query() lo vuelve imposible de satisfacer.
      const snapshot = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.query().where('tenantId', '==', TENANT_B).get(),
      );

      expect(snapshot.empty).toBe(true);
    });
  });
});
