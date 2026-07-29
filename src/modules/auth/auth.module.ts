import { Module } from '@nestjs/common';
import { FirebaseModule } from '../../firebase/firebase.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RefreshTokenGuard } from './refresh-token.guard';

@Module({
  imports: [FirebaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    RefreshTokenService,
    RefreshTokenRepository,
    RefreshTokenGuard,
  ],
})
export class AuthModule {}
