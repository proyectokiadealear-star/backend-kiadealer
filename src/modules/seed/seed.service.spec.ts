import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SeedService } from './seed.service';
import { SeedUsersRepository } from './seed-users.repository';
import { CertificationsRepository } from '../certifications/certifications.repository';
import { DocumentationRepository } from '../documentation/documentation.repository';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { ServiceOrdersRepository } from '../service-orders/service-orders.repository';
import { AppointmentsRepository } from '../appointments/appointments.repository';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { TenantStatus } from '../tenants/tenant.types';
import { createFakeFirestore, FakeFirestore } from './test-fake-firestore';

/**
 * SeedService orquesta repositorios REALES (TenantScopedRepository) en vez
 * de tocar Firestore directo — ver el comentario de diseño al tope de
 * seed.service.ts. Por eso estos tests construyen los repositorios reales
 * contra un Firestore en memoria (`createFakeFirestore()`, ver
 * test-fake-firestore.ts) en vez de mockear cada llamada: es la única forma
 * de probar de verdad que el borrado masivo no cruza tenants — el
 * comportamiento importa acá es el que resulta de encadenar
 * runSeedPlatformOperation → TenantContext → scopedQuery(), no una
 * aserción sobre qué mock se llamó.
 */
describe('SeedService', () => {
  const SECRET = 'kia-seed-2024';
  const activeTenant = (id: string) => ({
    id,
    name: id,
    ruc: '1790000000001',
    status: TenantStatus.ACTIVE,
    plan: 'pro',
    createdAt: new Date(),
  });

  let fake: FakeFirestore;
  let firebase: {
    rawFirestore: () => FakeFirestore;
    serverTimestamp: () => string;
    auth: () => {
      getUserByEmail: jest.Mock;
      createUser: jest.Mock;
      setCustomUserClaims: jest.Mock;
    };
  };
  let audit: { append: jest.Mock; recordCrossTenantAttempt: jest.Mock };
  let tenants: { findById: jest.Mock };
  let config: { get: jest.Mock };
  let service: SeedService;

  beforeEach(() => {
    fake = createFakeFirestore();
    firebase = {
      rawFirestore: () => fake,
      serverTimestamp: () => 'mock-ts',
      auth: () => ({
        getUserByEmail: jest
          .fn()
          .mockRejectedValue({ code: 'auth/user-not-found' }),
        createUser: jest.fn().mockResolvedValue({ uid: 'new-uid' }),
        setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
      }),
    };
    audit = {
      append: jest.fn().mockResolvedValue(undefined),
      recordCrossTenantAttempt: jest.fn().mockResolvedValue(undefined),
    };
    tenants = {
      findById: jest.fn().mockImplementation(async (id: string) =>
        id === 'kia-quito' || id === 'mazda-guayaquil'
          ? activeTenant(id)
          : null,
      ),
    };
    config = { get: jest.fn().mockReturnValue(SECRET) };

    service = new SeedService(
      firebase as never,
      config as unknown as ConfigService,
      tenants as never,
      audit as never,
      new SeedUsersRepository(firebase as never, audit as never),
      new CertificationsRepository(firebase as never, audit as never),
      new DocumentationRepository(firebase as never, audit as never),
      new VehiclesRepository(firebase as never, audit as never),
      new ServiceOrdersRepository(firebase as never, audit as never),
      new AppointmentsRepository(firebase as never, audit as never),
      new DeliveryRepository(firebase as never, audit as never),
      new NotificationsRepository(firebase as never, audit as never),
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  describe('guard de secretKey', () => {
    it('rechaza runSeed con secretKey inválida sin tocar tenants', async () => {
      await expect(
        service.runSeed('clave-incorrecta', 'kia-quito'),
      ).rejects.toThrow(ForbiddenException);

      expect(tenants.findById).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe('tenantId obligatorio en cada endpoint', () => {
    it('runSeed rechaza sin tenantId', async () => {
      await expect(service.runSeed(SECRET, '')).rejects.toThrow(
        /tenantId es obligatorio/,
      );
    });

    it('runSeed rechaza un tenant inexistente', async () => {
      await expect(
        service.runSeed(SECRET, 'tenant-fantasma'),
      ).rejects.toThrow(/No existe el concesionario/);
    });

    it('resetToPorArribar rechaza sin tenantId', async () => {
      await expect(
        service.resetToPorArribar(SECRET, ''),
      ).rejects.toThrow(/tenantId es obligatorio/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe('borrado masivo (clear) — no cruza tenants', () => {
    const seedCrossTenantData = async () => {
      // vehicles + statusHistory (subcolección)
      await fake
        .collection('vehicles')
        .doc('veh-kia')
        .set({ tenantId: 'kia-quito', chassis: 'V-KIA', status: 'POR_ARRIBAR' });
      await fake
        .collection('vehicles')
        .doc('veh-kia')
        .collection('statusHistory')
        .add({ status: 'POR_ARRIBAR', changedAt: 't1' });

      await fake
        .collection('vehicles')
        .doc('veh-mazda')
        .set({ tenantId: 'mazda-guayaquil', chassis: 'V-MAZDA', status: 'POR_ARRIBAR' });
      await fake
        .collection('vehicles')
        .doc('veh-mazda')
        .collection('statusHistory')
        .add({ status: 'POR_ARRIBAR', changedAt: 't1' });

      // resto de colecciones tocadas por clearCollections()
      const rest: Array<[string, string]> = [
        ['certifications', 'cert'],
        ['documentations', 'doc'],
        ['service-orders', 'order'],
        ['appointments', 'apt'],
        ['deliveryCeremonies', 'delivery'],
        ['notifications', 'notif'],
      ];
      for (const [collection, prefix] of rest) {
        await fake
          .collection(collection)
          .doc(`${prefix}-kia`)
          .set({ tenantId: 'kia-quito', marker: 'kia' });
        await fake
          .collection(collection)
          .doc(`${prefix}-mazda`)
          .set({ tenantId: 'mazda-guayaquil', marker: 'mazda' });
      }

      // catálogos — subcolección compartida entre tenants
      await fake
        .collection('catalogs/colors/items')
        .doc('kia-quito__rojo')
        .set({ tenantId: 'kia-quito', name: 'ROJO' });
      await fake
        .collection('catalogs/colors/items')
        .doc('mazda-guayaquil__rojo')
        .set({ tenantId: 'mazda-guayaquil', name: 'ROJO' });
    };

    it('runSeed({clear:true}) borra SOLO los documentos del tenant activo', async () => {
      await seedCrossTenantData();

      await service.runSeed(SECRET, 'kia-quito', { clear: true });

      // vehicles — kia borrado, mazda intacto
      expect(fake.dump('vehicles').map((d) => d.id)).toEqual(['veh-mazda']);
      expect(fake.dump('vehicles/veh-kia/statusHistory')).toEqual([]);
      expect(fake.dump('vehicles/veh-mazda/statusHistory')).toHaveLength(1);

      // resto de colecciones — mismo patrón: kia fuera, mazda intacto
      for (const collection of [
        'certifications',
        'documentations',
        'service-orders',
        'appointments',
        'deliveryCeremonies',
        'notifications',
      ]) {
        const remaining = fake.dump(collection);
        expect(remaining.every((d) => d.data['tenantId'] === 'mazda-guayaquil')).toBe(
          true,
        );
        expect(remaining.some((d) => d.data['tenantId'] === 'kia-quito')).toBe(
          false,
        );
      }

      // catálogos compartidos — el id de mazda no se toca
      const colors = fake.dump('catalogs/colors/items');
      expect(colors.map((d) => d.id)).toEqual(['mazda-guayaquil__rojo']);
    });

    it('runSeed({clear:true}) para mazda-guayaquil deja kia-quito intacto (simétrico)', async () => {
      await seedCrossTenantData();

      await service.runSeed(SECRET, 'mazda-guayaquil', { clear: true });

      expect(fake.dump('vehicles').map((d) => d.id)).toEqual(['veh-kia']);
      expect(fake.dump('vehicles/veh-mazda/statusHistory')).toEqual([]);
      expect(fake.dump('vehicles/veh-kia/statusHistory')).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe('resetToPorArribar', () => {
    const seedCertifiedVehicle = async (tenantId: string, id: string) => {
      await fake.collection('vehicles').doc(id).set({
        tenantId,
        chassis: `chassis-${id}`,
        status: VehicleStatus.CERTIFICADO_STOCK,
        sede: 'SURMOTOR',
      });
      await fake
        .collection('certifications')
        .doc(id)
        .set({ tenantId, vehicleId: id });
      await fake
        .collection('documentations')
        .doc(id)
        .set({ tenantId, vehicleId: id });
    };

    it('resetea el vehículo del tenant activo y limpia cert/doc asociadas', async () => {
      await seedCertifiedVehicle('kia-quito', 'veh-kia');
      await seedCertifiedVehicle('mazda-guayaquil', 'veh-mazda');

      const result = await service.resetToPorArribar(SECRET, 'kia-quito');

      expect(result.reset).toBe(1);
      expect(fake.dump('vehicles').find((d) => d.id === 'veh-kia')?.data)
        .toMatchObject({ status: VehicleStatus.POR_ARRIBAR });
      expect(fake.dump('certifications').map((d) => d.id)).not.toContain(
        'veh-kia',
      );
      expect(fake.dump('documentations').map((d) => d.id)).not.toContain(
        'veh-kia',
      );
      expect(fake.dump('vehicles/veh-kia/statusHistory')).toHaveLength(1);

      // el vehículo de otro tenant, en el mismo estado, no se toca
      expect(fake.dump('vehicles').find((d) => d.id === 'veh-mazda')?.data)
        .toMatchObject({ status: VehicleStatus.CERTIFICADO_STOCK });
      expect(fake.dump('certifications').map((d) => d.id)).toContain(
        'veh-mazda',
      );
      expect(fake.dump('documentations').map((d) => d.id)).toContain(
        'veh-mazda',
      );
    });

    it('no hace nada si el tenant activo no tiene vehículos en CERTIFICADO_STOCK', async () => {
      await seedCertifiedVehicle('mazda-guayaquil', 'veh-mazda');

      const result = await service.resetToPorArribar(SECRET, 'kia-quito');

      expect(result).toEqual({ total: 0, reset: 0, details: [] });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe('runSeedUsers', () => {
    it('crea el jefe de taller y le asigna tenantId en los claims', async () => {
      const result = await service.runSeedUsers(SECRET, 'kia-quito');

      expect(result).toMatchObject({ created: true, uid: 'new-uid' });
      expect(firebase.auth().setCustomUserClaims).not.toHaveBeenCalled(); // auth() nuevo por llamada en este mock

      const users = fake.dump('users');
      expect(users).toHaveLength(1);
      expect(users[0].data).toMatchObject({
        tenantId: 'kia-quito',
        uid: 'new-uid',
        role: 'JEFE_TALLER',
      });
    });

    it('rechaza sin tenantId antes de tocar Firebase Auth', async () => {
      const authSpy = jest.spyOn(firebase, 'auth');

      await expect(service.runSeedUsers(SECRET, '')).rejects.toThrow(
        /tenantId es obligatorio/,
      );

      expect(authSpy).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe('inspectFile — no toca Firestore ni exige tenantId', () => {
    it('devuelve columnas y muestra sin escribir nada', async () => {
      const csv = 'chassis,model\nABC123,KIA RIO\n';
      const result = await service.inspectFile(
        Buffer.from(csv, 'utf8'),
        'text/csv',
        SECRET,
      );

      expect(result.columns).toEqual(['chassis', 'model']);
      expect(result.sample).toHaveLength(1);
      expect(fake.dump('vehicles')).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe('seedFromExcel — cascada completa de un vehículo ENTREGADO', () => {
    it('crea vehículo, certificación, documentación, OT, agendamiento y entrega — todo con tenantId', async () => {
      const csv =
        'chassis,model,year,color,sede,status,clientName,clientId,clientPhone,paymentMethod\n' +
        'VIN12345678901234,KIA RIO,2024,ROJO,SURMOTOR,ENTREGADO,JUAN PEREZ,1234567890,0991234567,CONTADO\n';

      const result = await service.seedFromExcel(
        Buffer.from(csv, 'utf8'),
        'text/csv',
        SECRET,
        'kia-quito',
      );

      expect(result.created).toBe(1);
      expect(result.skippedRows).toBe(0);

      const vehicles = fake.dump('vehicles');
      expect(vehicles).toHaveLength(1);
      const vehicleId = vehicles[0].id;
      expect(vehicles[0].data).toMatchObject({
        tenantId: 'kia-quito',
        chassis: 'VIN12345678901234',
        status: VehicleStatus.ENTREGADO,
      });

      expect(fake.dump('certifications').map((d) => d.id)).toContain(
        vehicleId,
      );
      expect(fake.dump('documentations').map((d) => d.id)).toContain(
        vehicleId,
      );
      expect(
        fake.dump('service-orders').filter((d) => d.data['vehicleId'] === vehicleId),
      ).toHaveLength(1);
      const appointment = fake
        .dump('appointments')
        .find((d) => d.data['vehicleId'] === vehicleId);
      expect(appointment?.data).toMatchObject({ status: 'ENTREGADO' }); // seedDelivery lo actualiza
      expect(fake.dump('deliveryCeremonies').map((d) => d.id)).toContain(
        vehicleId,
      );
      expect(fake.dump(`vehicles/${vehicleId}/statusHistory`)).toHaveLength(1);
    });

    it('es idempotente: reimportar el mismo chasis no duplica el vehículo', async () => {
      const csv =
        'chassis,model,year,color,sede,status,clientName,clientId,clientPhone,paymentMethod\n' +
        'VIN12345678901234,KIA RIO,2024,ROJO,SURMOTOR,POR_ARRIBAR,JUAN PEREZ,1234567890,0991234567,CONTADO\n';

      await service.seedFromExcel(
        Buffer.from(csv, 'utf8'),
        'text/csv',
        SECRET,
        'kia-quito',
      );
      const secondRun = await service.seedFromExcel(
        Buffer.from(csv, 'utf8'),
        'text/csv',
        SECRET,
        'kia-quito',
      );

      expect(secondRun.created).toBe(0);
      expect(fake.dump('vehicles')).toHaveLength(1);
    });
  });
});
