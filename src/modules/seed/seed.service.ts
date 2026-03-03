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
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { v4 as uuidv4 } from 'uuid';

interface SeedUser {
  displayName: string;
  email: string;
  password: string;
  role: RoleEnum;
  sede: SedeEnum;
}

interface VehicleSeed {
  vin: string;         // VIN ISO 3779 (17 chars)
  model: string;
  color: string;
  year: number;
  sede: SedeEnum;
  status: VehicleStatus;
  originConcessionaire: string;
  clientName: string;
  clientId: string;    // cédula ecuatoriana válida
  clientPhone: string;
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

    results['catalogs']     = await this.seedCatalogs();
    results['users']        = await this.seedUsers();
    results['vehicles']     = await this.seedVehicles();

    this.logger.log('✅ Seed completado con éxito');
    return results;
  }

  // ──────────────────────────────────────────────────────────────────────
  // CLEAR (solo dev)
  // ──────────────────────────────────────────────────────────────────────
  private async clearCollections(): Promise<void> {
    const collections = [
      'vehicles',
      'documentations',
      'certifications',
      'service-orders',
      'appointments',
      'deliveries',
      'notifications',
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
        const snap = await this.db
          .collection('catalogs')
          .doc(sub)
          .collection('items')
          .limit(500)
          .get();
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
      { name: 'LOGIMANTA' },
      { name: 'ASIAUTO' },
      { name: 'KMOTOR' },
      { name: 'EMPROMOTOR' },
      { name: 'MOTRICENTRO' },
      { name: 'IOKARS' },
    ];

    const sedes = [
      { name: 'SURMOTOR',          code: SedeEnum.SURMOTOR },
      { name: 'SHYRIS',            code: SedeEnum.SHYRIS },
      { name: 'GRANADAS CENTENOS', code: SedeEnum.GRANADAS_CENTENOS },
    ];

    const accessories = [
      { name: 'BOTON DE ENCENDIDO',    key: AccessoryKey.BOTON_ENCENDIDO },
      { name: 'KIT DE CARRETERA',      key: AccessoryKey.KIT_CARRETERA },
      { name: 'AROS',                  key: AccessoryKey.AROS },
      { name: 'LAMINAS',               key: AccessoryKey.LAMINAS },
      { name: 'MOQUETAS',              key: AccessoryKey.MOQUETAS },
      { name: 'CUBREMALETAS',          key: AccessoryKey.CUBREMALETAS },
      { name: 'SEGURO SATELITAL',      key: AccessoryKey.SEGURO },
      { name: 'TELEMETRIA',            key: AccessoryKey.TELEMETRIA },
      { name: 'SENSORES DE PROXIMIDAD',key: AccessoryKey.SENSORES },
      { name: 'ALARMA',                key: AccessoryKey.ALARMA },
      { name: 'NEBLINEROS',            key: AccessoryKey.NEBLINEROS },
      { name: 'KIT DE SEGURIDAD',      key: AccessoryKey.KIT_SEGURIDAD },
      { name: 'PROTECTOR CERAMICO',    key: AccessoryKey.PROTECTOR_CERAMICO },
      { name: 'OTROS',                 key: AccessoryKey.OTROS },
    ];

    const savedColors         = await this.bulkUpsertCatalog('colors',         colors.map((name) => ({ name })));
    const savedModels         = await this.bulkUpsertCatalog('models',         models.map((name) => ({ name })));
    const savedConcessionaires = await this.bulkUpsertCatalog('concessionaires', concessionaires.map((c) => ({ name: c.name })));
    const savedSedes          = await this.bulkUpsertCatalog('sedes',          sedes.map((s) => ({ name: s.name, code: s.code })));
    const savedAccessories    = await this.bulkUpsertCatalog('accessories',    accessories.map((a) => ({ name: a.name, key: a.key })));

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
      const id  = this.toSlugId(item['name'] as string);
      const ref = this.db.collection('catalogs').doc(subcollection).collection('items').doc(id);
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
        sede: SedeEnum.GRANADAS_CENTENOS,
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
        sede: SedeEnum.GRANADAS_CENTENOS,
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
        sede: SedeEnum.GRANADAS_CENTENOS,
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
        sede: SedeEnum.GRANADAS_CENTENOS,
      },
    ];

    let created = 0;
    let skipped = 0;
    const createdUsers: unknown[] = [];
    this._jefeTallerUid = 'seed-system';

    for (const u of seedUsers) {
      try {
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
        });

        const firestoreRef  = this.db.collection('users').doc(userRecord.uid);
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
          createdUsers.push({ uid: userRecord.uid, email: u.email, role: u.role, sede: u.sede, password: u.password });
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

  /** UID del jefe de taller resuelto durante seedUsers */
  private _jefeTallerUid = 'seed-system';

  // ──────────────────────────────────────────────────────────────────────
  // VEHICLE MASTER DATA
  // VINs válidos ISO 3779: 17 chars alphanum sin I, O, Q
  // ──────────────────────────────────────────────────────────────────────
  private readonly VEHICLE_SEEDS: VehicleSeed[] = [
    // ── SURMOTOR ────────────────────────────────────────────────────────
    {
      vin: 'KNAGM4A79P5535001', model: 'KIA SPORTAGE',  color: 'BLANCO GLACIAR',  year: 2025,
      sede: SedeEnum.SURMOTOR,          status: VehicleStatus.RECEPCIONADO,
      originConcessionaire: 'LOGIMANTA',
      clientName: 'DIEGO ARMANDO SALAZAR VERA',  clientId: '1712345678', clientPhone: '0991234501',
    },
    {
      vin: 'KNADM4A73P5535002', model: 'KIA PICANTO',   color: 'ROJO AURORA',     year: 2025,
      sede: SedeEnum.SURMOTOR,          status: VehicleStatus.CERTIFICADO_STOCK,
      originConcessionaire: 'ASIAUTO',
      clientName: 'GABRIELA XIMENA TORRES PAZOS', clientId: '1723456789', clientPhone: '0991234502',
    },
    {
      vin: 'KNAGM8A72P5535003', model: 'KIA RIO',       color: 'NEGRO PERLA',     year: 2025,
      sede: SedeEnum.SURMOTOR,          status: VehicleStatus.DOCUMENTACION_PENDIENTE,
      originConcessionaire: 'KMOTOR',
      clientName: 'MARCO VINICIO PAREDES LUNA',   clientId: '1734567890', clientPhone: '0991234503',
    },
    {
      vin: 'KNAKJ3D43P5535004', model: 'KIA SORENTO',   color: 'GRIS PLATINO',    year: 2025,
      sede: SedeEnum.SURMOTOR,          status: VehicleStatus.DOCUMENTADO,
      originConcessionaire: 'EMPROMOTOR',
      clientName: 'LUCIA FERNANDA MORALES RIOS',  clientId: '1745678901', clientPhone: '0991234504',
    },
    {
      vin: 'KNABL3A77P5535005', model: 'KIA SELTOS',    color: 'AZUL SAFIRO',     year: 2025,
      sede: SedeEnum.SURMOTOR,          status: VehicleStatus.LISTO_PARA_ENTREGA,
      originConcessionaire: 'MOTRICENTRO',
      clientName: 'JORGE ANDRES ENDARA SILVA',    clientId: '1756789012', clientPhone: '0991234505',
    },

    // ── SHYRIS ──────────────────────────────────────────────────────────
    {
      vin: 'KNADM4A71P5535006', model: 'KIA EV6',       color: 'PLATA METEORICO', year: 2025,
      sede: SedeEnum.SHYRIS,            status: VehicleStatus.RECEPCIONADO,
      originConcessionaire: 'IOKARS',
      clientName: 'VALERIA CRISTINA NARANJO PAZ',  clientId: '1767890123', clientPhone: '0981234506',
    },
    {
      vin: 'KNAGM4A76P5535007', model: 'KIA STINGER',   color: 'NEGRO PERLA',     year: 2025,
      sede: SedeEnum.SHYRIS,            status: VehicleStatus.DOCUMENTACION_PENDIENTE,
      originConcessionaire: 'LOGIMANTA',
      clientName: 'SEBASTIAN OMAR FLORES NIETO',   clientId: '1778901234', clientPhone: '0981234507',
    },
    {
      vin: 'KNAKJ3D48P5535008', model: 'KIA CARNIVAL',  color: 'BLANCO GLACIAR',  year: 2025,
      sede: SedeEnum.SHYRIS,            status: VehicleStatus.ORDEN_GENERADA,
      originConcessionaire: 'KMOTOR',
      clientName: 'CAMILA ALEJANDRA VEGA CORD',    clientId: '1789012345', clientPhone: '0981234508',
    },
    {
      vin: 'KNADM4A70P5535009', model: 'KIA SOUL',      color: 'VERDE ESMERALDA', year: 2025,
      sede: SedeEnum.SHYRIS,            status: VehicleStatus.EN_INSTALACION,
      originConcessionaire: 'ASIAUTO',
      clientName: 'NICOLAS DAVID ROMERO ALBA',     clientId: '1790123456', clientPhone: '0981234509',
    },
    {
      vin: 'KNAKJ3D40P5535010', model: 'KIA SORENTO',   color: 'GRIS PLATINO',    year: 2025,
      sede: SedeEnum.SHYRIS,            status: VehicleStatus.INSTALACION_COMPLETA,
      originConcessionaire: 'MOTRICENTRO',
      clientName: 'AMANDA BEATRIZ GUEVARA MENA',   clientId: '1701234567', clientPhone: '0981234510',
    },

    // ── GRANADAS CENTENOS ────────────────────────────────────────────────
    {
      vin: 'KNAGM4A74P5535011', model: 'KIA TELLURIDE', color: 'CAFE BRONCE',     year: 2025,
      sede: SedeEnum.GRANADAS_CENTENOS, status: VehicleStatus.RECEPCIONADO,
      originConcessionaire: 'EMPROMOTOR',
      clientName: 'DANIEL ESTEBAN CERON BUSTOS',   clientId: '1712345698', clientPhone: '0971234511',
    },
    {
      vin: 'KNADM4A78P5535012', model: 'KIA SPORTAGE',  color: 'ROJO AURORA',     year: 2025,
      sede: SedeEnum.GRANADAS_CENTENOS, status: VehicleStatus.CERTIFICADO_STOCK,
      originConcessionaire: 'IOKARS',
      clientName: 'PATRICIA ELIZABETH MORA LOZA',  clientId: '1723456799', clientPhone: '0971234512',
    },
    {
      vin: 'KNAGM8A70P5535013', model: 'KIA RIO',       color: 'AZUL SAFIRO',     year: 2025,
      sede: SedeEnum.GRANADAS_CENTENOS, status: VehicleStatus.AGENDADO,
      originConcessionaire: 'LOGIMANTA',
      clientName: 'CRISTIAN MAURICIO ZURITA VERA', clientId: '1734567891', clientPhone: '0971234513',
    },
    {
      vin: 'KNADM4A72P5535014', model: 'KIA PICANTO',   color: 'PLATA METEORICO', year: 2025,
      sede: SedeEnum.GRANADAS_CENTENOS, status: VehicleStatus.ENTREGADO,
      originConcessionaire: 'KMOTOR',
      clientName: 'ROSA MARIA HERRERA CANO',       clientId: '1745678902', clientPhone: '0971234514',
    },
  ];

  // ──────────────────────────────────────────────────────────────────────
  // VEHICLES
  // ──────────────────────────────────────────────────────────────────────
  async seedVehicles(): Promise<{ created: number; vehicles: unknown[] }> {
    const jefeTallerUid = this._jefeTallerUid;
    let created = 0;
    const createdVehicles: unknown[] = [];

    for (const v of this.VEHICLE_SEEDS) {
      const vehicleId  = `seed-${v.vin.toLowerCase()}`;
      const ref        = this.db.collection('vehicles').doc(vehicleId);
      const existSnap  = await ref.get();

      if (existSnap.exists) {
        this.logger.warn(`⏩ Vehículo ya existe: ${v.vin}`);
        continue;
      }

      const ts = this.firebase.serverTimestamp();

      const vehicleData: Record<string, unknown> = {
        id:                      vehicleId,
        chassis:                 v.vin,
        model:                   v.model,
        year:                    v.year,
        color:                   v.color,
        originConcessionaire:    v.originConcessionaire,
        photoUrl:                null,
        sede:                    v.sede,
        status:                  v.status,
        receptionDate:           ts,
        certificationDate:       this.isAfterStatus(v.status, VehicleStatus.RECEPCIONADO)          ? ts : null,
        documentationDate:       this.isAfterStatus(v.status, VehicleStatus.CERTIFICADO_STOCK)     ? ts : null,
        installationCompleteDate:this.isAfterStatus(v.status, VehicleStatus.DOCUMENTADO)           ? ts : null,
        deliveryDate:            v.status === VehicleStatus.ENTREGADO                             ? ts : null,
        receivedBy:              jefeTallerUid,
        certifiedBy:             this.isAfterStatus(v.status, VehicleStatus.RECEPCIONADO)          ? jefeTallerUid : null,
        documentedBy:            this.isAfterStatus(v.status, VehicleStatus.CERTIFICADO_STOCK)     ? jefeTallerUid : null,
        installedBy:             this.isAfterStatus(v.status, VehicleStatus.EN_INSTALACION)        ? jefeTallerUid : null,
        deliveredBy:             v.status === VehicleStatus.ENTREGADO                             ? jefeTallerUid : null,
        createdAt:               ts,
        updatedAt:               ts,
      };

      await ref.set(vehicleData);

      await ref.collection('statusHistory').add({
        from:      null,
        to:        v.status,
        changedBy: jefeTallerUid,
        changedAt: ts,
        note:      'Creado por seed',
      });

      // Certificación
      if (this.isFromStatus(v.status, VehicleStatus.CERTIFICADO_STOCK)) {
        await this.seedCertification(vehicleId, v, jefeTallerUid);
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
        await this.seedDelivery(vehicleId, v, jefeTallerUid);
      }

      createdVehicles.push({ id: vehicleId, chassis: v.vin, status: v.status, sede: v.sede });
      this.logger.log(`🚗 Vehículo creado: ${v.vin} [${v.status}] — ${v.sede}`);
      created++;
    }

    this.logger.log(`🚘 Vehículos: ${created} creados`);
    return { created, vehicles: createdVehicles };
  }

  // ──────────────────────────────────────────────────────────────────────
  // CERTIFICATIONS
  // ──────────────────────────────────────────────────────────────────────
  private async seedCertification(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    const existing = await this.db.collection('certifications').doc(vehicleId).get();
    if (existing.exists) return;

    const ts = this.firebase.serverTimestamp();
    await this.db.collection('certifications').doc(vehicleId).set({
      vehicleId,
      chassis:    vehicle.vin,
      model:      vehicle.model,
      sede:       vehicle.sede,
      // Checklist técnico
      radio:        'INSTALADO',
      rimsStatus:   'VIENE',
      seatType:     'CUERO',
      antenna:      'TIBURON',
      trunkCover:   'INSTALADO',
      mileage:      3,
      imprints:     'CON_IMPRONTAS',
      notes:        null,
      rimsPhotoUrl: null,
      certifiedBy:  byUid,
      createdAt:    ts,
      updatedAt:    ts,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // DOCUMENTATION
  // ──────────────────────────────────────────────────────────────────────
  private async seedDocumentation(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    const existing = await this.db.collection('documentations').doc(vehicleId).get();
    if (existing.exists) return;

    const accessories = [
      { key: AccessoryKey.BOTON_ENCENDIDO,  classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.KIT_CARRETERA,    classification: AccessoryClassification.OBSEQUIADO },
      { key: AccessoryKey.MOQUETAS,         classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.LAMINAS,          classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.CUBREMALETAS,     classification: AccessoryClassification.OBSEQUIADO },
      { key: AccessoryKey.SEGURO,           classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.TELEMETRIA,       classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.ALARMA,           classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.KIT_SEGURIDAD,    classification: AccessoryClassification.OBSEQUIADO },
      { key: AccessoryKey.AROS,             classification: AccessoryClassification.NO_APLICA  },
      { key: AccessoryKey.SENSORES,         classification: AccessoryClassification.NO_APLICA  },
      { key: AccessoryKey.NEBLINEROS,       classification: AccessoryClassification.NO_APLICA  },
      { key: AccessoryKey.PROTECTOR_CERAMICO, classification: AccessoryClassification.NO_APLICA },
      { key: AccessoryKey.OTROS,            classification: AccessoryClassification.NO_APLICA  },
    ];

    const ts = this.firebase.serverTimestamp();
    await this.db.collection('documentations').doc(vehicleId).set({
      vehicleId,
      chassis:          vehicle.vin,
      model:            vehicle.model,
      sede:             vehicle.sede,
      accessories,
      registrationType: 'NORMAL',
      paymentMethod:    PaymentMethod.CREDITO,
      hasFinancing:     true,
      financingEntity:  'Banco Pichincha',
      clientName:       vehicle.clientName,
      clientId:         vehicle.clientId,
      clientPhone:      vehicle.clientPhone,
      documentedBy:     byUid,
      createdAt:        ts,
      updatedAt:        ts,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // SERVICE ORDERS
  // ──────────────────────────────────────────────────────────────────────
  private async seedServiceOrder(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    const existing = await this.db
      .collection('service-orders')
      .where('vehicleId', '==', vehicleId)
      .limit(1)
      .get();
    if (!existing.empty) return;

    const orderId    = `seed-ord-${vehicle.vin.toLowerCase()}`;
    const orderNumber = `ORD-${vehicle.sede}-20260303-SEED`;
    const ts          = this.firebase.serverTimestamp();

    const accessories = [
      { key: AccessoryKey.BOTON_ENCENDIDO,  classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.KIT_CARRETERA,    classification: AccessoryClassification.OBSEQUIADO },
      { key: AccessoryKey.MOQUETAS,         classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.LAMINAS,          classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.CUBREMALETAS,     classification: AccessoryClassification.OBSEQUIADO },
      { key: AccessoryKey.SEGURO,           classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.TELEMETRIA,       classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.ALARMA,           classification: AccessoryClassification.VENDIDO   },
      { key: AccessoryKey.KIT_SEGURIDAD,    classification: AccessoryClassification.OBSEQUIADO },
    ];

    const installedAll = this.isFromStatus(vehicle.status, VehicleStatus.INSTALACION_COMPLETA);

    await this.db.collection('service-orders').doc(orderId).set({
      id:                   orderId,
      orderNumber,
      vehicleId,
      sede:                 vehicle.sede,
      chassis:              vehicle.vin,
      accessories,
      predictions:          [],
      checklist:            accessories.map((a) => ({ key: a.key, installed: installedAll })),
      assignedTechnicianId:   installedAll ? byUid : null,
      assignedTechnicianName: installedAll ? 'Juan Ríos' : null,
      assignedAt:             installedAll ? ts : null,
      status:               installedAll ? 'COMPLETA' : 'GENERADA',
      isReopening:          false,
      previousOrderId:      null,
      createdBy:            byUid,
      createdByName:        'Carlos Mendoza',
      createdAt:            ts,
      updatedAt:            ts,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // APPOINTMENTS
  // ──────────────────────────────────────────────────────────────────────
  private async seedAppointment(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    const existing = await this.db
      .collection('appointments')
      .where('vehicleId', '==', vehicleId)
      .limit(1)
      .get();
    if (!existing.empty) return;

    const appointmentId = `seed-apt-${vehicle.vin.toLowerCase()}`;
    const ts             = this.firebase.serverTimestamp();

    await this.db.collection('appointments').doc(appointmentId).set({
      id:                  appointmentId,
      vehicleId,
      sede:                vehicle.sede,
      chassis:             vehicle.vin,
      clientName:          vehicle.clientName,
      scheduledDate:       '2026-03-15',
      scheduledTime:       '10:00',
      assignedAdvisorId:   byUid,
      assignedAdvisorName: 'María Torres',
      status:              vehicle.status === VehicleStatus.ENTREGADO ? 'COMPLETADO' : 'PENDIENTE',
      createdBy:           byUid,
      createdAt:           ts,
      updatedAt:           ts,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // DELIVERIES
  // ──────────────────────────────────────────────────────────────────────
  private async seedDelivery(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    const existing = await this.db.collection('deliveries').doc(vehicleId).get();
    if (existing.exists) return;

    const appointmentId = `seed-apt-${vehicle.vin.toLowerCase()}`;
    const ts             = this.firebase.serverTimestamp();

    await this.db.collection('deliveries').doc(vehicleId).set({
      vehicleId,
      appointmentId,
      chassis:       vehicle.vin,
      model:         vehicle.model,
      sede:          vehicle.sede,
      clientName:    vehicle.clientName,
      clientComment: 'Cliente totalmente satisfecho con la entrega.',
      deliveredBy:   byUid,
      deliveredAt:   ts,
      createdAt:     ts,
      updatedAt:     ts,
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

  /** `true` si `current` es estrictamente posterior a `reference` en el flujo */
  private isAfterStatus(current: VehicleStatus, reference: VehicleStatus): boolean {
    return this.STATUS_ORDER.indexOf(current) > this.STATUS_ORDER.indexOf(reference);
  }

  /** `true` si `current` es igual o posterior a `reference` */
  private isFromStatus(current: VehicleStatus, reference: VehicleStatus): boolean {
    return this.STATUS_ORDER.indexOf(current) >= this.STATUS_ORDER.indexOf(reference);
  }
}
