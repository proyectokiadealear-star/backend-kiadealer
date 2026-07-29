import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { TenantContext, TenantContextData } from './tenant-context';

/**
 * Abre el AsyncLocalStorage del tenant para toda la ejecución del handler.
 *
 * Es un interceptor y no un middleware por dos razones:
 *
 *  1. Orden. En NestJS el middleware corre ANTES que los guards, así que
 *     `req.user` todavía no existe — lo puebla FirebaseAuthGuard. Los
 *     interceptores corren después de los guards.
 *  2. Alcance. Un `CanActivate` no envuelve la ejecución del handler:
 *     `storage.run()` cerraría el contexto al retornar el guard, antes de
 *     que los services corran.
 *
 * La suscripción a `next.handle()` se hace DENTRO de `TenantContext.run()`
 * a propósito: `next.handle()` construye el Observable pero el handler solo
 * se ejecuta al suscribirse. Envolver únicamente la construcción dejaría al
 * handler fuera del contexto.
 *
 * No valida nada: si no hay usuario o no hay tenantId, deja pasar sin abrir
 * contexto y TenantGuard rechaza con el código correcto. Así las rutas
 * públicas (login, health check) atraviesan sin fricción.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = executionContext
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.tenantId) {
      return next.handle();
    }

    const context: TenantContextData = {
      tenantId: user.tenantId,
      userId: user.uid,
      role: user.role,
      establishmentIds: user.establishmentIds ?? [],
      platformAdmin: user.platformAdmin === true,
      requestId: this.resolveRequestId(request),
    };

    return new Observable((subscriber) => {
      TenantContext.run(context, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }

  private resolveRequestId(request: Request): string {
    const header = request.headers['x-request-id'];
    if (typeof header === 'string' && header.length > 0) return header;
    if (Array.isArray(header) && header.length > 0) return header[0];
    return randomUUID();
  }
}
