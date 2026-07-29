import { Module } from '@nestjs/common';
import { FirebaseModule } from '../../firebase/firebase.module';
import { SeedService } from './seed.service';
import { SeedController } from './seed.controller';
import { SeedUsersRepository } from './seed-users.repository';
import { CertificationsRepository } from '../certifications/certifications.repository';
import { DocumentationRepository } from '../documentation/documentation.repository';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { ServiceOrdersRepository } from '../service-orders/service-orders.repository';
import { AppointmentsRepository } from '../appointments/appointments.repository';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';

/**
 * Los repositorios inyectados acá (certifications, documentation, vehicles,
 * service-orders, appointments, delivery, notifications) pertenecen a OTROS
 * módulos y ninguno de ellos exporta su repositorio (solo su Service — ver
 * cada *.module.ts respectivo). Se proveen directamente acá en vez de
 * importar esos módulos completos porque:
 *
 *  1. Son clases `@Injectable()` simples que solo dependen de FirebaseService
 *     y AuditService, ambos `@Global()` — no hace falta el resto del árbol
 *     de dependencias de esos módulos (sus Services, sus otros repositorios
 *     puente, etc.) para reusar SOLO el acceso a Firestore ya scopeado.
 *  2. El seeder es scaffolding de plataforma (ver seed-platform-context.ts),
 *     no un consumidor de negocio de esos módulos — no debería arrastrar
 *     NotificationsModule/VehiclesModule enteros (con sus propios imports)
 *     solo para reusar un repositorio.
 *
 * Nest permite proveer la misma clase de repositorio en dos módulos sin
 * conflicto: cada `providers: [...]` crea su propia instancia dentro del
 * scope de ESE módulo (no hay singleton global salvo que el provider esté en
 * un módulo `@Global()`), así que esto no interfiere con la instancia que
 * usa, p. ej., CertificationsModule.
 *
 * SeedUsersRepository es la única pieza nueva: `UsersModule` no exporta
 * `UsersRepository` (pensado para flujos con actor autenticado) — ver el
 * comentario en seed-users.repository.ts.
 *
 * VehiclesRepository en particular: está siendo migrado en paralelo por otro
 * cambio (VehiclesService puede no estar rewireado todavía). El repositorio
 * en sí ya existe y está probado — se inyecta directo, sin bridge propio.
 */
@Module({
  imports: [FirebaseModule],
  controllers: [SeedController],
  providers: [
    SeedService,
    SeedUsersRepository,
    CertificationsRepository,
    DocumentationRepository,
    VehiclesRepository,
    ServiceOrdersRepository,
    AppointmentsRepository,
    DeliveryRepository,
    NotificationsRepository,
  ],
})
export class SeedModule {}
