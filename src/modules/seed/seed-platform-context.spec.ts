import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { runSeedPlatformOperation } from './seed-platform-context';
import { TenantStatus } from '../tenants/tenant.types';

/**
 * runSeedPlatformOperation() es el único punto por el que SeedService toca
 * Firestore: abre el TenantContext sintético (platformAdmin: true) a partir
 * del tenantId EXPLÍCITO del payload/query — ver el comentario de diseño en
 * seed-platform-context.ts. Estos tests cubren ese contrato: rechazo sin
 * tenantId, rechazo con tenant inexistente, y que la operación corre dentro
 * de runAsPlatform() (con su registro de auditoría).
 */
describe('runSeedPlatformOperation', () => {
  let tenants: { findById: jest.Mock };
  let audit: { append: jest.Mock };
  let operation: jest.Mock;

  const activeTenant = {
    id: 'kia-quito',
    name: 'Kia Quito',
    ruc: '1790000000001',
    status: TenantStatus.ACTIVE,
    plan: 'pro',
    createdAt: new Date(),
  };

  beforeEach(() => {
    tenants = { findById: jest.fn() };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    operation = jest.fn().mockResolvedValue('ok');
  });

  const call = (tenantId: string | undefined | null, reason = 'seed:test') =>
    runSeedPlatformOperation(
      { tenantId, reason, tenants: tenants as never, audit: audit as never },
      operation,
    );

  describe('tenantId obligatorio', () => {
    it.each([undefined, null, '', '   '])(
      'rechaza tenantId=%p sin consultar tenants ni ejecutar la operación',
      async (badTenantId) => {
        await expect(call(badTenantId)).rejects.toThrow(BadRequestException);

        expect(tenants.findById).not.toHaveBeenCalled();
        expect(operation).not.toHaveBeenCalled();
      },
    );
  });

  describe('el tenant debe existir', () => {
    it('rechaza un tenantId que no está provisionado', async () => {
      tenants.findById.mockResolvedValue(null);

      await expect(call('tenant-fantasma')).rejects.toThrow(
        BadRequestException,
      );
      expect(operation).not.toHaveBeenCalled();
    });

    it('NO exige tenant.status === ACTIVE — PENDING también puede sembrarse', async () => {
      tenants.findById.mockResolvedValue({
        ...activeTenant,
        status: TenantStatus.PENDING,
      });

      const result = await call('kia-quito');

      expect(result).toBe('ok');
      expect(operation).toHaveBeenCalled();
    });
  });

  describe('contexto sintético de plataforma', () => {
    it('abre el contexto con platformAdmin:true y el tenantId explícito', async () => {
      tenants.findById.mockResolvedValue(activeTenant);
      operation.mockImplementation(async () => TenantContext.getOrThrow());

      const context = await call('kia-quito');

      expect(context).toMatchObject({
        tenantId: 'kia-quito',
        platformAdmin: true,
        userId: 'seed-system',
      });
    });

    it('recorta espacios del tenantId antes de resolverlo', async () => {
      tenants.findById.mockResolvedValue(activeTenant);

      await call('  kia-quito  ');

      expect(tenants.findById).toHaveBeenCalledWith('kia-quito');
    });

    it('propaga el resultado de la operación', async () => {
      tenants.findById.mockResolvedValue(activeTenant);
      operation.mockResolvedValue({ created: 3 });

      await expect(call('kia-quito')).resolves.toEqual({ created: 3 });
    });
  });

  describe('runAsPlatform() por debajo — auditoría obligatoria', () => {
    it('registra PLATFORM_SCOPE_ESCALATION con el motivo dado', async () => {
      tenants.findById.mockResolvedValue(activeTenant);

      await call('kia-quito', 'seed:from-excel');

      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PLATFORM_SCOPE_ESCALATION',
          metadata: { reason: 'seed:from-excel' },
        }),
      );
    });

    it('rechaza sin motivo — runAsPlatform exige uno no vacío', async () => {
      tenants.findById.mockResolvedValue(activeTenant);

      await expect(call('kia-quito', '   ')).rejects.toThrow(
        ForbiddenException,
      );
      expect(operation).not.toHaveBeenCalled();
    });

    it('audita ANTES de ejecutar la operación', async () => {
      tenants.findById.mockResolvedValue(activeTenant);
      const order: string[] = [];
      audit.append.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });
      operation.mockImplementation(() => {
        order.push('operation');
        return Promise.resolve('ok');
      });

      await call('kia-quito');

      expect(order).toEqual(['audit', 'operation']);
    });
  });
});
