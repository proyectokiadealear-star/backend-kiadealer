import { Module, Provider } from '@nestjs/common';
import { CatalogsService } from './catalogs.service';
import { CatalogsController } from './catalogs.controller';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuditService } from '../audit/audit.service';
import {
  CATALOG_REPOSITORY_TOKENS,
  CATALOG_TYPES,
  CatalogItemsRepository,
} from './catalogs.repository';

/**
 * Un provider por tipo de catálogo — cada uno es una instancia distinta de
 * CatalogItemsRepository apuntando a su propia subcolección
 * `catalogs/{tipo}/items`. No se puede resolver por `useClass` porque
 * `collectionName` depende de un argumento (`catalogType`) que Nest no sabe
 * inyectar solo: por eso `useFactory` construye la instancia a mano.
 *
 * FirebaseService y AuditService no necesitan importarse acá porque
 * FirebaseModule y AuditModule son `@Global()`.
 */
const catalogRepositoryProviders: Provider[] = CATALOG_TYPES.map((type) => ({
  provide: CATALOG_REPOSITORY_TOKENS[type],
  useFactory: (firebase: FirebaseService, audit: AuditService) =>
    new CatalogItemsRepository(firebase, audit, type),
  inject: [FirebaseService, AuditService],
}));

@Module({
  controllers: [CatalogsController],
  providers: [...catalogRepositoryProviders, CatalogsService],
  exports: [CatalogsService],
})
export class CatalogsModule {}
