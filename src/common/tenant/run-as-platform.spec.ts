import { ForbiddenException } from '@nestjs/common';
import { RoleEnum } from '../enums/role.enum';
import { runAsPlatform } from './run-as-platform';
import { TenantContext, TenantContextData } from './tenant-context';

const makeContext = (
  overrides: Partial<TenantContextData> = {},
): TenantContextData => ({
  tenantId: 'kia-quito',
  userId: 'user-1',
  role: RoleEnum.SOPORTE,
  establishmentIds: [],
  platformAdmin: false,
  requestId: 'req-1',
  ...overrides,
});

describe('runAsPlatform', () => {
  let audit: { append: jest.Mock };
  let operation: jest.Mock;

  beforeEach(() => {
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    operation = jest.fn().mockResolvedValue('resultado');
  });

  it('rechaza a un usuario sin el claim de plataforma', async () => {
    await TenantContext.run(makeContext({ platformAdmin: false }), async () => {
      await expect(
        runAsPlatform('migración', audit as never, operation),
      ).rejects.toThrow(ForbiddenException);
    });

    expect(operation).not.toHaveBeenCalled();
  });

  it('rechaza cuando se invoca fuera de un contexto', async () => {
    await expect(
      runAsPlatform('migración', audit as never, operation),
    ).rejects.toThrow(ForbiddenException);

    expect(operation).not.toHaveBeenCalled();
  });

  it('ejecuta la operación con el claim de plataforma', async () => {
    const result = await TenantContext.run(
      makeContext({ platformAdmin: true }),
      () => runAsPlatform('migración de índices', audit as never, operation),
    );

    expect(result).toBe('resultado');
    expect(operation).toHaveBeenCalled();
  });

  it('registra el motivo en la auditoría', async () => {
    await TenantContext.run(makeContext({ platformAdmin: true }), () =>
      runAsPlatform('migración de índices', audit as never, operation),
    );

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_SCOPE_ESCALATION',
        metadata: { reason: 'migración de índices' },
      }),
    );
  });

  it('audita antes de ejecutar, no después', async () => {
    const order: string[] = [];
    audit.append.mockImplementation(() => {
      order.push('audit');
      return Promise.resolve();
    });
    operation.mockImplementation(() => {
      order.push('operation');
      return Promise.resolve('ok');
    });

    await TenantContext.run(makeContext({ platformAdmin: true }), () =>
      runAsPlatform('motivo', audit as never, operation),
    );

    expect(order).toEqual(['audit', 'operation']);
  });

  it('exige un motivo no vacío', async () => {
    await TenantContext.run(makeContext({ platformAdmin: true }), async () => {
      await expect(
        runAsPlatform('   ', audit as never, operation),
      ).rejects.toThrow(ForbiddenException);
    });

    expect(operation).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });
});
