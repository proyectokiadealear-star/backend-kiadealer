import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshTokenGuard } from './refresh-token.guard';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RefreshTokenDocument } from './refresh-token.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login con email y contraseña',
    description:
      'Autentica al usuario contra Firebase Auth y retorna el idToken (JWT) para usar en las demás peticiones como Bearer token. El refreshToken personalizado expira en 43200 segundos (12 horas). Use POST /auth/refresh para renovar el idToken.',
  })
  @ApiOkResponse({
    description: 'Login exitoso',
    schema: {
      example: {
        idToken: 'eyJhbG...',
        refreshToken: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        expiresIn: 43200,
        user: {
          uid: 'abc123',
          email: 'jefe@dealerkia.com',
          displayName: 'Carlos Jefe',
          role: 'JEFE_TALLER',
          sede: 'SURMOTOR',
          active: true,
        },
      },
    },
  })
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitar restablecimiento de contraseña',
    description:
      'Envía un correo de restablecimiento de contraseña a la dirección indicada mediante Firebase Auth. ' +
      'Por seguridad, se devuelve siempre el mismo mensaje genérico independientemente de si el email existe o no.',
  })
  @ApiOkResponse({
    description: 'Solicitud procesada',
    schema: {
      example: {
        message:
          'Si el correo está registrado, recibirás un enlace de restablecimiento.',
      },
    },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.svc.forgotPassword(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshTokenGuard)
  @ApiOperation({
    summary: 'Renovar idToken con refresh token',
    description:
      'Intercambia un refresh token válido por un nuevo idToken de Firebase. El refresh token debe estar activo y no haber expirado (TTL 12h).',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    description: 'Token renovado correctamente',
    schema: {
      example: {
        idToken: 'eyJhbG...',
        expiresIn: 3600,
      },
    },
  })
  refresh(
    @Body() _dto: RefreshTokenDto,
    @Req() req: Request & { refreshTokenDoc: RefreshTokenDocument },
  ) {
    return this.svc.refresh(req.refreshTokenDoc);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshTokenGuard)
  @ApiOperation({
    summary: 'Cerrar sesión',
    description: 'Revoca el refresh token indicado, cerrando la sesión actual.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    description: 'Sesión cerrada correctamente',
    schema: {
      example: { message: 'Sesión cerrada correctamente' },
    },
  })
  async logout(
    @Body() _dto: RefreshTokenDto,
    @Req() req: Request & { refreshTokenDoc: RefreshTokenDocument },
  ): Promise<{ message: string }> {
    await this.svc.logout(req.refreshTokenDoc.tokenId);
    return { message: 'Sesión cerrada correctamente' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cerrar todas las sesiones',
    description:
      'Revoca todos los refresh tokens activos del usuario autenticado. Requiere Bearer idToken válido.',
  })
  @ApiOkResponse({
    description: 'Todas las sesiones cerradas',
    schema: {
      example: { message: 'Todas las sesiones han sido cerradas', count: 3 },
    },
  })
  async logoutAll(@Req() req: Request & { user: AuthenticatedUser }) {
    const count = await this.svc.logoutAll(req.user.uid);
    return { message: 'Todas las sesiones han sido cerradas', count };
  }
}
