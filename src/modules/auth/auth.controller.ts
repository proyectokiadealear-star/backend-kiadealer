import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login con email y contraseña',
    description:
      'Autentica al usuario contra Firebase Auth y retorna el idToken (JWT) para usar en las demás peticiones como Bearer token. El token expira en 3600 segundos (1 hora).',
  })
  @ApiOkResponse({
    description: 'Login exitoso',
    schema: {
      example: {
        idToken: 'eyJhbG...',
        refreshToken: 'AMf-vB...',
        expiresIn: 3600,
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
      example: { message: 'Si el correo está registrado, recibirás un enlace de restablecimiento.' },
    },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.svc.forgotPassword(dto);
  }
}
