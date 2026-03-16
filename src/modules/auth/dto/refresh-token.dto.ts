import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'a3f1c2d4-...' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
