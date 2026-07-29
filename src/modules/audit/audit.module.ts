import { Global, Module } from '@nestjs/common';
import { FirebaseModule } from '../../firebase/firebase.module';
import { AuditService } from './audit.service';

/**
 * Global porque toda mutación de negocio, en cualquier módulo, debe poder
 * auditarse sin que cada módulo tenga que importarlo explícitamente.
 */
@Global()
@Module({
  imports: [FirebaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
