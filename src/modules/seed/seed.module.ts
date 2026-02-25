import { Module } from '@nestjs/common';
import { FirebaseModule } from '../../firebase/firebase.module';
import { SeedService } from './seed.service';
import { SeedController } from './seed.controller';

@Module({
  imports: [FirebaseModule],
  controllers: [SeedController],
  providers: [SeedService],
})
export class SeedModule {}
