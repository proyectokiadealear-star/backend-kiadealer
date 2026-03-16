import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  RefreshTokenDocument,
  RefreshTokenService,
} from './refresh-token.service';

@Injectable()
export class RefreshTokenGuard implements CanActivate {
  constructor(private readonly refreshTokenService: RefreshTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      body?: { refreshToken?: string };
      refreshTokenDoc?: RefreshTokenDocument;
    }>();

    const { refreshToken } = request.body ?? {};

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    // validateToken throws UnauthorizedException internally if invalid/expired/revoked
    const doc = await this.refreshTokenService.validateToken(refreshToken);
    request.refreshTokenDoc = doc;
    return true;
  }
}
