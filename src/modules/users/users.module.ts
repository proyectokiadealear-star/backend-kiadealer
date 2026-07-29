import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';

/**
 * FirebaseService y AuditService no se importan acá: FirebaseModule y
 * AuditModule son `@Global()` (mismo patrón que DeliveryModule y
 * CatalogsModule).
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
