import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email de la cuenta a la que se enviará el correo de restablecimiento de contraseña.',
    example: 'jefe.taller@kiadealer.com',
  })
  @IsEmail({}, { message: 'El email no tiene un formato válido.' })
  @IsNotEmpty()
  email: string;
}
