import { Test, TestingModule } from '@nestjs/testing';
import { VehiclesService } from './vehicles.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';

type Row = { id: string; [key: string]: any };

const makeVehicleSnap = (rows: Row[]) => ({
  empty: rows.length === 0,
  docs: rows.map((row) => ({
    id: row.id,
    data: () => {
      const { id, ...rest } = row;
      return rest;
    },
  })),
});

const makeDocSnaps = (docsById: Record<string, any>) =>
  Object.entries(docsById).map(([id, data]) => ({
    id,
    exists: data != null,
    data: () => data,
  }));

describe('VehiclesService (Call Center)', () => {
  const notificationsMock = {
    notify: jest.fn().mockResolvedValue(undefined),
  };

  const buildService = async (input: {
    vehicles: Row[];
    docsById: Record<string, any>;
    docsByVehicleId?: Record<string, any>;
  }) => {
    const firestoreMock = {
      getAll: jest.fn(async (...refs: Array<{ id: string }>) => {
        const docsMap: Record<string, any> = {};
        for (const [id, data] of Object.entries(input.docsById)) {
          docsMap[id] = data;
        }
        return refs.map((ref) => ({
          id: ref.id,
          exists: docsMap[ref.id] != null,
          data: () => docsMap[ref.id],
        }));
      }),
      collection: jest.fn((name: string) => {
        if (name === 'vehicles') {
          return {
            where: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue(makeVehicleSnap(input.vehicles)),
            }),
          };
        }
        if (name === 'documentations') {
          return {
            doc: jest.fn((id: string) => ({ id })),
            where: jest.fn((field: string, op: string, values: string[]) => {
              if (field !== 'vehicleId' || op !== 'in') {
                return {
                  get: jest.fn().mockResolvedValue(makeVehicleSnap([])),
                };
              }
              const rows = (input.docsByVehicleId ?? {})
                ? Object.entries(input.docsByVehicleId ?? {})
                    .filter(([vehicleId]) => values.includes(vehicleId))
                    .map(([vehicleId, data]) => ({
                      id: `doc-${vehicleId}`,
                      vehicleId,
                      ...(data ?? {}),
                    }))
                : [];
              return {
                get: jest.fn().mockResolvedValue(makeVehicleSnap(rows)),
              };
            }),
          };
        }
        return {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue(makeVehicleSnap([])),
          doc: jest.fn((id: string) => ({ id })),
        };
      }),
    };

    const firebaseMock = {
      firestore: jest.fn().mockReturnValue(firestoreMock),
      serverTimestamp: jest.fn().mockReturnValue({ _seconds: 0 }),
      uploadBuffer: jest.fn(),
      getSignedUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehiclesService,
        { provide: FirebaseService, useValue: firebaseMock },
        { provide: NotificationsService, useValue: notificationsMock },
      ],
    }).compile();

    return module.get<VehiclesService>(VehiclesService);
  };

  it('always returns seguro and telemetria with normalized classification', async () => {
    const service = await buildService({
      vehicles: [
        {
          id: 'v-1',
          chassis: 'AAA111',
          model: 'KIA SONET',
          color: 'ROJO',
          year: 2026,
          sede: 'SURMOTOR',
          status: VehicleStatus.ENTREGADO,
          deliveryDate: '2026-03-15T00:00:00.000Z',
        },
        {
          id: 'v-2',
          chassis: 'BBB222',
          model: 'KIA RIO',
          color: 'BLANCO',
          year: 2026,
          sede: 'SURMOTOR',
          status: VehicleStatus.DOCUMENTADO,
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
      docsById: {
        'v-1': {
          clientName: 'Cliente Uno',
          clientId: '0101010101',
          clientPhone: '0990000001',
          accessories: [
            { key: 'seguro', classification: 'vendido' },
            { key: 'TELEMETRIA', classification: 'OBSEQUIADO' },
          ],
        },
      },
    });

    const result = await service.getCallCenterList(1, 100);

    expect(result.total).toBe(2);
    expect(result.data[0].accessories).toEqual([
      { key: 'SEGURO', classification: 'VENDIDO', vendido: true },
      { key: 'TELEMETRIA', classification: 'OBSEQUIADO', vendido: true },
    ]);
    expect(result.data[0].documentationFound).toBe(true);

    expect(result.data[1].accessories).toEqual([
      { key: 'SEGURO', classification: null, vendido: false },
      { key: 'TELEMETRIA', classification: null, vendido: false },
    ]);
    expect(result.data[1].documentationFound).toBe(false);
  });

  it('applies date, sede, model and status filters for call center feed', async () => {
    const service = await buildService({
      vehicles: [
        {
          id: 'v-match',
          chassis: 'CCC333',
          model: 'KIA SPORTAGE',
          color: 'NEGRO',
          year: 2026,
          sede: 'SURMOTOR',
          status: VehicleStatus.ENTREGADO,
          deliveryDate: '2026-03-10T00:00:00.000Z',
        },
        {
          id: 'v-other-sede',
          chassis: 'DDD444',
          model: 'KIA SPORTAGE',
          color: 'AZUL',
          year: 2026,
          sede: 'SHYRIS',
          status: VehicleStatus.ENTREGADO,
          deliveryDate: '2026-03-11T00:00:00.000Z',
        },
        {
          id: 'v-other-status',
          chassis: 'EEE555',
          model: 'KIA SPORTAGE',
          color: 'GRIS',
          year: 2026,
          sede: 'SURMOTOR',
          status: VehicleStatus.DOCUMENTADO,
          createdAt: '2026-03-11T00:00:00.000Z',
        },
        {
          id: 'v-other-date',
          chassis: 'FFF666',
          model: 'KIA SPORTAGE',
          color: 'ROJO',
          year: 2026,
          sede: 'SURMOTOR',
          status: VehicleStatus.ENTREGADO,
          deliveryDate: '2026-04-01T00:00:00.000Z',
        },
      ],
      docsById: {
        'v-match': { accessories: [] },
        'v-other-sede': { accessories: [] },
        'v-other-status': { accessories: [] },
        'v-other-date': { accessories: [] },
      },
    });

    const result = await service.getCallCenterList(1, 100, {
      sede: 'SURMOTOR',
      model: 'sportage',
      status: 'ENTREGADO',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('v-match');
  });

  it('uses documentations.vehicleId fallback when doc id does not match vehicle id', async () => {
    const service = await buildService({
      vehicles: [
        {
          id: 'veh-123',
          chassis: 'GGG777',
          model: 'KIA SONET',
          color: 'PLATA',
          year: 2026,
          sede: 'SURMOTOR',
          status: VehicleStatus.ENTREGADO,
          deliveryDate: '2026-03-10T00:00:00.000Z',
        },
      ],
      docsById: {},
      docsByVehicleId: {
        'veh-123': {
          clientName: 'Fallback Cliente',
          clientId: '1717171717',
          clientPhone: '0990000077',
          accessories: [{ key: 'telemetria', classification: 'OBSEQUIADO' }],
        },
      },
    });

    const result = await service.getCallCenterList(1, 100);
    expect(result.total).toBe(1);
    expect(result.data[0].documentationFound).toBe(true);
    expect(result.data[0].propietario.nombre).toBe('Fallback Cliente');
    expect(result.data[0].accessories).toEqual([
      { key: 'SEGURO', classification: null, vendido: false },
      { key: 'TELEMETRIA', classification: 'OBSEQUIADO', vendido: true },
    ]);
  });
});
