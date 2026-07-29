import { InternalServerErrorException } from '@nestjs/common';
import { RoleEnum } from '../enums/role.enum';
import { TenantContext, TenantContextData } from './tenant-context';

const makeContext = (
  overrides: Partial<TenantContextData> = {},
): TenantContextData => ({
  tenantId: 'kia-quito',
  userId: 'user-1',
  role: RoleEnum.ASESOR,
  establishmentIds: ['surmotor'],
  platformAdmin: false,
  requestId: 'req-1',
  ...overrides,
});

describe('TenantContext', () => {
  describe('fuera de contexto', () => {
    it('get() devuelve undefined', () => {
      expect(TenantContext.get()).toBeUndefined();
    });

    it('getOrThrow() lanza en lugar de devolver datos sin filtrar', () => {
      expect(() => TenantContext.getOrThrow()).toThrow(
        InternalServerErrorException,
      );
    });

    it('currentTenantId() lanza', () => {
      expect(() => TenantContext.currentTenantId()).toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('dentro de contexto', () => {
    it('expone los datos del tenant activo', () => {
      const context = makeContext();
      TenantContext.run(context, () => {
        expect(TenantContext.getOrThrow()).toEqual(context);
        expect(TenantContext.currentTenantId()).toBe('kia-quito');
      });
    });

    it('persiste a través de operaciones asíncronas', async () => {
      await TenantContext.run(makeContext(), async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(TenantContext.currentTenantId()).toBe('kia-quito');
      });
    });

    it('el contexto anidado no filtra al externo', () => {
      TenantContext.run(makeContext({ tenantId: 'externo' }), () => {
        TenantContext.run(makeContext({ tenantId: 'interno' }), () => {
          expect(TenantContext.currentTenantId()).toBe('interno');
        });
        expect(TenantContext.currentTenantId()).toBe('externo');
      });
    });

    it('dos contextos concurrentes no se mezclan', async () => {
      const observed: string[] = [];

      const request = (tenantId: string, delayMs: number) =>
        TenantContext.run(makeContext({ tenantId }), async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          observed.push(TenantContext.currentTenantId());
        });

      await Promise.all([request('tenant-a', 5), request('tenant-b', 1)]);

      expect(observed.sort()).toEqual(['tenant-a', 'tenant-b']);
    });

    it('el contexto se cierra al salir de run()', () => {
      TenantContext.run(makeContext(), () => {
        expect(TenantContext.get()).toBeDefined();
      });
      expect(TenantContext.get()).toBeUndefined();
    });
  });
});
