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
import * as XLSX from 'xlsx';

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
  paymentMethod?: PaymentMethod; // opcional — sobreescribe el default CREDITO
  fechaEntrega?: Date;           // fecha real de entrega desde Excel
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

    this.logger.log('✅ Seed completado con éxito — catálogos listos. Usa /seed/from-excel para importar vehículos.');
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
      'deliveryCeremonies',
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
  private async seedCatalogs(): Promise<Record<string, { created: number; updated: number }>> {
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
      { name: 'GRANADAS CENTENOS', code: SedeEnum.GRANDA_CENTENO },
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

    const savedColors          = await this.bulkUpsertCatalog('colors',         colors.map((name) => ({ name })));
    const savedModels          = await this.bulkUpsertCatalog('models',         models.map((name) => ({ name })));
    const savedConcessionaires = await this.bulkUpsertCatalog('concessionaires', concessionaires.map((c) => ({ name: c.name })));
    const savedSedes           = await this.bulkUpsertCatalog('sedes',          sedes.map((s) => ({ name: s.name, code: s.code })));
    const savedAccessories     = await this.bulkUpsertCatalog('accessories',    accessories.map((a) => ({ name: a.name, key: a.key })));

    this.logger.log(
      `📦 Catálogos: ${savedColors.created + savedColors.updated} colores, ` +
      `${savedModels.created + savedModels.updated} modelos, ` +
      `${savedConcessionaires.created + savedConcessionaires.updated} concesionarios, ` +
      `${savedSedes.created + savedSedes.updated} sedes, ` +
      `${savedAccessories.created + savedAccessories.updated} accesorios`,
    );
    return {
      colors:          savedColors,
      models:          savedModels,
      concessionaires: savedConcessionaires,
      sedes:           savedSedes,
      accessories:     savedAccessories,
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
   * Normaliza `name` a MAYÚSCULAS igual que CatalogsService.create().
   * Crea el documento si no existe, actualiza los campos si ya existe.
   * Nunca borra datos existentes.
   */
  private async bulkUpsertCatalog(
    subcollection: string,
    items: Record<string, unknown>[],
  ): Promise<{ created: number; updated: number }> {
    const CODE_FIELDS = new Set(['key', 'code']);
    let created = 0;
    let updated = 0;

    for (const item of items) {
      // Normalizar igual que CatalogsService: name → MAYÚSCULAS, key/code → trim sin cambio
      const normalized: Record<string, unknown> = Object.fromEntries(
        Object.entries(item).map(([k, v]) => [
          k,
          typeof v === 'string'
            ? CODE_FIELDS.has(k) ? v.trim() : v.toUpperCase().trim()
            : v,
        ]),
      );

      const id  = this.toSlugId(normalized['name'] as string);
      const ref = this.db.collection('catalogs').doc(subcollection).collection('items').doc(id);
      const snap = await ref.get();

      if (!snap.exists) {
        await ref.set({ id, ...normalized, createdAt: this.firebase.serverTimestamp() });
        created++;
      } else {
        // Actualizar todos los campos excepto createdAt (preservar fecha original)
        const { createdAt: _skip, ...updateFields } = normalized as any;
        await ref.update({ id, ...updateFields, updatedAt: this.firebase.serverTimestamp() });
        updated++;
      }
    }

    this.logger.log(`  [${subcollection}] ${created} creados, ${updated} actualizados`);
    return { created, updated };
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
      // Idempotencia: buscar por chasis igual que hace la API real
      const chassisSnap = await this.db
        .collection('vehicles')
        .where('chassis', '==', v.vin)
        .limit(1)
        .get();

      if (!chassisSnap.empty) {
        this.logger.warn(`⏩ Vehículo ya existe: ${v.vin}`);
        continue;
      }

      const vehicleId = uuidv4();
      const ref       = this.db.collection('vehicles').doc(vehicleId);
      const ts        = this.firebase.serverTimestamp();

      // Fecha de entrega: usa la real del Excel si viene, si no el timestamp actual
      const finalDeliveryDate: unknown =
        v.fechaEntrega instanceof Date ? v.fechaEntrega : ts;

      await ref.set({
        id:                       vehicleId,
        chassis:                  v.vin,
        model:                    v.model,
        year:                     v.year,
        color:                    v.color,
        originConcessionaire:     v.originConcessionaire,
        photoUrl:                 null,
        sede:                     v.sede,
        status:                   v.status,
        // Datos del cliente precargados desde Excel para pre-rellenar el formulario de documentación
        clientName:               v.clientName ?? null,
        clientId:                 v.clientId ?? null,
        clientPhone:              v.clientPhone ?? null,
        paymentMethod:            v.paymentMethod ?? PaymentMethod.CREDITO,
        receptionDate:            ts,
        certificationDate:        this.isAfterStatus(v.status, VehicleStatus.RECEPCIONADO)      ? ts : null,
        documentationDate:        this.isAfterStatus(v.status, VehicleStatus.CERTIFICADO_STOCK) ? ts : null,
        installationCompleteDate: this.isAfterStatus(v.status, VehicleStatus.DOCUMENTADO)       ? ts : null,
        deliveryDate:             v.status === VehicleStatus.ENTREGADO ? finalDeliveryDate : null,
        receivedBy:               jefeTallerUid,
        certifiedBy:              this.isAfterStatus(v.status, VehicleStatus.RECEPCIONADO)      ? jefeTallerUid : null,
        documentedBy:             this.isAfterStatus(v.status, VehicleStatus.CERTIFICADO_STOCK) ? jefeTallerUid : null,
        installedBy:              this.isAfterStatus(v.status, VehicleStatus.EN_INSTALACION)    ? jefeTallerUid : null,
        deliveredBy:              v.status === VehicleStatus.ENTREGADO ? jefeTallerUid : null,
        createdAt:                ts,
        updatedAt:                ts,
      } as Record<string, unknown>);

      await ref.collection('statusHistory').add({
        previousStatus: null,
        newStatus:      v.status,
        changedBy:      jefeTallerUid,
        changedByName:  'Seed',
        changedAt:      ts,
        sede:           v.sede,
        notes:          'Creado por seed',
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
      // Checklist técnico — estructura idéntica a certifications.service.ts
      radio:      'INSTALADO',
      rims: {
        status:   'VIENE',
        photoUrl: null,
      },
      seatType:   'CUERO',
      antenna:    'TIBURON',
      trunkCover: 'INSTALADO',
      mileage:    3,
      imprints:   'CON_IMPRONTAS',
      notes:      null,
      certifiedAt: ts,
      certifiedBy: byUid,
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

    const accessories = Object.values(AccessoryKey).map((key) => ({
      key,
      classification: AccessoryClassification.NO_APLICA,
    }));

    const ts = this.firebase.serverTimestamp();
    await this.db.collection('documentations').doc(vehicleId).set({
      vehicleId,
      // Campos idénticos a documentation.service.ts → create()
      clientName:           vehicle.clientName,
      clientId:             vehicle.clientId,
      clientPhone:          vehicle.clientPhone,
      registrationType:     'NORMAL',
      paymentMethod:        vehicle.paymentMethod ?? PaymentMethod.CREDITO,
      vehicleInvoiceUrl:    null,
      giftEmailUrl:         null,
      accessoryInvoiceUrl:  null,
      accessories,
      documentationStatus:  'COMPLETO',
      documentedAt:         ts,
      documentedBy:         byUid,
      // paymentMethod viene del vehículo (Excel lo sobreescribe; default: CREDITO)
      createdAt:            ts,
      updatedAt:            ts,
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

    const orderId     = uuidv4();
    // Formato idéntico a generateOrderNumber() de service-orders.service.ts
    const dateStr     = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `ORD-${vehicle.sede}-${dateStr}-SEED`;
    const ts          = this.firebase.serverTimestamp();

    const accessories = Object.values(AccessoryKey).map((key) => ({
      key,
      classification: AccessoryClassification.NO_APLICA,
    }));

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

    // ID UUID igual que appointments.service.ts → create()
    const appointmentId = uuidv4();
    const ts             = this.firebase.serverTimestamp();

    await this.db.collection('appointments').doc(appointmentId).set({
      id:                  appointmentId,
      vehicleId,
      chassis:             vehicle.vin,
      model:               vehicle.model,
      sede:                vehicle.sede,
      scheduledDate:       '2026-03-15',
      scheduledTime:       '10:00',
      assignedAdvisorId:   byUid,
      assignedAdvisorName: 'María Torres',
      status:              'AGENDADO',
      createdBy:           byUid,
      createdByName:       'Carlos Mendoza',
      createdAt:           ts,
      updatedAt:           ts,
    });

    // Guardar appointmentId para consulta posterior (entrega)
    this._lastAppointmentId.set(vehicleId, appointmentId);
  }

  // ──────────────────────────────────────────────────────────────────────
  // DELIVERIES
  // ──────────────────────────────────────────────────────────────────────
  private async seedDelivery(
    vehicleId: string,
    vehicle: VehicleSeed,
    byUid: string,
  ): Promise<void> {
    // Colección y esquema idénticos a delivery.service.ts → createCeremony()
    const existing = await this.db.collection('deliveryCeremonies').doc(vehicleId).get();
    if (existing.exists) return;

    // Usar el appointmentId UUID generado en seedAppointment
    const appointmentId = this._lastAppointmentId.get(vehicleId) ?? `fallback-apt-${vehicleId}`;
    const ts             = this.firebase.serverTimestamp();

    await this.db.collection('deliveryCeremonies').doc(vehicleId).set({
      vehicleId,
      appointmentId,
      deliveryPhotoUrl:  null,
      signedActaUrl:     null,
      clientComment:     'Cliente totalmente satisfecho con la entrega.',
      deliveredBy:       byUid,
      deliveredByName:   'Carlos Mendoza',
      createdAt:         ts,
    });

    // Marcar agendamiento como ENTREGADO (igual que delivery.service.ts)
    if (appointmentId && !appointmentId.startsWith('fallback-')) {
      await this.db.collection('appointments').doc(appointmentId).update({
        status:    'ENTREGADO',
        updatedAt: ts,
      });
    }
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
  private parseBuffer(buffer: Buffer, mimetype: string): Record<string, unknown>[] {
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
    options: { clear?: boolean } = {},
  ): Promise<{ created: number; vehicles: unknown[]; skippedRows: number }> {
    this.validateSeedKey(secretKey);

    if (options.clear) {
      this.logger.log('🗑️  Limpiando colecciones anteriores antes del import...');
      await this.clearCollections();
    }

    const rows = this.parseBuffer(buffer, mimetype);
    this.logger.log(`📊 Filas totales leídas: ${rows.length}`);

    if (rows.length === 0) {
      this.logger.warn('⚠️  El archivo no tiene filas o la primera fila no es cabecera válida');
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
        'chassis', 'chasis', 'Numero chasis', 'Número chasis', 'vin',
        'numero de chasis', 'número de chasis',
      );

      if (!vinRaw || !vinRaw.trim()) {
        skippedRows++;
        continue;
      }

      const estadoRaw = (
        this.col(row, 'status', 'ESTADO', 'estado') ?? ''
      ).toUpperCase().trim();
      const esEntregado = estadoRaw === 'ENTREGADO';

      const pagoRaw = (
        this.col(row, 'paymentMethod', 'paymentmethod', 'FORMA DE PAGO', 'forma de pago', 'pago', 'payment') ?? ''
      ).toUpperCase();
      const paymentMethod = pagoRaw.includes('CONTADO')
        ? PaymentMethod.CONTADO
        : PaymentMethod.CREDITO;

      // Fecha de entrega: solo se parsea para vehículos ENTREGADO — el resto entra con null
      let fechaEntrega: Date | undefined;
      if (esEntregado) {
        const rawFecha = row[
          Object.keys(row).find((k) =>
            ['deliverydate', 'fechaentrega', 'fecha entrega', 'fecha_entrega'].includes(this.norm(k))
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
        'year', 'ano', 'año', 'Ano Vehiculo', 'Año Vehículo', 'anio vehiculo',
      );
      const year = yearRaw ? (parseInt(yearRaw, 10) || new Date().getFullYear()) : new Date().getFullYear();

      const sedeRaw = this.col(row, 'sede', 'Concesionario asignado', 'concesionario', 'dealer') ?? '';

      vehicles.push({
        vin:                  vinRaw.trim().toUpperCase(),
        model:                (
          this.col(row, 'model', 'Familia', 'familia', 'Modelo', 'modelo', 'modelo vehiculo') ?? 'KIA'
        ).toUpperCase(),
        year,
        color:                (
          this.col(row, 'color', 'Color vehiculo', 'Color vehículo', 'colour') ?? ''
        ).toUpperCase(),
        sede:                 this.mapSede(sedeRaw),
        status:               esEntregado
          ? VehicleStatus.ENTREGADO
          : VehicleStatus.CERTIFICADO_STOCK,
        originConcessionaire: sedeRaw.toUpperCase(),
        clientName:           (
          this.col(row, 'clientName', 'clientname', 'Nombre cliente', 'cliente', 'nombre') ?? ''
        ).toUpperCase(),
        clientId:             this.col(row, 'clientId', 'clientid', 'cedula', 'identificacion') ?? '',
        clientPhone:          this.col(
          row,
          'clientPhone', 'clientphone', 'Telefono Movil', 'Teléfono Móvil', 'celular', 'phone',
        ) ?? '',
        paymentMethod,
        fechaEntrega,
      });
    }

    this.logger.log(
      `🚗 Vehículos a procesar: ${vehicles.length} (${skippedRows} filas sin chasis omitidas)`,
    );

    const result = await this.executeVehicleSeeding(vehicles);
    return { ...result, skippedRows };
  }

  /** Mapea el nombre del concesionario del Excel a SedeEnum */
  private mapSede(excelSede: string): SedeEnum {
    const s = this.norm(excelSede);
    if (s.includes('sur'))                            return SedeEnum.SURMOTOR;
    if (s.includes('shyris'))                        return SedeEnum.SHYRIS;
    if (s.includes('granda') || s.includes('centeno')) return SedeEnum.GRANDA_CENTENO;
    if (excelSede.trim()) {
      this.logger.warn(`⚠️  Sede desconocida: '${excelSede}' → asignando SURMOTOR`);
    }
    return SedeEnum.SURMOTOR;
  }
}
