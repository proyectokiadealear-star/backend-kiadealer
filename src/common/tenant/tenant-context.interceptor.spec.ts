import { of } from 'rxjs';
import { RoleEnum } from '../enums/role.enum';
import { SedeEnum } from '../enums/sede.enum';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { TenantContext } from './tenant-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';

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

const makeExecutionContext = (
  user?: AuthenticatedUser,
  headers: Record<string, string | string[]> = {},
) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as never;

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;

  beforeEach(() => {
    interceptor = new TenantContextInterceptor();
  });

  /** Captura el contexto visible desde dentro del handler. */
  const captureContextDuringHandler = (executionContext: never) =>
    new Promise<ReturnType<typeof TenantContext.get>>((resolve) => {
      const next = {
        handle: () => {
          resolve(TenantContext.get());
          return of('respuesta');
        },
      };
      interceptor.intercept(executionContext, next as never).subscribe();
    });

  it('abre el contexto con los claims del usuario', async () => {
    const context = await captureContextDuringHandler(
      makeExecutionContext(makeUser()),
    );

    expect(context).toEqual(
      expect.objectContaining({
        tenantId: 'kia-quito',
        userId: 'user-1',
        role: RoleEnum.ASESOR,
        establishmentIds: ['surmotor'],
        platformAdmin: false,
      }),
    );
  });

  it('el contexto está activo DURANTE la ejecución del handler', async () => {
    const context = await captureContextDuringHandler(
      makeExecutionContext(makeUser()),
    );

    expect(context).toBeDefined();
  });

  it('no abre contexto si el token no trae tenantId', async () => {
    const context = await captureContextDuringHandler(
      makeExecutionContext(makeUser({ tenantId: undefined })),
    );

    expect(context).toBeUndefined();
  });

  it('no abre contexto en rutas sin usuario autenticado', async () => {
    const context = await captureContextDuringHandler(makeExecutionContext());

    expect(context).toBeUndefined();
  });

  it('propaga el x-request-id entrante', async () => {
    const context = await captureContextDuringHandler(
      makeExecutionContext(makeUser(), { 'x-request-id': 'trace-abc' }),
    );

    expect(context?.requestId).toBe('trace-abc');
  });

  it('genera un requestId cuando el header no viene', async () => {
    const context = await captureContextDuringHandler(
      makeExecutionContext(makeUser()),
    );

    expect(context?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('toma el primer valor si el header llega repetido', async () => {
    const context = await captureContextDuringHandler(
      makeExecutionContext(makeUser(), {
        'x-request-id': ['primero', 'segundo'],
      }),
    );

    expect(context?.requestId).toBe('primero');
  });

  it('propaga el claim de plataforma', async () => {
    const context = await captureContextDuringHandler(
      makeExecutionContext(makeUser({ platformAdmin: true })),
    );

    expect(context?.platformAdmin).toBe(true);
  });

  it('emite la respuesta del handler sin alterarla', (done) => {
    const next = { handle: () => of('respuesta') };

    interceptor
      .intercept(makeExecutionContext(makeUser()), next as never)
      .subscribe((value) => {
        expect(value).toBe('respuesta');
        done();
      });
  });
});
