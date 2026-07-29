import { Global, Module } from '@nestjs/common';
import { FirebaseModule } from '../../firebase/firebase.module';
import { TenantsService } from './tenants.service';

/**
 * Global porque TenantGuard se aplica a toda la aplicación y necesita
 * resolver el estado del concesionario en cualquier módulo.
 */
@Global()
@Module({
  imports: [FirebaseModule],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
