import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RoleEnum } from '../enums/role.enum';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { SedeEnum } from '../enums/sede.enum';
import { TenantGuard } from './tenant.guard';

const makeUser = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser =>
  ({
    uid: 'user-1',
    email: 'asesor@kia.com',
    role: RoleEnum.ASESOR,
    active: true,
    sede: SedeEnum.SURMOTOR,
    tenantId: 'kia-quito',
    establishmentIds: ['surmotor'],
    platformAdmin: false,
    ...overrides,
  }) as AuthenticatedUser;

const makeExecutionContext = (user?: AuthenticatedUser) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as never;

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let tenants: { isActive: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    tenants = { isActive: jest.fn().mockResolvedValue(true) };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new TenantGuard(tenants as never, reflector as never);
  });

  it('permite una request de un concesionario activo', async () => {
    await expect(
      guard.canActivate(makeExecutionContext(makeUser())),
    ).resolves.toBe(true);
    expect(tenants.isActive).toHaveBeenCalledWith('kia-quito');
  });

  it('rechaza con 401 un token sin claim de tenant', async () => {
    const context = makeExecutionContext(makeUser({ tenantId: undefined }));

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza con 401 cuando no hay usuario en la request', async () => {
    await expect(guard.canActivate(makeExecutionContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza con 403 un concesionario suspendido', async () => {
    tenants.isActive.mockResolvedValue(false);

    await expect(
      guard.canActivate(makeExecutionContext(makeUser())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rechaza con 403 un concesionario inexistente', async () => {
    tenants.isActive.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        makeExecutionContext(makeUser({ tenantId: 'no-existe' })),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('deja pasar las rutas marcadas como exentas sin consultar el tenant', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    expect(tenants.isActive).not.toHaveBeenCalled();
  });
});
