import { Module } from '@nestjs/common';
import { FirebaseModule } from '../../firebase/firebase.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [FirebaseModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
