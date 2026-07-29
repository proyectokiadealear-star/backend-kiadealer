import { AuditService } from '../audit/audit.service';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  TenantContext,
  TenantContextData,
} from '../../common/tenant/tenant-context';
import {
  ReportServiceOrdersRepository,
  ReportDocumentationsRepository,
  ReportDeliveryCeremoniesRepository,
  ReportAppointmentsRepository,
  ReportAccessoriesCatalogRepository,
} from './reports.repository';

const makeContext = (
  overrides: Partial<TenantContextData> = {},
): TenantContextData => ({
  tenantId: 'kia-quito',
  userId: 'user-1',
  role: RoleEnum.SOPORTE,
  establishmentIds: ['surmotor'],
  platformAdmin: false,
  requestId: 'req-1',
  ...overrides,
});

type FakeDoc = { id: string; data: Record<string, unknown> };

/**
 * Firestore falso mínimo que simula `where(campo, '==', valor)` filtrando en
 * memoria — alcanza para probar que `findAll()` (heredado de
 * TenantScopedRepository) efectivamente excluye documentos de otro
 * concesionario, que es exactamente el hallazgo que corrige este archivo:
 * antes de la migración, `reports.service.ts` leía estas colecciones sin
 * ningún `where('tenantId', ...)`.
 */
function makeFakeFirebase(collections: Record<string, FakeDoc[]>): {
  rawFirestore: jest.Mock;
} {
  return {
    rawFirestore: jest.fn().mockReturnValue({
      collection: jest.fn((name: string) => {
        const docs = collections[name] ?? [];

        interface FakeQuery {
          where: jest.Mock<FakeQuery, [string, string, unknown]>;
          get: jest.Mock;
        }

        const buildQuery = (
          predicate: (doc: FakeDoc) => boolean,
        ): FakeQuery => ({
          where: jest.fn((field: string, op: string, value: unknown) => {
            if (op !== '==') {
              throw new Error(`Operador no soportado en el fake: ${op}`);
            }
            return buildQuery(
              (doc) => predicate(doc) && doc.data[field] === value,
            );
          }),
          get: jest.fn().mockResolvedValue({
            docs: docs
              .filter(predicate)
              .map((doc) => ({ id: doc.id, data: () => doc.data })),
          }),
        });

        return buildQuery(() => true);
      }),
    }),
  };
}

describe('Repositorios de solo lectura de reports (colecciones ya migradas)', () => {
  const audit = {
    recordCrossTenantAttempt: jest.fn(),
  } as unknown as AuditService;

  const cases: Array<{
    name: string;
    collectionName: string;
    build: (
      firebase: unknown,
      audit: AuditService,
    ) => { findAll(): Promise<any[]> };
  }> = [
    {
      name: 'ReportServiceOrdersRepository',
      collectionName: 'service-orders',
      build: (firebase, audit) =>
        new ReportServiceOrdersRepository(firebase as never, audit),
    },
    {
      name: 'ReportDocumentationsRepository',
      collectionName: 'documentations',
      build: (firebase, audit) =>
        new ReportDocumentationsRepository(firebase as never, audit),
    },
    {
      name: 'ReportDeliveryCeremoniesRepository',
      collectionName: 'deliveryCeremonies',
      build: (firebase, audit) =>
        new ReportDeliveryCeremoniesRepository(firebase as never, audit),
    },
    {
      name: 'ReportAppointmentsRepository',
      collectionName: 'appointments',
      build: (firebase, audit) =>
        new ReportAppointmentsRepository(firebase as never, audit),
    },
    {
      name: 'ReportAccessoriesCatalogRepository',
      collectionName: 'catalogs/accessories/items',
      build: (firebase, audit) =>
        new ReportAccessoriesCatalogRepository(firebase as never, audit),
    },
  ];

  it.each(cases)(
    '$name — findAll() aísla al tenant activo y excluye a otros concesionarios',
    async ({ collectionName, build }) => {
      const firebase = makeFakeFirebase({
        [collectionName]: [
          { id: 'own-1', data: { tenantId: 'kia-quito', label: 'propio' } },
          {
            id: 'other-1',
            data: { tenantId: 'mazda-guayaquil', label: 'ajeno' },
          },
        ],
      });
      const repo = build(firebase, audit);

      const result = await TenantContext.run(makeContext(), () =>
        repo.findAll(),
      );

      expect(result).toEqual([
        { id: 'own-1', tenantId: 'kia-quito', label: 'propio' },
      ]);
    },
  );

  it.each(cases)(
    '$name — findAll() lanza si se invoca fuera de un contexto de tenant',
    async ({ collectionName, build }) => {
      const firebase = makeFakeFirebase({
        [collectionName]: [{ id: 'own-1', data: { tenantId: 'kia-quito' } }],
      });
      const repo = build(firebase, audit);

      await expect(repo.findAll()).rejects.toThrow();
    },
  );
});
