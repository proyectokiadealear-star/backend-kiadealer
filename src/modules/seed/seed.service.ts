import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../firebase/firebase.service';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { AccessoryKey, AccessoryClassification } from '../../common/enums/accessory-key.enum';

interface SeedUser {
  displayName: string;
  email: string;
  password: string;
  role: RoleEnum;
  sede: SedeEnum;
}

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  private get db() {
    return this.firebase.firestore();
  }

  // ──────────────────────────────────────────────────────────────────────
  // GUARD: sólo se ejecuta con la clave correcta
  // ──────────────────────────────────────────────────────────────────────
  private validateSeedKey(key: string): void {
    const expected = this.config.get<string>('SEED_SECRET_KEY') ?? 'kia-seed-2024';
    if (key !== expected) {
      throw new ForbiddenException('Clave de seed inválida');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // ENTRY POINT
  // ──────────────────────────────────────────────────────────────────────
  async runSeed(secretKey: string, options: { clear?: boolean } = {}): Promise<Record<string, unknown>> {
    this.validateSeedKey(secretKey);

    this.logger.log('🌱 Iniciando proceso de seed...');

    const results: Record<string, unknown> = {};

    if (options.clear) {
      await this.clearCollections();
      results['cleared'] = true;
    }

    results['catalogs'] = await this.seedCatalogs();
    results['users'] = await this.seedUsers();
    results['vehicles'] = await this.seedVehicles();

    this.logger.log('✅ Seed completado con éxito');
    return results;
  }

  // ──────────────────────────────────────────────────────────────────────
  // CLEAR (solo dev)
  // ──────────────────────────────────────────────────────────────────────
  private async clearCollections(): Promise<void> {
    const collections = [
      'vehicles', 'documentations', 'certifications',
      'service-orders', 'appointments', 'deliveries', 'notifications',
    ];
    const catalogSubcollections = ['colors', 'models', 'concessionaires', 'accessories', 'sedes'];

    for (const col of collections) {
      try {
        const snap = await this.db.collection(col).limit(500).get();
        if (!snap.empty) {
          const batch = this.db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (e: any) {
        this.logger.warn(`No se pudo limpiar '${col}': ${e.message}`);
      }
    }

    for (const sub of catalogSubcollections) {
      try {
        const snap = await this.db.collection('catalogs').doc(sub).collection('items').limit(500).get();
        if (!snap.empty) {
          const batch = this.db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (e: any) {
        this.logger.warn(`No se pudo limpiar catálogo '${sub}': ${e.message}`);
      }
    }

    this.logger.log('🗑️  Colecciones limpiadas');
  }

  // ──────────────────────────────────────────────────────────────────────
  // CATALOGS
  // ──────────────────────────────────────────────────────────────────────
  private async seedCatalogs(): Promise<Record<string, number>> {
    const colors = [
      'BLANCO GLACIAR', 'NEGRO PERLA', 'ROJO AURORA', 'AZUL SAFIRO',
      'GRIS PLATINO', 'PLATA METEORICO', 'VERDE ESMERALDA', 'CAFE BRONCE',
      'BLANCO PERLA', 'NEGRO MEDIANOCHE', 'GRIS ACERO', 'AZUL CIELO',
    ];

    const models = [
      'KIA SPORTAGE', 'KIA PICANTO', 'KIA RIO', 'KIA SORENTO',
      'KIA STINGER', 'KIA SOUL', 'KIA SELTOS', 'KIA EV6',
      'KIA CARNIVAL', 'KIA TELLURIDE',
    ];

    const concessionaires = [
      { name: 'KIA SURMOTOR', code: SedeEnum.SURMOTOR },
      { name: 'KIA SHYRIS', code: SedeEnum.SHYRIS },
      { name: 'KIA GRANADAS CENTENOS', code: SedeEnum.GRANADAS_CENTENOS },
    ];

    const sedes = [
      { name: 'SURMOTOR', code: SedeEnum.SURMOTOR },
      { name: 'SHYRIS', code: SedeEnum.SHYRIS },
      { name: 'GRANADAS CENTENOS', code: SedeEnum.GRANADAS_CENTENOS },
    ];

    const accessories = [
      { name: 'BOTON DE ENCENDIDO',     key: AccessoryKey.BOTON_ENCENDIDO },
      { name: 'KIT DE CARRETERA',        key: AccessoryKey.KIT_CARRETERA },
      { name: 'AROS',                    key: AccessoryKey.AROS },
      { name: 'LAMINAS',                 key: AccessoryKey.LAMINAS },
      { name: 'MOQUETAS',                key: AccessoryKey.MOQUETAS },
      { name: 'CUBREMALETAS',            key: AccessoryKey.CUBREMALETAS },
      { name: 'SEGURO SATELITAL',        key: AccessoryKey.SEGURO },
      { name: 'TELEMETRIA',              key: AccessoryKey.TELEMETRIA },
      { name: 'SENSORES DE PROXIMIDAD',  key: AccessoryKey.SENSORES },
      { name: 'ALARMA',                  key: AccessoryKey.ALARMA },
      { name: 'NEBLINEROS',              key: AccessoryKey.NEBLINEROS },
      { name: 'KIT DE SEGURIDAD',        key: AccessoryKey.KIT_SEGURIDAD },
      { name: 'PROTECTOR CERAMICO',      key: AccessoryKey.PROTECTOR_CERAMICO },
      { name: 'OTROS',                   key: AccessoryKey.OTROS },
    ];

    const savedColors = await this.bulkUpsertCatalog('colors', colors.map((name) => ({ name })));
    const savedModels = await this.bulkUpsertCatalog('models', models.map((name) => ({ name })));
    const savedConcessionaires = await this.bulkUpsertCatalog(
      'concessionaires',
      concessionaires.map((c) => ({ name: c.name, code: c.code })),
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
      `📦 Catálogos: ${savedColors} colores, ${savedModels} modelos, ` +
      `${savedConcessionaires} concesionarios, ${savedSedes} sedes, ${savedAccessories} accesorios`,
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
   * Upsert de items de catálogo usando IDs deterministas (slug del nombre).
   * Usa lectura directa de documento → NO requiere índices Firestore.
   */
  private async bulkUpsertCatalog(
    subcollection: string,
    items: Record<string, unknown>[],
  ): Promise<number> {
    let count = 0;
    for (const item of items) {
      const id = this.toSlugId(item['name'] as string);
      const ref = this.db
        .collection('catalogs')
        .doc(subcollection)
        .collection('items')
        .doc(id);

      // Lectura directa por ID: nunca requiere índice
      const snap = await ref.get();
      if (snap.exists) continue;

      await ref.set({ id, ...item, createdAt: this.firebase.serverTimestamp() });
      count++;
    }
    return count;
  }

  // ──────────────────────────────────────────────────────────────────────
  // USERS
  // ──────────────────────────────────────────────────────────────────────
  private async seedUsers(): Promise<{ created: number; skipped: number; users: unknown[] }> {
    const seedUsers: SeedUser[] = [
      // ── JEFE DE TALLER ──
      {
        displayName: 'Carlos Mendoza (Jefe Taller)',
        email: 'jefe.taller@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.JEFE_TALLER,
        sede: SedeEnum.ALL,
      },

      // ── LÍDERES TÉCNICOS ──
      {
        displayName: 'Andrés Vega (Líder Surmotor)',
        email: 'lider.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.LIDER_TECNICO,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Patricia Salazar (Líder Shyris)',
        email: 'lider.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.LIDER_TECNICO,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Roberto Flores (Líder Granadas)',
        email: 'lider.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.LIDER_TECNICO,
        sede: SedeEnum.GRANADAS_CENTENOS,
      },

      // ── ASESORES ──
      {
        displayName: 'María Torres (Asesor Surmotor)',
        email: 'asesor.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Luis Paredes (Asesor Shyris)',
        email: 'asesor.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Elena Ruiz (Asesor Granadas)',
        email: 'asesor.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.ASESOR,
        sede: SedeEnum.GRANADAS_CENTENOS,
      },

      // ── PERSONAL TALLER ──
      {
        displayName: 'Juan Ríos (Taller Surmotor)',
        email: 'taller1.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Pedro Castro (Taller Surmotor)',
        email: 'taller2.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Diego Mora (Taller Shyris)',
        email: 'taller1.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Felipe Montoya (Taller Granadas)',
        email: 'taller1.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.PERSONAL_TALLER,
        sede: SedeEnum.GRANADAS_CENTENOS,
      },

      // ── DOCUMENTACIÓN ──
      {
        displayName: 'Ana Guerrero (Docs Surmotor)',
        email: 'docs.surmotor@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.DOCUMENTACION,
        sede: SedeEnum.SURMOTOR,
      },
      {
        displayName: 'Isabel Chávez (Docs Shyris)',
        email: 'docs.shyris@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.DOCUMENTACION,
        sede: SedeEnum.SHYRIS,
      },
      {
        displayName: 'Sofía Herrera (Docs Granadas)',
        email: 'docs.granadas@kiadealer.com',
        password: 'KiaDealer2024!',
        role: RoleEnum.DOCUMENTACION,
        sede: SedeEnum.GRANADAS_CENTENOS,
      },
    ];

    let created = 0;
    let skipped = 0;
    const createdUsers: unknown[] = [];
    // Se resuelve durante el loop para usarlo en seedVehicles
    this._jefeTallerUid = 'seed-system';

    for (const u of seedUsers) {
      try {
        let userRecord: { uid: string };
        let wasNew = false;

        // Verificar existencia directamente en Firebase Auth (sin query Firestore)
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

        // Actualizar custom claims (idempotente)
        await this.firebase.auth().setCustomUserClaims(userRecord.uid, {
          role: u.role,
          sede: u.sede,
          active: true,
        });

        // Upsert Firestore usando uid como ID (lectura directa, sin query)
        const firestoreRef = this.db.collection('users').doc(userRecord.uid);
        const firestoreSnap = await firestoreRef.get();
        if (!firestoreSnap.exists) {
          const now = this.firebase.serverTimestamp();
          await firestoreRef.set({
            uid: userRecord.uid,
            displayName: u.displayName,
            email: u.email,
            role: u.role,
            sede: u.sede,
            active: true,
            fcmTokens: [],
            createdAt: now,
            updatedAt: now,
            createdBy: 'seed',
          });
        }

        if (u.role === RoleEnum.JEFE_TALLER) {
          this._jefeTallerUid = userRecord.uid;
        }

        if (wasNew) {
          createdUsers.push({
            uid: userRecord.uid,
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
        this.logger.error(`❌ Error procesando usuario ${u.email}: ${err.message}`);
      }
    }

    this.logger.log(`👥 Usuarios: ${created} creados, ${skipped} omitidos`);
    return { created, skipped, users: createdUsers };
  }

  // UID del jefe de taller resuelto en seedUsers
  private _jefeTallerUid = 'seed-system';

  // ──────────────────────────────────────────────────────────────────────
  // VEHICLES
  // ──────────────────────────────────────────────────────────────────────
  private async seedVehicles(): Promise<{ created: number; vehicles: unknown[] }> {
    const year = new Date().getFullYear();
    // Se resolvió en seedUsers (que se ejecuta antes)
    const jefeTallerUid = this._jefeTallerUid;

    const vehicleSeeds = [
      // ── SURMOTOR ────────────────────────────────────────────────
      {
        chassis: `KIA-SM-${year}-001`,
        model: 'KIA SPORTAGE',
        color: 'BLANCO GLACIAR',
        sede: SedeEnum.SURMOTOR,
        status: VehicleStatus.RECEPCIONADO,
        originConcessionaire: 'KIA SURMOTOR',
      },
      {
        chassis: `KIA-SM-${year}-002`,
        model: 'KIA PICANTO',
        color: 'ROJO AURORA',
        sede: SedeEnum.SURMOTOR,
        status: VehicleStatus.CERTIFICADO_STOCK,
        originConcessionaire: 'KIA SURMOTOR',
      },
      {
        chassis: `KIA-SM-${year}-003`,
        model: 'KIA RIO',
        color: 'NEGRO PERLA',
        sede: SedeEnum.SURMOTOR,
        status: VehicleStatus.DOCUMENTACION_PENDIENTE,
        originConcessionaire: 'KIA SURMOTOR',
      },
      {
        chassis: `KIA-SM-${year}-004`,
        model: 'KIA SORENTO',
        color: 'GRIS PLATINO',
        sede: SedeEnum.SURMOTOR,
        status: VehicleStatus.DOCUMENTADO,
        originConcessionaire: 'KIA SURMOTOR',
      },
      {
        chassis: `KIA-SM-${year}-005`,
        model: 'KIA SELTOS',
        color: 'AZUL SAFIRO',
        sede: SedeEnum.SURMOTOR,
        status: VehicleStatus.LISTO_PARA_ENTREGA,
        originConcessionaire: 'KIA SURMOTOR',
      },

      // ── SHYRIS ──────────────────────────────────────────────────
      {
        chassis: `KIA-SH-${year}-001`,
        model: 'KIA EV6',
        color: 'PLATA METEORICO',
        sede: SedeEnum.SHYRIS,
        status: VehicleStatus.RECEPCIONADO,
        originConcessionaire: 'KIA SHYRIS',
      },
      {
        chassis: `KIA-SH-${year}-002`,
        model: 'KIA STINGER',
        color: 'NEGRO PERLA',
        sede: SedeEnum.SHYRIS,
        status: VehicleStatus.DOCUMENTACION_PENDIENTE,
        originConcessionaire: 'KIA SHYRIS',
      },
      {
        chassis: `KIA-SH-${year}-003`,
        model: 'KIA CARNIVAL',
        color: 'BLANCO GLACIAR',
        sede: SedeEnum.SHYRIS,
        status: VehicleStatus.ORDEN_GENERADA,
        originConcessionaire: 'KIA SHYRIS',
      },
      {
        chassis: `KIA-SH-${year}-004`,
        model: 'KIA SOUL',
        color: 'VERDE ESMERALDA',
        sede: SedeEnum.SHYRIS,
        status: VehicleStatus.EN_INSTALACION,
        originConcessionaire: 'KIA SHYRIS',
      },
      {
        chassis: `KIA-SH-${year}-005`,
        model: 'KIA SORENTO',
        color: 'GRIS PLATINO',
        sede: SedeEnum.SHYRIS,
        status: VehicleStatus.INSTALACION_COMPLETA,
        originConcessionaire: 'KIA SHYRIS',
      },

      // ── GRANADAS CENTENOS ────────────────────────────────────────
      {
        chassis: `KIA-GC-${year}-001`,
        model: 'KIA TELLURIDE',
        color: 'CAFE BRONCE',
        sede: SedeEnum.GRANADAS_CENTENOS,
        status: VehicleStatus.RECEPCIONADO,
        originConcessionaire: 'KIA GRANADAS CENTENOS',
      },
      {
        chassis: `KIA-GC-${year}-002`,
        model: 'KIA SPORTAGE',
        color: 'ROJO AURORA',
        sede: SedeEnum.GRANADAS_CENTENOS,
        status: VehicleStatus.CERTIFICADO_STOCK,
        originConcessionaire: 'KIA GRANADAS CENTENOS',
      },
      {
        chassis: `KIA-GC-${year}-003`,
        model: 'KIA RIO',
        color: 'AZUL SAFIRO',
        sede: SedeEnum.GRANADAS_CENTENOS,
        status: VehicleStatus.LISTO_PARA_ENTREGA,
        originConcessionaire: 'KIA GRANADAS CENTENOS',
      },
      {
        chassis: `KIA-GC-${year}-004`,
        model: 'KIA PICANTO',
        color: 'PLATA METEORICO',
        sede: SedeEnum.GRANADAS_CENTENOS,
        status: VehicleStatus.ENTREGADO,
        originConcessionaire: 'KIA GRANADAS CENTENOS',
      },
    ];

    let created = 0;
    const createdVehicles: unknown[] = [];

    for (const v of vehicleSeeds) {
      // ID determinista basado en chassis → lectura directa, sin query where
      const vehicleId = `seed-${v.chassis.replace(/-/g, '').toLowerCase()}`;
      const ref = this.db.collection('vehicles').doc(vehicleId);
      const existingSnap = await ref.get();

      if (existingSnap.exists) {
        this.logger.warn(`⏩ Vehículo ya existe: ${v.chassis}`);
        continue;
      }

      const ts = this.firebase.serverTimestamp();

      const vehicleData: Record<string, unknown> = {
        id: vehicleId,
        chassis: v.chassis,
        model: v.model,
        year,
        color: v.color,
        originConcessionaire: v.originConcessionaire,
        photoUrl: null,
        sede: v.sede,
        status: v.status,
        receptionDate: ts,
        certificationDate: this.isAfterStatus(v.status, VehicleStatus.RECEPCIONADO) ? ts : null,
        documentationDate: this.isAfterStatus(v.status, VehicleStatus.CERTIFICADO_STOCK) ? ts : null,
        installationCompleteDate: this.isAfterStatus(v.status, VehicleStatus.DOCUMENTADO) ? ts : null,
        deliveryDate: v.status === VehicleStatus.ENTREGADO ? ts : null,
        receivedBy: jefeTallerUid,
        certifiedBy: this.isAfterStatus(v.status, VehicleStatus.RECEPCIONADO) ? jefeTallerUid : null,
        documentedBy: this.isAfterStatus(v.status, VehicleStatus.CERTIFICADO_STOCK) ? jefeTallerUid : null,
        installedBy: null,
        deliveredBy: v.status === VehicleStatus.ENTREGADO ? jefeTallerUid : null,
        createdAt: ts,
        updatedAt: ts,
      };

      await ref.set(vehicleData);

      // Registrar historia inicial
      await ref.collection('statusHistory').add({
        from: null,
        to: v.status,
        changedBy: jefeTallerUid,
        changedAt: ts,
        note: 'Creado por seed',
      });

      // Si tiene documentación pendiente o más avanzado, crear doc de documentación
      if (this.isFromStatus(v.status, VehicleStatus.DOCUMENTACION_PENDIENTE)) {
        await this.seedDocumentation(vehicleId, v, jefeTallerUid);
      }

      createdVehicles.push({ id: vehicleId, chassis: v.chassis, status: v.status, sede: v.sede });
      this.logger.log(`🚗 Vehículo creado: ${v.chassis} [${v.status}] — ${v.sede}`);
      created++;
    }

    this.logger.log(`🚘 Vehículos: ${created} creados`);
    return { created, vehicles: createdVehicles };
  }

  // ──────────────────────────────────────────────────────────────────────
  // DOCUMENTATION SEED (cuando aplica)
  // ──────────────────────────────────────────────────────────────────────
  private async seedDocumentation(
    vehicleId: string,
    vehicle: { chassis: string; model: string; sede: string; status: VehicleStatus },
    byUid: string,
  ): Promise<void> {
    const existingDoc = await this.db.collection('documentations').doc(vehicleId).get();
    if (existingDoc.exists) return;

    const sampleAccessories = [
      { key: AccessoryKey.BOTON_ENCENDIDO, classification: AccessoryClassification.VENDIDO },
      { key: AccessoryKey.KIT_CARRETERA, classification: AccessoryClassification.OBSEQUIADO },
      { key: AccessoryKey.MOQUETAS, classification: AccessoryClassification.VENDIDO },
      { key: AccessoryKey.LAMINAS, classification: AccessoryClassification.NO_APLICA },
      { key: AccessoryKey.ALARMA, classification: AccessoryClassification.VENDIDO },
    ];

    const ts = this.firebase.serverTimestamp();
    await this.db.collection('documentations').doc(vehicleId).set({
      vehicleId,
      chassis: vehicle.chassis,
      model: vehicle.model,
      sede: vehicle.sede,
      accessories: sampleAccessories,
      paymentMethod: 'CREDITO',
      hasFinancing: true,
      financingEntity: 'Banco Pichincha',
      clientName: `CLIENTE DEMO - ${vehicle.chassis}`,
      clientId: `1${Math.floor(Math.random() * 900000000 + 100000000)}`,
      clientPhone: `09${Math.floor(Math.random() * 90000000 + 10000000)}`,
      documentedBy: byUid,
      createdAt: ts,
      updatedAt: ts,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────
  private readonly STATUS_ORDER: VehicleStatus[] = [
    VehicleStatus.RECEPCIONADO,
    VehicleStatus.CERTIFICADO_STOCK,
    VehicleStatus.DOCUMENTACION_PENDIENTE,
    VehicleStatus.DOCUMENTADO,
    VehicleStatus.ORDEN_GENERADA,
    VehicleStatus.ASIGNADO,
    VehicleStatus.EN_INSTALACION,
    VehicleStatus.INSTALACION_COMPLETA,
    VehicleStatus.LISTO_PARA_ENTREGA,
    VehicleStatus.AGENDADO,
    VehicleStatus.ENTREGADO,
  ];

  /** Retorna true si `current` es posterior a `reference` en el flujo */
  private isAfterStatus(current: VehicleStatus, reference: VehicleStatus): boolean {
    return this.STATUS_ORDER.indexOf(current) > this.STATUS_ORDER.indexOf(reference);
  }

  /** Retorna true si `current` es igual o posterior a `reference` */
  private isFromStatus(current: VehicleStatus, reference: VehicleStatus): boolean {
    return this.STATUS_ORDER.indexOf(current) >= this.STATUS_ORDER.indexOf(reference);
  }
}
