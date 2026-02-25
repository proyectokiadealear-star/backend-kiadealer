import { IsString, IsNotEmpty, IsEmail, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleEnum } from '../../../common/enums/role.enum';
import { SedeEnum } from '../../../common/enums/sede.enum';

export class CreateUserDto {
  @ApiProperty() @IsString() @IsNotEmpty() displayName: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ enum: RoleEnum }) @IsEnum(RoleEnum) role: RoleEnum;
  @ApiProperty({ enum: SedeEnum }) @IsEnum(SedeEnum) sede: SedeEnum;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() displayName?: string;
  @ApiPropertyOptional({ enum: RoleEnum }) @IsOptional() @IsEnum(RoleEnum) role?: RoleEnum;
  @ApiPropertyOptional({ enum: SedeEnum }) @IsOptional() @IsEnum(SedeEnum) sede?: SedeEnum;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class RegisterFcmTokenDto {
  @ApiProperty({ description: 'FCM device token' }) @IsString() @IsNotEmpty() token: string;
}
