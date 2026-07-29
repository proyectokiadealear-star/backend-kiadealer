import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantsService } from '../../modules/tenants/tenants.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { IS_TENANT_EXEMPT } from '../decorators/tenant-exempt.decorator';

/**
 * Exige que la request pertenezca a un concesionario activo.
 *
 * Corre después de FirebaseAuthGuard (que verifica el token y puebla
 * `req.user`) y antes de TenantContextInterceptor (que abre el contexto).
 * Ver docs/design/01-multi-tenancy.md D-102.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly tenants: TenantsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isExempt = this.reflector.getAllAndOverride<boolean>(
      IS_TENANT_EXEMPT,
      [context.getHandler(), context.getClass()],
    );
    if (isExempt) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.tenantId) {
      // 401 y no 403: un token sin claim de tenant es un token inválido para
      // esta plataforma, no un permiso insuficiente. Suele significar que el
      // usuario se autenticó antes de la re-emisión de claims de la migración.
      throw new UnauthorizedException('Token sin concesionario asignado');
    }

    if (!(await this.tenants.isActive(user.tenantId))) {
      throw new ForbiddenException('Concesionario inactivo o inexistente');
    }

    return true;
  }
}
