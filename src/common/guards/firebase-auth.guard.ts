import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
    }>();

    const authHeader = request.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de autorización requerido');
    }

    const token = authHeader.split('Bearer ')[1];

    try {
      const decoded = await this.firebase.auth().verifyIdToken(token);

      if (!decoded.active) {
        throw new UnauthorizedException('Usuario inactivo');
      }

      request.user = {
        uid: decoded.uid,
        email: decoded.email ?? '',
        role: decoded.role,
        sede: decoded.sede,
        active: decoded.active,
        displayName: decoded.name,
      } as AuthenticatedUser;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
