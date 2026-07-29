import { Firestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { RoleEnum } from '../../src/common/enums/role.enum';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../src/common/repositories/tenant-scoped.repository';
import {
  TenantContext,
  TenantContextData,
} from '../../src/common/tenant/tenant-context';
import { AuditService } from '../../src/modules/audit/audit.service';
import { FirebaseService } from '../../src/firebase/firebase.service';

const PROJECT_ID = 'demo-kia-dealer-test';
const TENANT_A = 'kia-quito';
const TENANT_B = 'mazda-guayaquil';

interface TestVehicle extends TenantScopedDocument {
  model?: string;
  status?: string;
}

class VehicleRepository extends TenantScopedRepository<TestVehicle> {
  protected readonly collectionName = 'vehicles';
}

const contextFor = (tenantId: string): TenantContextData => ({
  tenantId,
  userId: `user-${tenantId}`,
  role: RoleEnum.ASESOR,
  establishmentIds: [],
  platformAdmin: false,
  requestId: `req-${tenantId}`,
});

/**
 * Aislamiento entre concesionarios contra Firestore real (emulado).
 *
 * A diferencia de los tests unitarios, que mockean Firestore, esto ejercita
 * las consultas de verdad: verifica que el `where` compuesto funcione, que
 * los cursores no salten de tenant y que la cadena de auditoría se escriba
 * transaccionalmente. Es el criterio de salida de la Fase 1 — REQ-001.
 */
describe('Aislamiento entre concesionarios (emulador)', () => {
  let firestore: Firestore;
  let repository: VehicleRepository;
  let audit: AuditService;

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: PROJECT_ID });
    }
    firestore = admin.firestore();

    const firebase = {
      rawFirestore: () => firestore,
    } as unknown as FirebaseService;
    audit = new AuditService(firebase);
    repository = new VehicleRepository(firebase, audit);
  });

  afterEach(async () => {
    await Promise.all(
      ['vehicles', 'audit_logs', 'audit_heads'].map(async (name) => {
        const snapshot = await firestore.collection(name).get();
        await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
      }),
    );
  });

  afterAll(async () => {
    await admin.app().delete();
  });

  const seedVehicle = (tenantId: string, id: string, model = 'Sportage') =>
    firestore.collection('vehicles').doc(id).set({ tenantId, model });

  describe('lectura', () => {
    it('findById() de un vehículo ajeno devuelve null', async () => {
      await seedVehicle(TENANT_B, 'v-de-b');

      const result = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.findById('v-de-b'),
      );

      expect(result).toBeNull();
    });

    it('findById() de un vehículo propio lo devuelve', async () => {
      await seedVehicle(TENANT_A, 'v-de-a', 'Rio');

      const result = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.findById('v-de-a'),
      );

      expect(result?.model).toBe('Rio');
    });

    it('findAll() solo devuelve los del propio concesionario', async () => {
      await Promise.all([
        seedVehicle(TENANT_A, 'a1'),
        seedVehicle(TENANT_A, 'a2'),
        seedVehicle(TENANT_A, 'a3'),
        seedVehicle(TENANT_B, 'b1'),
        seedVehicle(TENANT_B, 'b2'),
      ]);

      const result = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.findAll(),
      );

      expect(result).toHaveLength(3);
      expect(result.every((vehicle) => vehicle.tenantId === TENANT_A)).toBe(
        true,
      );
    });

    it('cada concesionario ve exactamente lo suyo', async () => {
      await Promise.all([
        seedVehicle(TENANT_A, 'a1'),
        seedVehicle(TENANT_B, 'b1'),
      ]);

      const fromA = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.findAll(),
      );
      const fromB = await TenantContext.run(contextFor(TENANT_B), () =>
        repository.findAll(),
      );

      expect(fromA.map((v) => v.id)).toEqual(['a1']);
      expect(fromB.map((v) => v.id)).toEqual(['b1']);
    });
  });

  describe('escritura', () => {
    it('create() ignora un tenantId ajeno en el payload — REQ-004', async () => {
      await TenantContext.run(contextFor(TENANT_A), () =>
        repository.create(
          { model: 'Sportage', tenantId: TENANT_B } as never,
          'nuevo',
        ),
      );

      const stored = await firestore.collection('vehicles').doc('nuevo').get();
      expect(stored.data()?.tenantId).toBe(TENANT_A);
    });

    it('update() no modifica un vehículo ajeno', async () => {
      await seedVehicle(TENANT_B, 'v-de-b', 'CX-5');

      const result = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.update('v-de-b', { model: 'ALTERADO' }),
      );

      expect(result).toBeNull();
      const stored = await firestore.collection('vehicles').doc('v-de-b').get();
      expect(stored.data()?.model).toBe('CX-5');
    });

    it('delete() no borra un vehículo ajeno', async () => {
      await seedVehicle(TENANT_B, 'v-de-b');

      const deleted = await TenantContext.run(contextFor(TENANT_A), () =>
        repository.delete('v-de-b'),
      );

      expect(deleted).toBe(false);
      expect(
        (await firestore.collection('vehicles').doc('v-de-b').get()).exists,
      ).toBe(true);
    });
  });

  describe('auditoría del intento cruzado', () => {
    it('registra el intento en la cadena del tenant que lo hizo', async () => {
      await seedVehicle(TENANT_B, 'v-de-b');

      await TenantContext.run(contextFor(TENANT_A), () =>
        repository.findById('v-de-b'),
      );

      const logs = await firestore
        .collection('audit_logs')
        .where('tenantId', '==', TENANT_A)
        .get();

      expect(logs.size).toBe(1);
      expect(logs.docs[0].data()).toEqual(
        expect.objectContaining({
          action: 'CROSS_TENANT_ACCESS_ATTEMPT',
          tenantId: TENANT_A,
          entityId: 'v-de-b',
        }),
      );
    });

    it('el concesionario dueño no recibe la entrada', async () => {
      await seedVehicle(TENANT_B, 'v-de-b');

      await TenantContext.run(contextFor(TENANT_A), () =>
        repository.findById('v-de-b'),
      );

      const logsOfB = await firestore
        .collection('audit_logs')
        .where('tenantId', '==', TENANT_B)
        .get();

      expect(logsOfB.empty).toBe(true);
    });
  });

  describe('cadena de auditoría sobre Firestore real', () => {
    it('escrituras concurrentes producen una cadena única y verificable', async () => {
      await TenantContext.run(contextFor(TENANT_A), async () => {
        await Promise.all(
          Array.from({ length: 15 }, (_unused, index) =>
            audit.append({
              action: 'VEHICLE_STATUS_CHANGED',
              entity: 'vehicles',
              entityId: `v${index}`,
            }),
          ),
        );
      });

      const result = await audit.verifyChain(TENANT_A);

      expect(result.entriesChecked).toBe(15);
      expect(result.valid).toBe(true);
    });

    it('las cadenas de dos concesionarios son independientes', async () => {
      await TenantContext.run(contextFor(TENANT_A), () =>
        audit.append({ action: 'X', entity: 'vehicles', entityId: 'a1' }),
      );
      await TenantContext.run(contextFor(TENANT_B), () =>
        audit.append({ action: 'X', entity: 'vehicles', entityId: 'b1' }),
      );

      await expect(audit.verifyChain(TENANT_A)).resolves.toEqual({
        valid: true,
        entriesChecked: 1,
      });
      await expect(audit.verifyChain(TENANT_B)).resolves.toEqual({
        valid: true,
        entriesChecked: 1,
      });
    });

    it('detecta la alteración de una entrada ya persistida', async () => {
      await TenantContext.run(contextFor(TENANT_A), async () => {
        for (let index = 0; index < 5; index += 1) {
          await audit.append({
            action: 'VEHICLE_STATUS_CHANGED',
            entity: 'vehicles',
            entityId: `v${index}`,
          });
        }
      });

      const logs = await firestore
        .collection('audit_logs')
        .where('tenantId', '==', TENANT_A)
        .orderBy('at', 'asc')
        .get();
      await logs.docs[2].ref.update({ entityId: 'alterado' });

      const result = await audit.verifyChain(TENANT_A);

      expect(result.valid).toBe(false);
      expect(result.brokenAtPosition).toBe(3);
    });
  });
});
