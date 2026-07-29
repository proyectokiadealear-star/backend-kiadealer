import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { FirebaseService } from '../../firebase/firebase.service';
import { TenantsService } from '../tenants/tenants.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import {
  AccessoryKey,
  AccessoryClassification,
} from '../../common/enums/accessory-key.enum';
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { runSeedPlatformOperation } from './seed-platform-context';
import { SeedUsersRepository } from './seed-users.repository';
import { CertificationsRepository } from '../certifications/certifications.repository';
import {
  AntennaType,
  ImprintsStatus,
  InstalledStatus,
  RimsStatus,
  SeatType,
} from '../certifications/dto/create-certification.dto';
import { DocumentationRepository } from '../documentation/documentation.repository';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { ServiceOrdersRepository } from '../service-orders/service-orders.repository';
import { AppointmentsRepository } from '../appointments/appointments.repository';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';
import {
  CATALOG_TYPES,
  CatalogItem,
  CatalogItemsRepository,
  CatalogType,
} from '../catalogs/catalogs.repository';

interface SeedUser {
  displayName: string;
  email: string;
  password: string;
  role: RoleEnum;
  sede: SedeEnum;
}

interface VehicleSeed {
  vin: string; // VIN ISO 3779 (17 chars)
  model: string;
  color: string;
  year: number;
  sede: SedeEnum;
  status: VehicleStatus;
  originConcessionaire: string;
  clientName: string;
  clientId: string; // cédula ecuatoriana válida
  clientPhone: string;
  paymentMethod?: PaymentMethod; // opcional — sobreescribe el default CREDITO
  fechaEntrega?: Date; // fecha real de entrega desde Excel
}

/** Repositorio mínimo que necesita el borrado masivo por tenant — ver `clearScoped()`. */
interface BulkDeletableRepository {
  findAll(): Promise<{ id?: string }[]>;
  delete(id: string): Promise<boolean>;
}

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  /**
   * Un `CatalogItemsRepository` por tipo de catálogo, construido a mano
   * (mismo patrón que `catalogs.module.ts` — `collectionName` depende de
   * `catalogType`, así que Nest no puede resolverlo con `useClass`). No hace
   * falta declarar esto como provider de Nest: son instancias baratas
   * (misma forma que cualquier `new Repositorio(firebase, audit)`) y viven
   * solo dentro de este servicio.
   */
  private readonly catalogRepos: Record<CatalogType, CatalogItemsRepository>;

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly usersRepo: SeedUsersRepository,
    private readonly certifications: CertificationsRepository,
    private readonly documentations: DocumentationRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly serviceOrders: ServiceOrdersRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly notifications: NotificationsRepository,
  ) {
    this.catalogRepos = Object.fromEntries(
      CATALOG_TYPES.map((type) => [
        type,
        new CatalogItemsRepository(this.firebase, this.audit, type),
      ]),
    ) as Record<CatalogType, CatalogItemsRepository>;
  }

  // ──────────────────────────────────────────────────────────────────────
  // GUARD: sólo se ejecuta con la clave correcta
  // ──────────────────────────────────────────────────────────────────────
  private validateSeedKey(key: string): void {
    const expected =
      this.config.get<string>('SEED_SECRET_KEY') ?? 'kia-seed-2024';
    if (key !== expected) {
      throw new ForbiddenException('Clave de seed inválida');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // ENTRY POINT
  // ──────────────────────────────────────────────────────────────────────

  /** Expuesto para el endpoint POST /seed/users — restaura solo el jefe de taller */
  async runSeedUsers(
    secretKey: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    this.validateSeedKey(secretKey);

    return runSeedPlatformOperation(
      { tenantId, reason: 'seed:restaurar-jefe-taller', tenants: this.tenants, audit: this.audit },
      async () => {
        const u: SeedUser = {
          displayName: 'Carlos Mendoza',
          email: 'jefe.taller@kiadealer.com',
          password: 'KiaDealer2024!',
          role: RoleEnum.JEFE_TALLER,
          sede: SedeEnum.ALL,
        };

        try {
          const { uid: userUid, wasNew } = await this.upsertAuthUser(u);
          await this.upsertUserDocument(userUid, u);

          this.logger.log(
            wasNew
              ? `👤 Jefe de taller creado: ${u.email}`
              : `⏩ Jefe de taller ya existía: ${u.email}`,
          );
          return {
            created: wasNew,
            email: u.email,
            role: u.role,
            uid: userUid,
          };
        } catch (err: any) {
          this.logger.error(
            `❌ Error restaurando jefe de taller: ${err.message}`,
          );
          throw err;
        }
      },
    );
  }

  async runSeed(
    secretKey: string,
    tenantId: string,
    options: { clear?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    this.validateSeedKey(secretKey);

    return runSeedPlatformOperation(
      { tenantId, reason: 'seed:run', tenants: this.tenants, audit: this.audit },
      async () => {
        this.logger.log('🌱 Iniciando proceso de seed...');

        const results: Record<string, unknown> = {};

        if (options.clear) {
          await this.clearCollections();
          results['cleared'] = true;
        }

        results['catalogs'] = await this.seedCatalogs();

        this.logger.log(
          '✅ Seed completado con éxito — catálogos listos. Usa /seed/from-excel para importar vehículos.',
        );
        return results;
      },
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // CLEAR (solo dev) — borrado masivo, SIEMPRE acotado al tenant activo
  // ──────────────────────────────────────────────────────────────────────
  //
  // La versión pre-migración iteraba nombres de colección con
  // `this.db.collection(col).limit(500).get()`: sin NINGÚN filtro de
  // tenant. Sobre una base multi-tenant eso borra la colección entera de
  // TODOS los concesionarios, no solo el que pidió la limpieza — el peor
  // escenario posible para un endpoint de "borrar datos de demo".
  //
  // Acá cada colección se limpia a través de SU repositorio ya migrado.
  // `findAll()` usa `scopedQuery()` internamente (`where('tenantId','==',
  // ctx.tenantId)`), así que es ESTRUCTURALMENTE imposible traer documentos
  // de otro tenant — no depende de que quien escribe este método se acuerde
  // de agregar el where. El contexto lo abre `runSeedPlatformOperation`
  // antes de llegar acá con el `tenantId` explícito del request. Ver
  // seed.service.spec.ts → 'borrado masivo no cruza tenants'.
  private async clearCollections(): Promise<void> {
    try {
      // vehicles usa deleteManyWithHistory: además del vehículo, limpia su
      // subcolección statusHistory — algo que el loop original NUNCA hacía
      // (una subcolección no aparece en `.collection('vehicles').get()`),
      // dejando historiales huérfanos en cada reset. Mejora de comportamiento,
      // no solo de scoping.
      const vehicleIds = (await this.vehicles.findAll())
        .slice(0, 500)
        .map((v) => v.id as string);
      await this.vehicles.deleteManyWithHistory(vehicleIds);
    } catch (e: any) {
      this.logger.warn(`No se pudo limpiar 'vehicles': ${e.message}`);
    }

    await this.clearScoped(this.documentations, 'documentations');
    await this.clearScoped(this.certifications, 'certifications');
    await this.clearScoped(this.serviceOrders, 'service-orders');
    await this.clearScoped(this.appointments, 'appointments');
    await this.clearScoped(this.deliveries, 'deliveryCeremonies');

    try {
      const notifs = (await this.notifications.findAll()).slice(0, 500);
      await this.notifications.deleteBatch(
        notifs.map((n) => n.id as string),
      );
    } catch (e: any) {
      this.logger.warn(`No se pudo limpiar 'notifications': ${e.message}`);
    }

    for (const type of CATALOG_TYPES) {
      await this.clearScoped(this.catalogRepos[type], `catalogs/${type}/items`);
    }

    this.logger.log('🗑️  Colecciones limpiadas (solo del concesionario activo)');
  }

  /**
   * Borra hasta 500 documentos de `repo`, todos ya acotados al tenant activo
   * por `findAll()`. `delete()` además reverifica pertenencia documento por
   * documento (vía `findById` dentro de la base) antes de escribir — doble
   * chequeo, no solo el de la query.
   */
  private async clearScoped(
    repo: BulkDeletableRepository,
    label: string,
  ): Promise<void> {
    try {
      const docs = (await repo.findAll()).slice(0, 500);
      await Promise.all(docs.map((d) => repo.delete(d.id as string)));
    } catch (e: any) {
      this.logger.warn(`No se pudo limpiar '${label}': ${e.message}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CATALOGS
  // ──────────────────────────────────────────────────────────────────────
  private async seedCatalogs(): Promise<
    Record<string, { created: number; updated: number }>
  > {
    const colors = [
      'BLANCO GLACIAR',
      'NEGRO PERLA',
      'ROJO AURORA',
      'AZUL SAFIRO',
      'GRIS PLATINO',
      'PLATA METEORICO',
      'VERDE ESMERALDA',
      'CAFE BRONCE',
      'BLANCO PERLA',
      'NEGRO MEDIANOCHE',
      'GRIS ACERO',
      'AZUL CIELO',
    ];

    const models = [
      'KIA SPORTAGE',
      'KIA PICANTO',
      'KIA RIO',
      'KIA SORENTO',
      'KIA STINGER',
      'KIA SOUL',
      'KIA SELTOS',
      'KIA EV6',
      'KIA CARNIVAL',
      'KIA TELLURIDE',
    ];

    const concessionaires = [
      { name: 'LOGIMANTA' },
      { name: 'ASIAUTO' },
      { name: 'KMOTOR' },
      { name: 'EMPROMOTOR' },
      { name: 'MOTRICENTRO' },
      { name: 'IOKARS' },
    ];

    const sedes = [
      { name: 'SURMOTOR', code: SedeEnum.SURMOTOR },
      { name: 'SHYRIS', code: SedeEnum.SHYRIS },
      { name: 'GRANDA CENTENO', code: SedeEnum.GRANDA_CENTENO },
    ];

    const accessories = [
      { name: 'BOTON DE ENCENDIDO', key: AccessoryKey.BOTON_ENCENDIDO },
      { name: 'KIT DE CARRETERA', key: AccessoryKey.KIT_CARRETERA },
      { name: 'AROS', key: AccessoryKey.AROS },
      { name: 'LAMINAS', key: AccessoryKey.LAMINAS },
      { name: 'MOQUETAS', key: AccessoryKey.MOQUETAS },
      { name: 'CUBREMALETAS', key: AccessoryKey.CUBREMALETAS },
      { name: 'SEGURO SATELITAL', key: AccessoryKey.SEGURO },
      { name: 'TELEMETRIA', key: AccessoryKey.TELEMETRIA },
      { name: 'SENSORES DE PROXIMIDAD', key: AccessoryKey.SENSORES },
      { name: 'ALARMA', key: AccessoryKey.ALARMA },
      { name: 'NEBLINEROS', key: AccessoryKey.NEBLINEROS },
      { name: 'KIT DE SEGURIDAD', key: AccessoryKey.KIT_SEGURIDAD },
      { name: 'PROTECTOR CERAMICO', key: AccessoryKey.PROTECTOR_CERAMICO },
      { name: 'OTROS', key: AccessoryKey.OTROS },
    ];

    const savedColors = await this.bulkUpsertCatalog(
      'colors',
      colors.map((name) => ({ name })),
    );
    const savedModels = await this.bulkUpsertCatalog(
      'models',
      models.map((name) => ({ name })),
    );
    const savedConcessionaires = await this.bulkUpsertCatalog(
      'concessionaires',
      concessionaires.map((c) => ({ name: c.name })),
    );
    const savedSedes = await this.bulkUpsertCatalog(
      'sedes',
      sedes.map((s) => ({ name: s.name, code: s.code })),
    );
    const savedAccessories = await this.bulkUpsertCatalog(
      'accessories',
      accessories.map((a) => ({ name: a.name, key: a.key })),
    );

    this.logger.log(
      `📦 Catálogos: ${savedColors.created + savedColors.updated} colores, ` +
        `${savedModels.created + savedModels.updated} modelos, ` +
        `${savedConcessionaires.created + savedConcessionaires.updated} concesionarios, ` +
        `${savedSedes.created + savedSedes.updated} sedes, ` +
        `${savedAccessories.created + savedAccessories.updated} accesorios`,
    );
    return {
      colors: savedColors,
      models: savedModels,
      concessionaires: savedConcessionaires,
      sedes: savedSedes,
      accessories: savedAccessories,
    };
  }

  /** Convierte un nombre en un ID safe para Firestore (sin tildes ni espacios) */
  private toSlugId(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  /**
   * Upsert de items de catálogo vía `CatalogItemsRepository` (repositorio ya
   * migrado de `catalogs`, inyectado — no un acceso nuevo).
   *
   * El id determinístico replica `buildItemId()` de `CatalogItemsRepository`
   * (`{tenantId}__{slug}`, privado en ese repositorio): la subcolección
   * `catalogs/{tipo}/items` es compartida entre TODOS los concesionarios (ver
   * el comentario de esa clase), así que sin el prefijo dos tenants que
   * siembren el mismo nombre ("BLANCO PERLA") pisarían el mismo documento.
   * Se recalcula acá en vez de llamar a `createItem()`/`updateItem()` porque
   * esos métodos no son idempotentes de por sí (`createItem` lanza
   * `ConflictException` si el id ya existe) — acá usamos directamente
   * `exists()` + `create()`/`update()` de la base, que sí lo son.
   */
  private async bulkUpsertCatalog(
    catalogType: CatalogType,
    items: Record<string, unknown>[],
  ): Promise<{ created: number; updated: number }> {
    const repo = this.catalogRepos[catalogType];
    const { tenantId } = TenantContext.getOrThrow();
    const CODE_FIELDS = new Set(['key', 'code']);
    let created = 0;
    let updated = 0;

    for (const item of items) {
      // Normalizar igual que CatalogsService: name → MAYÚSCULAS, key/code → trim sin cambio
      const normalized: Record<string, unknown> = Object.fromEntries(
        Object.entries(item).map(([k, v]) => [
          k,
          typeof v === 'string'
            ? CODE_FIELDS.has(k)
              ? v.trim()
              : v.toUpperCase().trim()
            : v,
        ]),
      );

      const id = `${tenantId}__${this.toSlugId(normalized['name'] as string)}`;
      const exists = await repo.exists(id);

      if (!exists) {
        await repo.create(
          {
            ...normalized,
            createdAt: this.firebase.serverTimestamp(),
          } as unknown as Omit<CatalogItem, 'tenantId' | 'id'>,
          id,
        );
        created++;
      } else {
        // Actualizar todos los campos excepto createdAt (preservar fecha original)
        await repo.update(id, {
          ...normalized,
          updatedAt: this.firebase.serverTimestamp(),
        } as unknown as Partial<Omit<CatalogItem, 'tenantId' | 'id'>>);
        updated++;
      }
    }

    this.logger.log(
      `  [${catalogType}] ${created} creados, ${updated} actualizados`,
    );
    return { created, updated };
  }

  // ──────────────────────────────────────────────────────────────────────
  // USERS
  // ──────────────────────────────────────────────────────────────────────
  //
  // NOTA — `seedUsers()` (el roster completo de 16 usuarios de demo) no está
  // invocado por NINGÚN endpoint hoy: ni `runSeed()` ni ningún handler del
  // controller lo llaman (verificado — ya era así antes de esta migración,
  // no es una regresión introducida acá). Se migra igual, por consistencia y
  // para que compile sin `firestore()` directo, pero queda como candidato a
  // limpieza aparte: o se conecta a algún endpoint, o se borra.
  private async seedUsers(): Promise<{
    created: number;
    skipped: number;
    users: unknown[];
  }> {
    const seedUsers: SeedUser[] = [
      // ── SOPORTE (super-admin) ──
      {
        displayName: 'Soporte Técnico KIA',
        email: 'soporte@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.SOPORTE,
        sede: SedeEnum.ALL,
      },

      // ── JEFE DE TALLER ──
      {
        displayName: 'Carlos Mendoza',
        email: 'jefe.taller@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.JEFE_TALLER,
        sede: SedeEnum.ALL,
      },

      // ── LÍDERES TÉCNICOS ──
      {
        displayName: 'Andrés Vega',
        email: 'lider.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.LIDER_TECNICO,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Patricia Salazar',
        email: 'lider.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.LIDER_TECNICO,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Roberto Flores',
        email: 'lider.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.LIDER_TECNICO,
        sede: SedeEnum.GRANDA_CENTENO,
      },

      // ── ASESORES ──
      {
        displayName: 'María Torres',
        email: 'asesor.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Luis Paredes',
        email: 'asesor.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Elena Ruiz',
        email: 'asesor.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.GRANDA_CENTENO,
      },

      // ── PERSONAL TALLER ──
      {
        displayName: 'Juan Ríos',
        email: 'taller1.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Pedro Castro',
        email: 'taller2.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Diego Mora',
        email: 'taller1.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Felipe Montoya',
        email: 'taller1.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.GRANDA_CENTENO,
      },

      // ── DOCUMENTACIÓN ──
      {
        displayName: 'Ana Guerrero',
        email: 'docs.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.DOCUMENTACION,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Isabel Chávez',
        email: 'docs.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.DOCUMENTACION,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Sofía Herrera',
        email: 'docs.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.DOCUMENTACION,
        sede: SedeEnum.GRANDA_CENTENO,
      },
    ];

    let created = 0;
    let skipped = 0;
    const createdUsers: unknown[] = [];
    this._jefeTallerUid = 'seed-system';

    for (const u of seedUsers) {
      try {
        const { uid: userUid, wasNew } = await this.upsertAuthUser(u);
        await this.upsertUserDocument(userUid, u);

        if (u.role === RoleEnum.JEFE_TALLER) {
          this._jefeTallerUid = userUid;
        }

        if (wasNew) {
          createdUsers.push({
            uid: userUid,
            email: u.email,
            role: u.role,
            sede: u.sede,
            password: u.password,
          });
          this.logger.log(`👤 Usuario creado: ${u.email} [${u.role}]`);
          created++;
        } else {
          skipped++;
        }
      } catch (err: any) {
        this.logger.error(
          `❌ Error procesando usuario ${u.email}: ${err.message}`,
        );
      }
    }

    this.logger.log(`👥 Usuarios: ${created} creados, ${skipped} omitidos`);
    return { created, skipped, users: createdUsers };
  }

  /**
   * Crea (o recupera) el usuario en Firebase Auth y le asigna los custom
   * claims, incluido `tenantId` — el propio del contexto activo, abierto por
   * `runSeedPlatformOperation` antes de que cualquier caller llegue acá.
   *
   * CAMBIO DE COMPORTAMIENTO deliberado respecto al código pre-migración:
   * antes los claims NUNCA incluían `tenantId` (no existía el concepto). Sin
   * él, un usuario "sembrado" por este endpoint quedaría bloqueado con 401 de
   * `TenantGuard` en cuanto el guard esté registrado (ver runbook paso 5) —
   * el seeder dejaría de poder crear usuarios utilizables. Firebase Auth es
   * global (no tiene noción de tenant), así que esta llamada vive fuera de
   * cualquier repositorio — mismo criterio documentado en
   * `UsersService.create()`.
   */
  private async upsertAuthUser(
    u: SeedUser,
  ): Promise<{ uid: string; wasNew: boolean }> {
    const { tenantId } = TenantContext.getOrThrow();
    let userRecord: { uid: string };
    let wasNew = false;

    try {
      userRecord = await this.firebase.auth().getUserByEmail(u.email);
      this.logger.warn(`⏩ Usuario ya existe en Auth: ${u.email}`);
    } catch (notFound: any) {
      if (notFound?.code !== 'auth/user-not-found') throw notFound;
      userRecord = await this.firebase.auth().createUser({
        email: u.email,
        displayName: u.displayName,
        password: u.password,
        emailVerified: true,
      });
      wasNew = true;
    }

    await this.firebase.auth().setCustomUserClaims(userRecord.uid, {
      role: u.role,
      sede: u.sede,
      active: true,
      tenantId,
    });

    return { uid: userRecord.uid, wasNew };
  }

  /** Crea el documento `users/{uid}` si todavía no existe, vía `SeedUsersRepository`. */
  private async upsertUserDocument(uid: string, u: SeedUser): Promise<void> {
    if (await this.usersRepo.exists(uid)) return;

    const now = this.firebase.serverTimestamp();
    await this.usersRepo.create(
      {
        uid,
        displayName: u.displayName,
        email: u.email,
        role: u.role,
        sede: u.sede,
        active: true,
        fcmTokens: [],
        createdAt: now,
        updatedAt: now,
        createdBy: 'seed',
      },
      uid,
    );
  }

  /** UID del jefe de taller resuelto durante seedUsers */
  private _jefeTallerUid = 'seed-system';

  /** appointmentId UUID por vehicleId, para usar en seedDelivery */
  private _lastAppointmentId = new Map<string, string>();

  // ──────────────────────────────────────────────────────────────────────
  // VEHICLES — núcleo compartido (usado por Excel import)
  // Los vehículos de demo estáticos fueron eliminados. Usa /seed/from-excel.
  // ──────────────────────────────────────────────────────────────────────
  private async executeVehicleSeeding(
    seeds: VehicleSeed[],
  ): Promise<{ created: number; vehicles: unknown[] }> {
    const jefeTallerUid = this._jefeTallerUid;
    let created = 0;
    const createdVehicles: unknown[] = [];

    for (const v of seeds) {
      // Buscar por chasis para idempotencia + posible fix de certificación.
      // vehicles.query() ya viene acotado al tenant activo.
      const chassisSnap = await this.vehicles
        .query()
        .where('chassis', '==', v.vin)
        .limit(1)
        .get();

      if (!chassisSnap.empty) {
        // El vehículo ya existe — verificar si tiene certificación falsa del seed
        const existingDoc = chassisSnap.docs[0];
        const existingData = existingDoc.data();
        const existingStatus: string = existingData['status'] ?? '';

        if (existingStatus === VehicleStatus.DOCUMENTADO) {
          // Está documentado pero puede tener certificación falsa del seed — limpiarla sin tocar el estado
          this.logger.warn(
            `🔧 Vehículo ${v.vin} en DOCUMENTADO — eliminando certificación falsa si existe...`,
          );
          await this.fixFakeCertification(existingDoc.id, v.vin);
        } else {
          this.logger.warn(
            `⏩ Vehículo ya existe (${existingStatus}): ${v.vin} — sin cambios`,
          );
        }
        continue;
      }

      const vehicleId = uuidv4();
      const ts = this.firebase.serverTimestamp();

      // Fecha de entrega: usa la real del Excel si viene, si no el timestamp actual
      const finalDeliveryDate: unknown =
        v.fechaEntrega instanceof Date ? v.fechaEntrega : ts;

      await this.vehicles.create(
        {
          id: vehicleId,
          chassis: v.vin,
          model: v.model,
          year: v.year,
          color: v.color,
          originConcessionaire: v.originConcessionaire,
          photoUrl: null,
          sede: v.sede,
          status: v.status,
          // Datos del cliente precargados desde Excel para pre-rellenar el formulario de documentación
          clientName: v.clientName ?? null,
          clientId: v.clientId ?? null,
          clientPhone: v.clientPhone ?? null,
          paymentMethod: v.paymentMethod ?? PaymentMethod.CREDITO,
          receptionDate: ts,
          certificationDate: this.isAfterStatus(
            v.status,
            VehicleStatus.DOCUMENTADO,
          )
            ? ts
            : null,
          documentationDate: this.isAfterStatus(
            v.status,
            VehicleStatus.ENVIADO_A_MATRICULAR,
          )
            ? ts
            : null,
          installationCompleteDate: this.isAfterStatus(
            v.status,
            VehicleStatus.CERTIFICADO_STOCK,
          )
            ? ts
            : null,
          deliveryDate:
            v.status === VehicleStatus.ENTREGADO ? finalDeliveryDate : null,
          receivedBy: jefeTallerUid,
          certifiedBy: this.isAfterStatus(v.status, VehicleStatus.DOCUMENTADO)
            ? jefeTallerUid
            : null,
          documentedBy: this.isAfterStatus(
            v.status,
            VehicleStatus.ENVIADO_A_MATRICULAR,
          )
            ? jefeTallerUid
            : null,
          installedBy: this.isAfterStatus(
            v.status,
            VehicleStatus.EN_INSTALACION,
          )
            ? jefeTallerUid
            : null,
          deliveredBy:
            v.status === VehicleStatus.ENTREGADO ? jefeTallerUid : null,
          createdAt: ts,
          updatedAt: ts,
        },
        vehicleId,
      );

      await this.vehicles.addStatusHistory(vehicleId, {
        status: v.status,
        previousStatus: null,
        newStatus: v.status,
        changedBy: jefeTallerUid,
        changedByName: 'Seed',
        changedAt: ts,
        sede: v.sede,
        notes: 'Creado por seed',
      });

      // Certificación
      if (this.isFromStatus(v.status, VehicleStatus.CERTIFICADO_STOCK)) {
        await this.seedCertification(vehicleId, jefeTallerUid);
      }

      // Documentación
      if (this.isFromStatus(v.status, VehicleStatus.DOCUMENTACION_PENDIENTE)) {
        await this.seedDocumentation(vehicleId, v, jefeTallerUid);
      }

      // Orden de trabajo
      if (this.isFromStatus(v.status, VehicleStatus.ORDEN_GENERADA)) {
        await this.seedServiceOrder(vehicleId, v, jefeTallerUid);
      }

      // Agendamiento
      if (this.isFromStatus(v.status, VehicleStatus.AGENDADO)) {
        await this.seedAppointment(vehicleId, v, jefeTallerUid);
      }

      // Entrega
      if (v.status === VehicleStatus.ENTREGADO) {
        await this.seedDelivery(vehicleId, jefeTallerUid);
      }

      createdVehicles.push({
        id: vehicleId,
        chassis: v.vin,
        status: v.status,
        sede: v.sede,
      });
      this.logger.log(`🚗 Vehículo creado: ${v.vin} [${v.status}] — ${v.sede}`);
      created++;
    }

    this.logger.log(`🚘 Vehículos: ${created} creados`);
    return { created, vehicles: createdVehicles };
  }

  // ──────────────────────────────────────────────────────────────────────
  // CERTIFICATIONS — vía CertificationsRepository (ya migrado, inyectado)
  // ──────────────────────────────────────────────────────────────────────
  private async seedCertification(
    vehicleId: string,
    byUid: string,
  ): Promise<void> {
    if (await this.certifications.exists(vehicleId)) return;

    const ts = this.firebase.serverTimestamp();
    await this.certifications.create(
      {
        vehicleId,
        // Checklist técnico — estructura idéntica a certifications.service.ts
        radio: InstalledStatus.INSTALADO,
        rims: {
          status: RimsStatus.BUENOS,
          photoUrl: null,
        },
        seatType: SeatType.CUERO,
        antenna: AntennaType.TIBURON,
        trunkCover: InstalledStatus.INSTALADO,
        mileage: 3,
        imprints: ImprintsStatus.CON_IMPRONTAS,
        notes: null,
        certifiedAt: ts,
        certifiedBy: byUid,
      },
      vehicleId,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // DOCUMENTATION — vía DocumentationRepository (ya migrado, inyectado)
  // ──────────────────────────────────────────────────────────────────────
  private async seedDocumentation(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    if (await this.documentations.exists(vehicleId)) return;

    const accessories = Object.values(AccessoryKey).map((key) => ({
      key,
      classification: AccessoryClassification.NO_APLICA,
    }));

    const ts = this.firebase.serverTimestamp();
    await this.documentations.create(
      {
        vehicleId,
        // Campos idénticos a documentation.service.ts → create()
        clientName: vehicle.clientName,
        clientId: vehicle.clientId,
        clientPhone: vehicle.clientPhone,
        registrationType: 'NORMAL',
        paymentMethod: vehicle.paymentMethod ?? PaymentMethod.CREDITO,
        vehicleInvoiceUrl: null,
        giftEmailUrl: null,
        accessoryInvoiceUrl: null,
        // Retrocompat: DocumentationRepository espera también los arrays —
        // ver el comentario de DocumentationDocument en documentation.repository.ts.
        giftEmailUrls: [],
        accessoryInvoiceUrls: [],
        registrationReceivedDate: null,
        accessories,
        documentationStatus: 'COMPLETO',
        documentedAt: ts,
        documentedBy: byUid,
        // paymentMethod viene del vehículo (Excel lo sobreescribe; default: CREDITO)
        createdAt: ts,
        updatedAt: ts,
      },
      vehicleId,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // SERVICE ORDERS — vía ServiceOrdersRepository (ya migrado, inyectado)
  // ──────────────────────────────────────────────────────────────────────
  private async seedServiceOrder(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    const existing = await this.serviceOrders
      .query()
      .where('vehicleId', '==', vehicleId)
      .limit(1)
      .get();
    if (!existing.empty) return;

    const orderId = uuidv4();
    // Formato idéntico a generateOrderNumber() de service-orders.service.ts
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `ORD-${vehicle.sede}-${dateStr}-SEED`;
    const ts = this.firebase.serverTimestamp();

    const accessories = Object.values(AccessoryKey).map((key) => ({
      key,
      classification: AccessoryClassification.NO_APLICA,
    }));

    const installedAll = this.isFromStatus(
      vehicle.status,
      VehicleStatus.INSTALACION_COMPLETA,
    );

    await this.serviceOrders.create(
      {
        orderNumber,
        vehicleId,
        sede: vehicle.sede,
        chassis: vehicle.vin,
        accessories,
        predictions: [],
        checklist: accessories.map((a) => ({
          key: a.key,
          installed: installedAll,
        })),
        assignedTechnicianId: installedAll ? byUid : null,
        assignedTechnicianName: installedAll ? 'Juan Ríos' : null,
        assignedAt: installedAll ? ts : null,
        status: installedAll ? 'COMPLETA' : 'GENERADA',
        isReopening: false,
        previousOrderId: null,
        createdBy: byUid,
        createdByName: 'Carlos Mendoza',
        createdAt: ts,
        updatedAt: ts,
      },
      orderId,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // APPOINTMENTS — vía AppointmentsRepository (ya migrado, inyectado)
  // ──────────────────────────────────────────────────────────────────────
  private async seedAppointment(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    // countFiltered() en vez de listAll(): evita depender de un índice
    // compuesto (tenantId==, vehicleId==, orderBy scheduledDate/scheduledTime)
    // solo para chequear existencia.
    const existingCount = await this.appointments.countFiltered({
      vehicleId,
    });
    if (existingCount > 0) return;

    // ID UUID igual que appointments.service.ts → create()
    const appointmentId = uuidv4();
    const ts = this.firebase.serverTimestamp();

    await this.appointments.create(
      {
        vehicleId,
        chassis: vehicle.vin,
        model: vehicle.model,
        color: vehicle.color ?? null,
        sede: vehicle.sede,
        clientName: vehicle.clientName ?? null,
        clientId: vehicle.clientId ?? null,
        scheduledDate: '2026-03-15',
        scheduledTime: '10:00',
        assignedAdvisorId: byUid,
        assignedAdvisorName: 'María Torres',
        status: 'AGENDADO',
        createdBy: byUid,
        createdByName: 'Carlos Mendoza',
        createdAt: ts,
        updatedAt: ts,
      },
      appointmentId,
    );

    // Guardar appointmentId para consulta posterior (entrega)
    this._lastAppointmentId.set(vehicleId, appointmentId);
  }

  // ──────────────────────────────────────────────────────────────────────
  // DELIVERIES — vía DeliveryRepository (ya migrado, inyectado)
  // ──────────────────────────────────────────────────────────────────────
  private async seedDelivery(vehicleId: string, byUid: string): Promise<void> {
    // Colección y esquema idénticos a delivery.service.ts → createCeremony()
    if (await this.deliveries.exists(vehicleId)) return;

    // Usar el appointmentId UUID generado en seedAppointment
    const appointmentId =
      this._lastAppointmentId.get(vehicleId) ?? `fallback-apt-${vehicleId}`;
    const ts = this.firebase.serverTimestamp();

    await this.deliveries.create(
      {
        vehicleId,
        appointmentId,
        deliveryPhotoUrl: null,
        signedActaUrl: null,
        clientComment: 'Cliente totalmente satisfecho con la entrega.',
        deliveredBy: byUid,
        deliveredByName: 'Carlos Mendoza',
        createdAt: ts,
      },
      vehicleId,
    );

    // Marcar agendamiento como ENTREGADO (igual que delivery.service.ts)
    if (appointmentId && !appointmentId.startsWith('fallback-')) {
      await this.appointments.update(appointmentId, {
        status: 'ENTREGADO',
        updatedAt: ts,
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // FIX CERTIFICACIÓN FALSA DEL SEED
  // Para vehículos en DOCUMENTADO que tienen una certificación falsa
  // creada por el seed. Solo elimina la certificación — el estado y la
  // documentación no se tocan.
  // ──────────────────────────────────────────────────────────────────────
  private async fixFakeCertification(
    vehicleId: string,
    chassis: string,
  ): Promise<void> {
    const deleted = await this.certifications.delete(vehicleId);

    if (!deleted) {
      this.logger.log(`  ℹ️  Sin certificación que eliminar: ${chassis}`);
      return;
    }

    this.logger.log(
      `  ✅ ${chassis} — certificación falsa eliminada, listo para certificar`,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────
  private readonly STATUS_ORDER: VehicleStatus[] = [
    VehicleStatus.POR_ARRIBAR,
    VehicleStatus.ENVIADO_A_MATRICULAR,
    VehicleStatus.DOCUMENTACION_PENDIENTE,
    VehicleStatus.DOCUMENTADO,
    VehicleStatus.CERTIFICADO_STOCK,
    VehicleStatus.ORDEN_GENERADA,
    VehicleStatus.ASIGNADO,
    VehicleStatus.EN_INSTALACION,
    VehicleStatus.INSTALACION_COMPLETA,
    VehicleStatus.LISTO_PARA_ENTREGA,
    VehicleStatus.AGENDADO,
    VehicleStatus.ENTREGADO,
  ];

  /** `true` si `current` es estrictamente posterior a `reference` en el flujo */
  private isAfterStatus(
    current: VehicleStatus,
    reference: VehicleStatus,
  ): boolean {
    return (
      this.STATUS_ORDER.indexOf(current) > this.STATUS_ORDER.indexOf(reference)
    );
  }

  /** `true` si `current` es igual o posterior a `reference` */
  private isFromStatus(
    current: VehicleStatus,
    reference: VehicleStatus,
  ): boolean {
    return (
      this.STATUS_ORDER.indexOf(current) >= this.STATUS_ORDER.indexOf(reference)
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // EXCEL / CSV IMPORT
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Normaliza un string para comparación fuzzy:
   * minúscula + sin tildes + sin espacios extras
   */
  private norm(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  /**
   * Busca el valor de una columna en una fila por cualquiera de los alias
   * proporcionados, usando comparación normalizada (sin tildes, case-insensitive).
   * Devuelve undefined si ninguno coincide.
   */
  private col(
    row: Record<string, unknown>,
    ...aliases: string[]
  ): string | undefined {
    const normAliases = aliases.map((a) => this.norm(a));
    for (const key of Object.keys(row)) {
      if (normAliases.includes(this.norm(key))) {
        const val = row[key];
        if (val !== null && val !== undefined && val !== '') {
          return String(val);
        }
      }
    }
    return undefined;
  }

  /**
   * Parsea un buffer de Excel (.xlsx/.xls) o CSV y devuelve filas como objetos.
   */
  private parseBuffer(
    buffer: Buffer,
    mimetype: string,
  ): Record<string, unknown>[] {
    const isCSV =
      mimetype.includes('csv') ||
      mimetype.includes('text/plain') ||
      mimetype.includes('text/comma');

    const workbook = isCSV
      ? XLSX.read(buffer, { type: 'buffer', raw: false })
      : XLSX.read(buffer, { type: 'buffer', cellDates: true });

    const sheetName = workbook.SheetNames[0];
    this.logger.log(`📄 Hoja/Sheet: '${sheetName}'`);
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      { defval: '' },
    );
  }

  /**
   * Inspección de diagnóstico: devuelve columnas encontradas y las 3 primeras filas
   * sin insertar nada en Firestore.
   *
   * NO recibe `tenantId` ni pasa por `runSeedPlatformOperation`: no toca
   * Firestore en absoluto (solo parsea el buffer en memoria), así que no hay
   * ningún tenant que resolver — ver seed-platform-context.ts.
   */
  async inspectFile(
    buffer: Buffer,
    mimetype: string,
    secretKey: string,
  ): Promise<{ columns: string[]; sample: Record<string, unknown>[] }> {
    this.validateSeedKey(secretKey);
    const rows = this.parseBuffer(buffer, mimetype);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    this.logger.log(`🔍 Columnas encontradas: ${JSON.stringify(columns)}`);
    return { columns, sample: rows.slice(0, 3) };
  }

  /**
   * Procesa Excel (.xlsx/.xls) o CSV y ejecuta el seed de vehículos.
   *
   * Compatible con cualquier nombre de columna: la búsqueda es fuzzy
   * (sin tildes, case-insensitive). Aliases soportados:
   *
   *  VIN/chasis   : "Numero chasis" | "chasis" | "vin" | "Número chasis"
   *  Modelo       : "Familia" | "Modelo" | "modelo vehiculo"
   *  Año          : "Ano Vehiculo" | "Anio" | "year" | "Año Vehículo"
   *  Color        : "Color vehiculo" | "color" | "Color vehículo"
   *  Sede         : "Concesionario asignado" | "sede" | "concesionario"
   *  Cliente      : "Nombre cliente" | "cliente"
   *  Teléfono     : "Telefono Movil" | "celular" | "telefono"
   *  Estado       : "ESTADO" | "estado"
   *  Pago         : "FORMA DE PAGO" | "forma pago" | "pago"
   *  Fecha entrega: "FECHA ENTREGA" | "fecha entrega" | "fecha_entrega"
   */
  async seedFromExcel(
    buffer: Buffer,
    mimetype: string,
    secretKey: string,
    tenantId: string,
    options: { clear?: boolean } = {},
  ): Promise<{ created: number; vehicles: unknown[]; skippedRows: number }> {
    this.validateSeedKey(secretKey);

    // El parseo del archivo no toca Firestore — se hace fuera del contexto
    // de tenant, igual que inspectFile(). Solo la escritura (más abajo)
    // necesita el contexto abierto.
    const rows = this.parseBuffer(buffer, mimetype);
    this.logger.log(`📊 Filas totales leídas: ${rows.length}`);

    if (rows.length === 0) {
      this.logger.warn(
        '⚠️  El archivo no tiene filas o la primera fila no es cabecera válida',
      );
      return { created: 0, vehicles: [], skippedRows: 0 };
    }

    // Log de columnas reales para diagnóstico
    const foundColumns = Object.keys(rows[0]);
    this.logger.log(`🔍 Columnas detectadas: ${JSON.stringify(foundColumns)}`);

    let skippedRows = 0;
    const vehicles: VehicleSeed[] = [];

    for (const row of rows) {
      // Aliases: nombres en español (originales) + inglés (Excel limpio)
      const vinRaw = this.col(
        row,
        'chassis',
        'chasis',
        'Numero chasis',
        'Número chasis',
        'vin',
        'numero de chasis',
        'número de chasis',
      );

      if (!vinRaw || !vinRaw.trim()) {
        skippedRows++;
        continue;
      }

      const estadoRaw = (this.col(row, 'status', 'ESTADO', 'estado') ?? '')
        .toUpperCase()
        .trim();
      const esEntregado = estadoRaw === 'ENTREGADO';
      const esDocumentado = estadoRaw === 'DOCUMENTADO';

      const pagoRaw = (
        this.col(
          row,
          'paymentMethod',
          'paymentmethod',
          'FORMA DE PAGO',
          'forma de pago',
          'pago',
          'payment',
        ) ?? ''
      ).toUpperCase();
      const paymentMethod = pagoRaw.includes('CONTADO')
        ? PaymentMethod.CONTADO
        : PaymentMethod.CREDITO;

      // Fecha de entrega: solo se parsea para vehículos ENTREGADO — el resto entra con null
      let fechaEntrega: Date | undefined;
      if (esEntregado) {
        const rawFecha =
          row[
            Object.keys(row).find((k) =>
              [
                'deliverydate',
                'fechaentrega',
                'fecha entrega',
                'fecha_entrega',
              ].includes(this.norm(k)),
            ) ?? ''
          ];
        if (rawFecha instanceof Date) {
          fechaEntrega = rawFecha;
        } else if (typeof rawFecha === 'string' && rawFecha.trim()) {
          const parsed = new Date(rawFecha.trim());
          if (!isNaN(parsed.getTime())) fechaEntrega = parsed;
        } else if (typeof rawFecha === 'number') {
          fechaEntrega = XLSX.SSF.parse_date_code(rawFecha) as unknown as Date;
        }
      }

      const yearRaw = this.col(
        row,
        'year',
        'ano',
        'año',
        'Ano Vehiculo',
        'Año Vehículo',
        'anio vehiculo',
      );
      const year = yearRaw
        ? parseInt(yearRaw, 10) || new Date().getFullYear()
        : new Date().getFullYear();

      const sedeRaw =
        this.col(
          row,
          'sede',
          'Concesionario asignado',
          'concesionario',
          'dealer',
        ) ?? '';

      vehicles.push({
        vin: vinRaw.trim().toUpperCase(),
        model: (
          this.col(
            row,
            'model',
            'Familia',
            'familia',
            'Modelo',
            'modelo',
            'modelo vehiculo',
          ) ?? 'KIA'
        ).toUpperCase(),
        year,
        color: (
          this.col(
            row,
            'color',
            'Color vehiculo',
            'Color vehículo',
            'colour',
          ) ?? ''
        ).toUpperCase(),
        sede: this.mapSede(sedeRaw),
        status: esEntregado
          ? VehicleStatus.ENTREGADO
          : esDocumentado
            ? VehicleStatus.DOCUMENTADO
            : VehicleStatus.POR_ARRIBAR,
        originConcessionaire: sedeRaw.toUpperCase(),
        clientName: (
          this.col(
            row,
            'clientName',
            'clientname',
            'Nombre cliente',
            'cliente',
            'nombre',
          ) ?? ''
        ).toUpperCase(),
        clientId:
          this.col(row, 'clientId', 'clientid', 'cedula', 'identificacion') ??
          '',
        clientPhone:
          this.col(
            row,
            'clientPhone',
            'clientphone',
            'Telefono Movil',
            'Teléfono Móvil',
            'celular',
            'phone',
          ) ?? '',
        paymentMethod,
        fechaEntrega,
      });
    }

    this.logger.log(
      `🚗 Vehículos a procesar: ${vehicles.length} (${skippedRows} filas sin chasis omitidas)`,
    );

    return runSeedPlatformOperation(
      { tenantId, reason: 'seed:from-excel', tenants: this.tenants, audit: this.audit },
      async () => {
        if (options.clear) {
          this.logger.log(
            '🗑️  Limpiando colecciones anteriores antes del import...',
          );
          await this.clearCollections();
        }

        const result = await this.executeVehicleSeeding(vehicles);
        return { ...result, skippedRows };
      },
    );
  }

  /** Mapea el nombre del concesionario del Excel a SedeEnum */
  private mapSede(excelSede: string): SedeEnum {
    const s = this.norm(excelSede);
    if (s.includes('sur')) return SedeEnum.SURMOTOR;
    if (s.includes('shyris')) return SedeEnum.SHYRIS;
    if (s.includes('granda') || s.includes('centeno'))
      return SedeEnum.GRANDA_CENTENO;
    if (excelSede.trim()) {
      this.logger.warn(
        `⚠️  Sede desconocida: '${excelSede}' → asignando SURMOTOR`,
      );
    }
    return SedeEnum.SURMOTOR;
  }

  // ──────────────────────────────────────────────────────────────────────
  // RESET CERTIFICADO_STOCK → POR_ARRIBAR (sin eliminar vehículos)
  // ──────────────────────────────────────────────────────────────────────
  async resetToPorArribar(
    secretKey: string,
    tenantId: string,
  ): Promise<{ total: number; reset: number; details: unknown[] }> {
    this.validateSeedKey(secretKey);

    return runSeedPlatformOperation(
      {
        tenantId,
        reason: 'seed:reset-to-por-arribar',
        tenants: this.tenants,
        audit: this.audit,
      },
      async () => {
        // Buscar todos los vehículos en CERTIFICADO_STOCK — query() ya viene
        // acotado al tenant activo.
        const snap = await this.vehicles
          .query()
          .where('status', '==', VehicleStatus.CERTIFICADO_STOCK)
          .get();

        if (snap.empty) {
          this.logger.log(
            '✅ No hay vehículos en CERTIFICADO_STOCK para resetear',
          );
          return { total: 0, reset: 0, details: [] };
        }

        const details: unknown[] = [];
        let reset = 0;

        for (const doc of snap.docs) {
          const vehicle = doc.data();
          const vehicleId = doc.id;
          const chassis = vehicle['chassis'];

          try {
            // 1. Eliminar certificación si existe
            const certDeleted = await this.certifications.delete(vehicleId);
            if (certDeleted) {
              this.logger.log(`  🗑️  Certificación eliminada: ${chassis}`);
            }

            // 2. Eliminar documentación si existe
            const docDeleted = await this.documentations.delete(vehicleId);
            if (docDeleted) {
              this.logger.log(`  🗑️  Documentación eliminada: ${chassis}`);
            }

            // 3. Resetear campos del vehículo a estado POR_ARRIBAR
            const ts = this.firebase.serverTimestamp();
            await this.vehicles.update(vehicleId, {
              status: VehicleStatus.POR_ARRIBAR,
              registrationSentDate: null,
              registrationReceivedDate: null,
              receptionDate: null,
              certificationDate: null,
              certifiedBy: null,
              documentationDate: null,
              documentedBy: null,
              installationCompleteDate: null,
              installedBy: null,
              deliveryDate: null,
              deliveredBy: null,
              originConcessionaire: null,
              photoUrl: null,
              updatedAt: ts,
            });

            // 4. Registrar en historial. addStatusHistory() genera el id del
            // documento automáticamente (a diferencia del código original,
            // que fijaba un uuid propio) — nada lee ese id, así que no hay
            // cambio de comportamiento observable.
            await this.vehicles.addStatusHistory(vehicleId, {
              status: VehicleStatus.POR_ARRIBAR,
              previousStatus: VehicleStatus.CERTIFICADO_STOCK,
              newStatus: VehicleStatus.POR_ARRIBAR,
              changedBy: 'seed-system',
              changedByName: 'Seed Reset',
              changedAt: ts,
              sede: vehicle['sede'],
              notes: 'Reset masivo de CERTIFICADO_STOCK → POR_ARRIBAR por seed',
            });

            details.push({
              vehicleId,
              chassis,
              sede: vehicle['sede'],
              status: 'reset',
            });
            this.logger.log(`  ✅ ${chassis} → POR_ARRIBAR`);
            reset++;
          } catch (err: any) {
            this.logger.error(
              `  ❌ Error reseteando ${chassis}: ${err.message}`,
            );
            details.push({
              vehicleId,
              chassis,
              status: 'error',
              error: err.message,
            });
          }
        }

        this.logger.log(`🔄 Reset completado: ${reset}/${snap.size} vehículos`);
        return { total: snap.size, reset, details };
      },
    );
  }
}
