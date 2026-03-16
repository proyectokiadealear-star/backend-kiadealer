import { Module } from '@nestjs/common';
import { FirebaseModule } from '../../firebase/firebase.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshTokenGuard } from './refresh-token.guard';

@Module({
  imports: [FirebaseModule],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService, RefreshTokenGuard],
})
export class AuthModule {}
