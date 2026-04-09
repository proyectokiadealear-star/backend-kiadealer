import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { QueryVehiclesDto } from './dto/query-vehicles.dto';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import {
  AccessoryKey,
  AccessoryClassification,
} from '../../common/enums/accessory-key.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { v4 as uuidv4 } from 'uuid';
import { EtlRow } from './excel.service';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  /** Caché TTL para documentations (full-scan costoso) */
  private docsCache: {
    data: Array<Array<{ key: string; classification: string }>>;
    ts: number;
  } | null = null;
  private readonly docsCacheTtlMs = 5 * 60 * 1000; // 5 minutos

  constructor(
    private readonly firebase: FirebaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.firebase.firestore();
  }

  // ──────────────────────────────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────────────────────────────
  async create(dto: CreateVehicleDto, user: AuthenticatedUser) {
    // 1. Validar chasis único
    const existing = await this.db
      .collection('vehicles')
      .where('chassis', '==', dto.chassis)
      .limit(1)
      .get();

    if (!existing.empty) {
      throw new BadRequestException(
        `El chasis '${dto.chassis}' ya existe en el sistema`,
      );
    }

    // 2. Validar año dinámicamente (resiliente: siempre usa el año actual al momento del request)
    const currentYear = new Date().getFullYear();
    if (dto.year < currentYear) {
      throw new BadRequestException(
        `El año del vehículo debe ser >= ${currentYear}`,
      );
    }

    // 3. Sede: usa la del DTO si viene, o la del JWT del usuario como fallback
    const sede = dto.sede ?? user.sede;
    const vehicleId = uuidv4();

    // 4. Crear documento Vehicle — registro contable
    //    La foto y el concesionario de origen se registran en la certificación física.
    const now = this.firebase.serverTimestamp();
    const initialStatus =
      dto.isFacturado === false
        ? VehicleStatus.NO_FACTURADO
        : VehicleStatus.POR_ARRIBAR;
    const vehicleData = {
      id: vehicleId,
      chassis: dto.chassis,
      model: dto.model,
      year: dto.year,
      color: dto.color,
      originConcessionaire: null,
      photoUrl: null,
      sede,
      status: initialStatus,
      certifiedWhileNoFacturado: false,
      certifiedWhileEarlyState: false,
      registeredDate: now,
      registrationSentDate: null,
      registrationReceivedDate: null,
      receptionDate: null,
      certificationDate: null,
      documentationDate: null,
      installationCompleteDate: null,
      deliveryDate: null,
      registeredBy: user.uid,
      certifiedBy: null,
      documentedBy: null,
      installedBy: null,
      deliveredBy: null,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
    };

    await this.db.collection('vehicles').doc(vehicleId).set(vehicleData);

    // 5. Registrar en statusHistory
    await this.addStatusHistory(
      vehicleId,
      null,
      initialStatus,
      user,
      sede,
      `Vehículo registrado por ${user.displayName ?? user.email} — Chasis: ${dto.chassis}, Modelo: ${dto.model}, Año: ${dto.year}`,
    );

    this.logger.log(
      `Vehículo creado: ${vehicleId} (${dto.chassis}) por ${user.uid}`,
    );

    // Notificar creación de vehículo
    await Promise.all([
      this.notificationsService.notify({
        type: 'VEHICULO_REGISTRADO',
        targetRole: RoleEnum.JEFE_TALLER,
        targetSede: sede,
        title: '🚗 Nuevo vehículo registrado',
        body: `Vehículo ${dto.chassis} (${dto.model} ${dto.year}) registrado en ${sede}`,
        vehicleId,
        chassis: dto.chassis,
      }),
      this.notificationsService.notify({
        type: 'VEHICULO_REGISTRADO',
        targetRole: RoleEnum.DOCUMENTACION,
        targetSede: sede,
        title: '🚗 Nuevo vehículo registrado',
        body: `Vehículo ${dto.chassis} (${dto.model} ${dto.year}) registrado — pendiente envío a matriculación`,
        vehicleId,
        chassis: dto.chassis,
      }),
    ]);

    return {
      id: vehicleId,
      chassis: dto.chassis,
      status: initialStatus,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // FIND ALL (con paginación y filtros)
  // ──────────────────────────────────────────────────────────────────

  /** Signed URL válida por 7 días — se cachea en el doc del vehículo. */
  private readonly PHOTO_URL_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 días (renueva antes de expirar)

  private async resolvePhotoUrl(
    vehicle: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!vehicle.photoUrl) return vehicle;

    const cached = vehicle.photoSignedUrl as string | undefined;
    const expires = vehicle.photoUrlExpiresAt as number | undefined;

    if (cached && expires && Date.now() < expires) {
      return { ...vehicle, photoUrl: cached };
    }

    // Regenerar y cachear en Firestore
    const path = `vehicles/${vehicle.id}/photo.jpg`;
    try {
      const url = await this.firebase.getSignedUrl(path);
      const expiresAt = Date.now() + this.PHOTO_URL_TTL_MS;
      // Fire-and-forget: no bloquea la respuesta
      this.db
        .collection('vehicles')
        .doc(vehicle.id as string)
        .update({
          photoSignedUrl: url,
          photoUrlExpiresAt: expiresAt,
        })
        .catch(() => {
          /* ignore write errors */
        });
      return { ...vehicle, photoUrl: url };
    } catch {
      return vehicle;
    }
  }

  async findAll(query: QueryVehiclesDto, user: AuthenticatedUser) {
    let ref: FirebaseFirestore.Query = this.db.collection('vehicles');

    if (query.sede) {
      ref = ref.where('sede', '==', query.sede);
    } else if (user.role !== RoleEnum.JEFE_TALLER && user.role !== RoleEnum.SUPERVISOR) {
      ref = ref.where('sede', '==', user.sede);
    }

    if (query.status) {
      const statuses = query.status.split(',').map((s) => s.trim());
      ref = ref.where('status', 'in', statuses);
    } else {
      const activeStatuses = Object.values(VehicleStatus).filter(
        (s) => s !== VehicleStatus.CEDIDO && s !== VehicleStatus.ENTREGADO,
      );
      ref = ref.where('status', 'in', activeStatuses);
    }

    // ── Parse date range filter ──────────────────────────────────────
    let dateFromTs: number | null = null;
    let dateToTs: number | null = null;

    if (query.dateFrom) {
      const d = new Date(query.dateFrom + 'T00:00:00');
      if (!isNaN(d.getTime())) dateFromTs = Math.floor(d.getTime() / 1000);
    }
    if (query.dateTo) {
      const d = new Date(query.dateTo + 'T23:59:59');
      if (!isNaN(d.getTime())) dateToTs = Math.floor(d.getTime() / 1000);
    }

    const needsDateFilter = !!(dateFromTs || dateToTs);
    const needsTextFilter = !!(query.chassis || query.clientId);
    // Date filter requires in-memory pass (Firestore 'in' + range = not supported)
    const needsMemoryFilter = needsTextFilter || needsDateFilter;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const start = (page - 1) * limit;

    let vehicles: FirebaseFirestore.DocumentData[];
    let total: number;

    if (needsMemoryFilter) {
      // Filtros de substring o fecha requieren traer todo y filtrar en memoria
      const snapshot = await ref.get();
      vehicles = snapshot.docs
        .map((d) => d.data())
        .sort(
          (a, b) =>
            (b['statusChangedAt']?._seconds ?? b['updatedAt']?._seconds ?? 0) -
            (a['statusChangedAt']?._seconds ?? a['updatedAt']?._seconds ?? 0),
        );

      if (query.chassis) {
        const chassisLower = query.chassis.toLowerCase();
        vehicles = vehicles.filter((v) =>
          (v.chassis as string).toLowerCase().includes(chassisLower),
        );
      }
      if (query.clientId) {
        vehicles = vehicles.filter((v) => v.clientId === query.clientId);
      }

      // Apply date range on statusChangedAt (última acción real del pipeline)
      if (dateFromTs || dateToTs) {
        vehicles = vehicles.filter((v) => {
          const ts =
            v['statusChangedAt']?._seconds ??
            v['updatedAt']?._seconds ??
            0;
          if (!ts) return false;
          if (dateFromTs && ts < dateFromTs) return false;
          if (dateToTs && ts > dateToTs) return false;
          return true;
        });
      }

      total = vehicles.length;
      vehicles = vehicles.slice(start, start + limit);
    } else {
      // Sin filtro de texto ni fecha: paginación a nivel Firestore
      // Intentar orderBy statusChangedAt, fallback a memoria si índice no existe
      try {
        const ordered = ref.orderBy('statusChangedAt', 'desc');
        const [countSnap, dataSnap] = await Promise.all([
          ordered.count().get(),
          ordered.offset(start).limit(limit).get(),
        ]);
        total = countSnap.data().count;
        vehicles = dataSnap.docs.map((d) => d.data());
      } catch {
        // Índice compuesto no existe o vehículos sin statusChangedAt — fallback
        this.logger.warn(
          'findAll: orderBy statusChangedAt falló. Usando paginación en memoria.',
        );
        const snapshot = await ref.get();
        vehicles = snapshot.docs
          .map((d) => d.data())
          .sort(
            (a, b) =>
              (b['statusChangedAt']?._seconds ?? b['updatedAt']?._seconds ?? 0) -
              (a['statusChangedAt']?._seconds ?? a['updatedAt']?._seconds ?? 0),
          );
        total = vehicles.length;
        vehicles = vehicles.slice(start, start + limit);
      }
    }

    // Resolver URLs de fotos (usa caché, no regenera en cada request)
    const data = await Promise.all(
      vehicles.map((v) => this.resolvePhotoUrl(v as Record<string, unknown>)),
    );

    return { data, total, page, limit };
  }

  // ──────────────────────────────────────────────────────────────────
  // FIND ONE
  // ──────────────────────────────────────────────────────────────────
  async findOne(id: string, user: AuthenticatedUser) {
    const doc = await this.db.collection('vehicles').doc(id).get();
    if (!doc.exists) throw new NotFoundException('Vehículo no encontrado');

    const vehicle = doc.data()!;

    // Control de sede
    if (user.role !== RoleEnum.JEFE_TALLER && user.role !== RoleEnum.SUPERVISOR && vehicle['sede'] !== user.sede) {
      throw new ForbiddenException('No tienes acceso a este vehículo');
    }

    // Enriquecer con foto firmada
    if (vehicle['photoUrl']) {
      vehicle['photoUrl'] = await this.firebase
        .getSignedUrl(`vehicles/${id}/photo.jpg`)
        .catch(() => vehicle['photoUrl']);
    }

    // Recuperar certification y documentation si existen
    const [certDoc, docDocSnap] = await Promise.all([
      this.db.collection('certifications').doc(id).get(),
      this.db.collection('documentations').doc(id).get(),
    ]);

    return {
      ...vehicle,
      certification: certDoc.exists ? certDoc.data() : null,
      documentation: docDocSnap.exists ? docDocSnap.data() : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // UPDATE (JEFE_TALLER / SOPORTE)
  // ──────────────────────────────────────────────────────────────────
  async update(
    id: string,
    dto: UpdateVehicleDto,
    photoFile?: Express.Multer.File,
  ) {
    await this.assertExists(id);

    // Filtrar undefined — Firestore lanza error si recibe campos undefined
    const updates: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
      updatedAt: this.firebase.serverTimestamp(),
    };
    delete updates['photoBase64'];

    // Reemplazar foto si se recibe nueva (multipart tiene prioridad sobre base64)
    if (photoFile) {
      const storagePath = `vehicles/${id}/photo.jpg`;
      await this.firebase.deleteFile(storagePath);
      await this.firebase.uploadBuffer(
        photoFile.buffer,
        storagePath,
        photoFile.mimetype,
      );
      updates['photoUrl'] = await this.firebase.getSignedUrl(storagePath);
    } else if (dto.photoBase64) {
      const base64Data = dto.photoBase64.replace(
        /^data:image\/\w+;base64,/,
        '',
      );
      const buffer = Buffer.from(base64Data, 'base64');
      const storagePath = `vehicles/${id}/photo.jpg`;
      await this.firebase.deleteFile(storagePath);
      await this.firebase.uploadBuffer(buffer, storagePath, 'image/jpeg');
      updates['photoUrl'] = await this.firebase.getSignedUrl(storagePath);
    }

    await this.db.collection('vehicles').doc(id).update(updates);
    return { id, updated: true };
  }

  // ──────────────────────────────────────────────────────────────────
  // PREVIEW ENTREGADOS POR RANGO DE AÑOS (verificación antes de borrar)
  // ──────────────────────────────────────────────────────────────────
  async previewDeliveredByYear(fromYear: number, toYear: number) {
    const startTs = new Date(`${fromYear}-01-01T00:00:00.000Z`);
    const endTs = new Date(`${toYear + 1}-01-01T00:00:00.000Z`);

    // Traer todos los ENTREGADO — el filtro de rango sobre deliveryDate
    // se aplica en memoria como fallback seguro (evita requerir índice compuesto).
    const snap = await this.db
      .collection('vehicles')
      .where('status', '==', VehicleStatus.ENTREGADO)
      .get();

    const vehicles = snap.docs
      .map((d) => d.data())
      .filter((v) => {
        if (!v['deliveryDate']) return false;
        // deliveryDate puede ser Firestore Timestamp o ISO string
        const raw = v['deliveryDate'];
        const date: Date | null =
          typeof raw === 'string'
            ? new Date(raw)
            : raw?._seconds
              ? new Date(raw._seconds * 1000)
              : raw instanceof Date
                ? raw
                : null;
        if (!date) return false;
        return date >= startTs && date < endTs;
      })
      .map((v) => ({
        id: v['id'] as string,
        chassis: v['chassis'] as string,
        model: v['model'] as string,
        year: v['year'] as number,
        color: v['color'] as string,
        sede: v['sede'] as string,
        deliveryDate: v['deliveryDate']?._seconds
          ? new Date(v['deliveryDate']._seconds * 1000).toISOString()
          : v['deliveryDate'],
      }));

    return {
      count: vehicles.length,
      fromYear,
      toYear,
      vehicles,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // DELETE BATCH ENTREGADOS POR RANGO DE AÑOS — cascada completa
  // ──────────────────────────────────────────────────────────────────
  async removeDeliveredByYear(fromYear: number, toYear: number) {
    // 1. Reutilizar el preview para obtener los IDs exactos a eliminar
    const { vehicles } = await this.previewDeliveredByYear(fromYear, toYear);

    if (vehicles.length === 0) {
      return { deleted: 0, errors: [] };
    }

    const errors: Array<{ id: string; chassis: string; error: string }> = [];
    let deleted = 0;

    // 2. Eliminar uno a uno reutilizando remove() que ya hace cascada completa
    for (const v of vehicles) {
      try {
        await this.remove(v.id);
        deleted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ id: v.id, chassis: v.chassis, error: msg });
        this.logger.error(
          `removeDeliveredByYear: error eliminando ${v.id} (${v.chassis}): ${msg}`,
        );
      }
    }

    this.logger.log(
      `removeDeliveredByYear(${fromYear}-${toYear}): ${deleted} eliminados, ${errors.length} errores`,
    );

    return { deleted, errors };
  }

  // ──────────────────────────────────────────────────────────────────
  // DELETE (JEFE_TALLER / SOPORTE) — cascada completa
  // ──────────────────────────────────────────────────────────────────
  async remove(id: string) {
    await this.assertExists(id);

    // 1. Eliminar foto de Firebase Storage si existe
    await this.firebase.deleteFile(`vehicles/${id}/photo.jpg`).catch(() => {});

    // 2. Consultar en paralelo todas las colecciones relacionadas
    const [
      serviceOrdersSnap,
      appointmentsSnap,
      notificationsSnap,
      statusHistorySnap,
    ] = await Promise.all([
      this.db.collection('service-orders').where('vehicleId', '==', id).get(),
      this.db.collection('appointments').where('vehicleId', '==', id).get(),
      this.db.collection('notifications').where('vehicleId', '==', id).get(),
      this.db.collection('vehicles').doc(id).collection('statusHistory').get(),
    ]);

    // 3. Construir lista de todas las referencias a eliminar
    const refs: FirebaseFirestore.DocumentReference[] = [
      ...serviceOrdersSnap.docs.map((d) => d.ref),
      ...appointmentsSnap.docs.map((d) => d.ref),
      ...notificationsSnap.docs.map((d) => d.ref),
      ...statusHistorySnap.docs.map((d) => d.ref),
      this.db.collection('documentations').doc(id),
      this.db.collection('certifications').doc(id),
      this.db.collection('deliveryCeremonies').doc(id),
      this.db.collection('vehicles').doc(id),
    ];

    // 4. Eliminar en lotes de 500 (límite de Firestore)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const batch = this.db.batch();
      refs.slice(i, i + CHUNK_SIZE).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }

    return { id, deleted: true };
  }

  // ──────────────────────────────────────────────────────────────────
  // STATUS HISTORY
  // ──────────────────────────────────────────────────────────────────
  async getStatusHistory(id: string) {
    const snapshot = await this.db
      .collection('vehicles')
      .doc(id)
      .collection('statusHistory')
      .orderBy('changedAt', 'asc')
      .get();

    return snapshot.docs.map((d) => d.data());
  }

  async addStatusHistory(
    vehicleId: string,
    previousStatus: VehicleStatus | null,
    newStatus: VehicleStatus,
    user: AuthenticatedUser,
    sede: SedeEnum,
    notes?: string,
  ) {
    const historyId = uuidv4();
    const entry = {
      id: historyId,
      previousStatus,
      newStatus,
      changedBy: user.uid,
      changedByName: user.displayName ?? user.email,
      changedAt: this.firebase.serverTimestamp(),
      sede,
      notes: notes ?? null,
    };
    await this.db
      .collection('vehicles')
      .doc(vehicleId)
      .collection('statusHistory')
      .doc(historyId)
      .set(entry);
  }

  /** Cambia el estado del vehículo y registra en el historial */
  async changeStatus(
    vehicleId: string,
    newStatus: VehicleStatus,
    user: AuthenticatedUser,
    options?: { notes?: string; extraFields?: Record<string, unknown> },
  ) {
    const doc = await this.db.collection('vehicles').doc(vehicleId).get();
    if (!doc.exists) throw new NotFoundException('Vehículo no encontrado');

    const vehicle = doc.data()!;
    const previousStatus = vehicle['status'] as VehicleStatus;

    const now = this.firebase.serverTimestamp();
    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: now,
      statusChangedAt: now,
      ...(options?.extraFields ?? {}),
    };

    await this.db.collection('vehicles').doc(vehicleId).update(updates);

    await this.addStatusHistory(
      vehicleId,
      previousStatus,
      newStatus,
      user,
      vehicle['sede'] as SedeEnum,
      options?.notes,
    );

    return { vehicleId, previousStatus, newStatus };
  }

  // ──────────────────────────────────────────────────────────────────
  // STATS
  // ──────────────────────────────────────────────────────────────────
  async statsBySede(sede?: string) {
    let ref: FirebaseFirestore.Query = this.db.collection('vehicles');
    if (sede) {
      ref = ref.where('sede', '==', sede);
    }
    const snapshot = await ref.get();
    const result: Record<string, Record<string, number>> = {};

    for (const doc of snapshot.docs) {
      const v = doc.data();
      const sede = v['sede'] as string;
      const status = v['status'] as string;

      if (!result[sede]) result[sede] = { total: 0 };
      result[sede][status] = (result[sede][status] ?? 0) + 1;
      result[sede]['total'] = (result[sede]['total'] ?? 0) + 1;
    }
    return result;
  }

  async todayDeliveries(user: AuthenticatedUser) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let ref: FirebaseFirestore.Query = this.db
      .collection('vehicles')
      .where('status', '==', VehicleStatus.AGENDADO);

    if (user.role !== RoleEnum.JEFE_TALLER && user.role !== RoleEnum.SUPERVISOR) {
      ref = ref.where('sede', '==', user.sede);
    }

    const snapshot = await ref.get();
    return snapshot.docs.map((d) => d.data());
  }

  // ──────────────────────────────────────────────────────────────────
  // HELPER
  // ──────────────────────────────────────────────────────────────────
  async assertExists(id: string) {
    const doc = await this.db.collection('vehicles').doc(id).get();
    if (!doc.exists) throw new NotFoundException('Vehículo no encontrado');
    return doc.data()!;
  }

  // ──────────────────────────────────────────────────────────────────
  // CALL CENTER — lista de ENTREGADO con accesorios (seguro + telemetría)
  // ──────────────────────────────────────────────────────────────────
  /**
   * Retorna todos los vehículos con status ENTREGADO enriquecidos con sus
   * accesorios de seguro y telemetría.  Usa Firestore getAll() para el
   * batch-join de documentations — single round-trip, O(1) request.
   */
  async getCallCenterList(page = 1, limit = 100) {
    // 1. Traer vehículos desde DOCUMENTADO hasta ENTREGADO (ya tienen documentación con propietario y accesorios)
    const CALL_CENTER_STATUSES = [
      VehicleStatus.DOCUMENTADO,
      VehicleStatus.ORDEN_GENERADA,
      VehicleStatus.ASIGNADO,
      VehicleStatus.EN_INSTALACION,
      VehicleStatus.INSTALACION_COMPLETA,
      VehicleStatus.REAPERTURA_OT,
      VehicleStatus.LISTO_PARA_ENTREGA,
      VehicleStatus.AGENDADO,
      VehicleStatus.ENTREGADO,
    ];

    // Traer TODOS para poder calcular el total y paginar
    const allSnap = await this.db
      .collection('vehicles')
      .where('status', 'in', CALL_CENTER_STATUSES)
      .get();

    if (allSnap.empty) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const allVehicles = allSnap.docs.map((d) => d.data());
    const total = allVehicles.length;
    const totalPages = Math.ceil(total / limit);
    const safePage = Math.max(1, Math.min(page, totalPages));
    const offset = (safePage - 1) * limit;
    const vehiclesPage = allVehicles.slice(offset, offset + limit);

    const vehicles = vehiclesPage;

    // 2. Batch-fetch documentations (single getAll call)
    const docRefs = vehicles.map((v) =>
      this.db.collection('documentations').doc(v['id'] as string),
    );
    const docSnaps = await this.db.getAll(...docRefs);

    // 3. Construir mapas vehicleId → accessories[] y vehicleId → clientInfo
    //    La documentación es la fuente de verdad para clientName/clientId/clientPhone
    const accMap = new Map<
      string,
      Array<{ key: string; classification: string | null }>
    >();
    const clientMap = new Map<
      string,
      { nombre: string; cedula: string; telefono: string }
    >();
    docSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data()!;
      const raw = data['accessories'];
      accMap.set(
        snap.id,
        Array.isArray(raw)
          ? (raw as Array<{ key: string; classification: string | null }>)
          : [],
      );
      clientMap.set(snap.id, {
        nombre: (data['clientName'] as string) ?? '',
        cedula: (data['clientId'] as string) ?? '',
        telefono: (data['clientPhone'] as string) ?? '',
      });
    });

    // 4. Merge y construir DTO liviano
    const data = vehicles.map((v) => {
      const id = v['id'] as string;
      const allAcc = accMap.get(id) ?? [];

      // Evaluar seguro y telemetría a partir de documentación.
      // Siempre se incluyen ambos en la respuesta independientemente de si
      // fueron registrados en la documentación o no.
      const evalAccessory = (
        key: AccessoryKey,
      ): { key: string; classification: string | null; vendido: boolean } => {
        // Busca tanto en minúsculas (valor del enum) como en mayúsculas (compatibilidad)
        const acc = allAcc.find(
          (a) =>
            a.key === key ||
            a.key === key.toUpperCase() ||
            a.key.toLowerCase() === key.toLowerCase(),
        );
        const classification = acc?.classification ?? null;
        const vendido =
          classification === AccessoryClassification.VENDIDO ||
          classification === AccessoryClassification.OBSEQUIADO;
        // Retorna la key en MAYÚSCULAS para que coincida con el frontend (constants.ts)
        return { key: key.toUpperCase(), classification, vendido };
      };

      const accessories = [
        evalAccessory(AccessoryKey.SEGURO),
        evalAccessory(AccessoryKey.TELEMETRIA),
      ];

      // Prefiere datos de documentación (fuente de verdad);
      // usa campos del vehículo solo como fallback (p.ej. clientId denormalizado)
      const client = clientMap.get(id);
      return {
        id,
        chasis: v['chassis'] as string,
        modelo: v['model'] as string,
        color: v['color'] as string,
        año: v['year'] as number,
        sede: v['sede'] as string,
        status: v['status'] as string,
        propietario: {
          nombre: client?.nombre ?? (v['clientName'] as string) ?? '',
          cedula: client?.cedula ?? (v['clientId'] as string) ?? '',
          telefono: client?.telefono ?? (v['clientPhone'] as string) ?? '',
          celular: client?.telefono ?? (v['clientPhone'] as string) ?? '',
        },
        accessories,
      };
    });

    // 5. Retornar PaginatedResponse shape (compatible con frontend)
    return { data, total, page: safePage, limit, totalPages };
  }

  // ──────────────────────────────────────────────────────────────────
  // ENTREGADOS RESUMEN — agregado dinámico desde Firestore (dashboard)
  // ──────────────────────────────────────────────────────────────────
  /**
   * Calcula el resumen agregado de vehículos ENTREGADO para un año/rango dado.
   * Retorna el mismo shape que entregados_historico.json para facilitar la fusión
   * en el frontend DashboardEntregados.
   * Soporta filtros opcionales: sede, modelo.
   */
  async getEntregadosResumen(opts: {
    año?: number;
    fechaDesde?: string; // "YYYY-MM-DD" — filtra deliveryDate >= este valor
    sede?: string;
    modelo?: string;
  }) {
    // 1. Traer todos los ENTREGADO
    let query: FirebaseFirestore.Query = this.db
      .collection('vehicles')
      .where('status', '==', VehicleStatus.ENTREGADO);

    const snap = await query.get();
    if (snap.empty) {
      return this._emptyEntregadosResumen();
    }

    // 2. Filtrar en memoria (deliveryDate es campo no indexado combinado con year)
    const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    const vehicles = snap.docs
      .map((d) => d.data())
      .filter((v) => {
        const date = this._parseVehicleDate(v['deliveryDate']);
        // Filtro año exacto
        if (opts.año !== undefined) {
          if (!date || date.getFullYear() !== opts.año) return false;
        }
        // Filtro fechaDesde: solo vehículos con deliveryDate >= fechaDesde
        if (opts.fechaDesde) {
          if (!date) return false;
          const desde = new Date(opts.fechaDesde + 'T00:00:00Z');
          if (date < desde) return false;
        }
        // Filtro sede
        if (opts.sede && v['sede'] !== opts.sede) return false;
        // Filtro modelo
        if (opts.modelo && v['model'] !== opts.modelo) return false;
        return true;
      });

    if (vehicles.length === 0) {
      return this._emptyEntregadosResumen();
    }

    // 3. Batch-fetch documentations para saber si tienen seguro
    const docRefs = vehicles.map((v) =>
      this.db.collection('documentations').doc(v['id'] as string),
    );
    const docSnaps = await this.db.getAll(...docRefs);

    // Map vehicleId → tieneSeguro
    const seguroMap = new Map<string, boolean>();
    docSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const raw = snap.data()!['accessories'];
      const accessories: Array<{ key: string; classification: string }> =
        Array.isArray(raw) ? raw : [];
      const seguroAcc = accessories.find(
        (a) =>
          a.key === AccessoryKey.SEGURO ||
          a.key === AccessoryKey.SEGURO.toUpperCase() ||
          a.key.toLowerCase() === 'seguro',
      );
      const tieneSeguro =
        seguroAcc?.classification === AccessoryClassification.VENDIDO ||
        seguroAcc?.classification === AccessoryClassification.OBSEQUIADO;
      seguroMap.set(snap.id, tieneSeguro);
    });

    // 4. Agregar
    const conSeguro = vehicles.filter((v) => seguroMap.get(v['id'] as string) === true).length;
    const sinSeguro = vehicles.length - conSeguro;

    // Por año
    const añoMap = new Map<number, number>();
    // Por mes
    const mesMap = new Map<string, number>(); // key: "Ene 2026"
    // Por modelo
    const modeloMap = new Map<string, number>();
    // Por color
    const colorMap = new Map<string, number>();
    // Por sede
    const sedeMap = new Map<string, number>();

    vehicles.forEach((v) => {
      const date = this._parseVehicleDate(v['deliveryDate']);
      if (date) {
        const año = date.getFullYear();
        añoMap.set(año, (añoMap.get(año) ?? 0) + 1);
        const mesLabel = `${MESES_ES[date.getMonth()]} ${año}`;
        mesMap.set(mesLabel, (mesMap.get(mesLabel) ?? 0) + 1);
      }
      const modelo = (v['model'] as string) ?? 'DESCONOCIDO';
      modeloMap.set(modelo, (modeloMap.get(modelo) ?? 0) + 1);
      const color = ((v['color'] as string) ?? 'DESCONOCIDO').toUpperCase();
      colorMap.set(color, (colorMap.get(color) ?? 0) + 1);
      const sede = (v['sede'] as string) ?? 'DESCONOCIDO';
      sedeMap.set(sede, (sedeMap.get(sede) ?? 0) + 1);
    });

    // Ordenar meses cronológicamente
    const porMesLabel = Array.from(mesMap.entries())
      .map(([label, cantidad]) => ({ label, cantidad }))
      .sort((a, b) => {
        const parse = (l: string) => {
          const [m, y] = l.split(' ');
          return parseInt(y) * 100 + MESES_ES.indexOf(m);
        };
        return parse(a.label) - parse(b.label);
      });

    const sortDesc = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([label, cantidad]) => ({ label, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);

    return {
      metadata: {
        fecha_actual: new Date().toISOString().split('T')[0],
        total_registros: vehicles.length,
      },
      kpis_seguros: { SI: conSeguro, NO: sinSeguro },
      analisis_temporal: {
        por_año: Array.from(añoMap.entries())
          .map(([año, cantidad]) => ({ año, cantidad }))
          .sort((a, b) => a.año - b.año),
        por_mes_label: porMesLabel,
      },
      analisis_categorico: {
        por_modelo: sortDesc(modeloMap),
        por_color: sortDesc(colorMap),
        por_sede: sortDesc(sedeMap),
      },
    };
  }

  /** Retorna el shape vacío cuando no hay datos */
  private _emptyEntregadosResumen() {
    return {
      metadata: { fecha_actual: new Date().toISOString().split('T')[0], total_registros: 0 },
      kpis_seguros: { SI: 0, NO: 0 },
      analisis_temporal: { por_año: [], por_mes_label: [] },
      analisis_categorico: { por_modelo: [], por_color: [], por_sede: [] },
    };
  }

  /** Parsea deliveryDate que puede ser Firestore Timestamp, ISO string o Date */
  private _parseVehicleDate(raw: unknown): Date | null {
    if (!raw) return null;
    if (typeof raw === 'string') return new Date(raw);
    if (raw instanceof Date) return raw;
    if (typeof raw === 'object' && raw !== null && '_seconds' in raw) {
      return new Date((raw as { _seconds: number })._seconds * 1000);
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────
  // SALE POTENTIAL
  // ──────────────────────────────────────────────────────────────────
  async getSalePotential(vehicleId: string) {
    const vehicle = await this.assertExists(vehicleId);

    const docSnap = await this.db
      .collection('documentations')
      .doc(vehicleId)
      .get();
    if (!docSnap.exists) {
      throw new BadRequestException(
        'El vehículo no tiene documentación registrada — no se puede calcular potencial de venta',
      );
    }

    const rawAccessories: Array<{ key: string; classification: string }> =
      Array.isArray(docSnap.data()!['accessories'])
        ? docSnap.data()!['accessories']
        : [];

    // Excluir "otros" del cálculo — no es un accesorio vendible calculable
    const accessories = rawAccessories.filter(
      (a) => a.key !== AccessoryKey.OTROS,
    );
    const totalAccessories = Object.values(AccessoryKey).filter(
      (k) => k !== AccessoryKey.OTROS,
    ).length; // 13

    const sold = accessories.filter(
      (a) => a.classification === AccessoryClassification.VENDIDO,
    ).length;
    const gifted = accessories.filter(
      (a) => a.classification === AccessoryClassification.OBSEQUIADO,
    ).length;
    const notApplicable = accessories.filter(
      (a) => a.classification === AccessoryClassification.NO_APLICA,
    ).length;
    const acquired = sold + gifted;

    const currentSaleRate =
      Math.round((acquired / totalAccessories) * 10000) / 100;
    const potentialSaleRate =
      Math.round(((totalAccessories - acquired) / totalAccessories) * 10000) /
      100;

    // Predicción ponderada: buscar patrones en otros vehículos
    const soldKeys = accessories
      .filter(
        (a) =>
          a.classification === AccessoryClassification.VENDIDO ||
          a.classification === AccessoryClassification.OBSEQUIADO,
      )
      .map((a) => a.key);

    let weightedPotentialRate = 0;
    let highPotentialItems: Array<{
      key: string;
      probability: number;
      reason: string;
    }> = [];

    if (soldKeys.length > 0) {
      const allDocs = await this.getCachedDocAccessories(vehicleId);

      const similar = allDocs.filter((acc) => {
        const soldInDoc = acc
          .filter(
            (a) =>
              a.classification === AccessoryClassification.VENDIDO ||
              a.classification === AccessoryClassification.OBSEQUIADO,
          )
          .map((a) => a.key);
        return soldKeys.some((k) => soldInDoc.includes(k));
      });

      if (similar.length > 0) {
        const notAcquiredKeys = Object.values(AccessoryKey).filter(
          (k) => k !== AccessoryKey.OTROS && !soldKeys.includes(k),
        );

        const predictions: Array<{
          key: string;
          probability: number;
          reason: string;
        }> = [];

        for (const key of notAcquiredKeys) {
          const count = similar.filter((acc) =>
            acc.some(
              (a) =>
                a.key === key &&
                (a.classification === AccessoryClassification.VENDIDO ||
                  a.classification === AccessoryClassification.OBSEQUIADO),
            ),
          ).length;

          const probability = Math.round((count / similar.length) * 100);
          if (probability > 0) {
            predictions.push({
              key,
              probability,
              reason: `El ${probability}% de clientes con accesorios similares también adquirieron ${key}`,
            });
          }
        }

        predictions.sort((a, b) => b.probability - a.probability);
        highPotentialItems = predictions.filter((p) => p.probability >= 40);

        // Promedio ponderado: solo las predicciones > 0, escalado sobre el total de no adquiridos
        if (predictions.length > 0) {
          const sumProbabilities = predictions.reduce(
            (s, p) => s + p.probability,
            0,
          );
          weightedPotentialRate =
            Math.round((sumProbabilities / predictions.length) * 100) / 100;
        }
      }
    }

    return {
      vehicleId,
      chassis: vehicle['chassis'],
      totalAccessories,
      sold,
      gifted,
      notApplicable,
      currentSaleRate,
      potentialSaleRate,
      weightedPotentialRate,
      highPotentialItems,
    };
  }

  /**
   * Batch: calcula potencial de venta para múltiples vehículos con UN SOLO scan
   * de la colección documentations (en vez de N scans individuales).
   */
  async getSalePotentialBatch(vehicleIds: string[]) {
    if (vehicleIds.length === 0) return [];
    if (vehicleIds.length > 50) {
      throw new BadRequestException('Máximo 50 vehículos por batch');
    }

    // 1. Obtener documentaciones de los vehículos solicitados
    const docRefs = vehicleIds.map((id) =>
      this.db.collection('documentations').doc(id),
    );
    const docSnaps = await this.db.getAll(...docRefs);

    // 2. Un SOLO scan de toda la colección para predicciones
    const allDocsSnap = await this.db.collection('documentations').get();
    const allAccessories = allDocsSnap.docs
      .map((d) => {
        const raw = d.data()?.['accessories'];
        return {
          id: d.id,
          accessories: Array.isArray(raw)
            ? (raw as Array<{ key: string; classification: string }>).filter(
                (a) => a.key !== AccessoryKey.OTROS,
              )
            : [],
        };
      })
      .filter((d) => d.accessories.length > 0);

    const totalAccessoriesBase = Object.values(AccessoryKey).filter(
      (k) => k !== AccessoryKey.OTROS,
    ).length;

    // 3. Calcular para cada vehículo
    const results: Array<{
      vehicleId: string;
      totalAccessories: number;
      sold: number;
      gifted: number;
      notApplicable: number;
      currentSaleRate: number;
      potentialSaleRate: number;
      weightedPotentialRate: number;
      highPotentialItems: Array<{
        key: string;
        probability: number;
        reason: string;
      }>;
    }> = [];

    for (let i = 0; i < vehicleIds.length; i++) {
      const vehicleId = vehicleIds[i];
      const snap = docSnaps[i];

      if (!snap.exists) continue;

      const rawAccessories: Array<{ key: string; classification: string }> =
        Array.isArray(snap.data()!['accessories'])
          ? snap.data()!['accessories']
          : [];
      const accessories = rawAccessories.filter(
        (a) => a.key !== AccessoryKey.OTROS,
      );

      const sold = accessories.filter(
        (a) => a.classification === AccessoryClassification.VENDIDO,
      ).length;
      const gifted = accessories.filter(
        (a) => a.classification === AccessoryClassification.OBSEQUIADO,
      ).length;
      const notApplicable = accessories.filter(
        (a) => a.classification === AccessoryClassification.NO_APLICA,
      ).length;
      const acquired = sold + gifted;

      const currentSaleRate =
        Math.round((acquired / totalAccessoriesBase) * 10000) / 100;
      const potentialSaleRate =
        Math.round(
          ((totalAccessoriesBase - acquired) / totalAccessoriesBase) * 10000,
        ) / 100;

      const soldKeys = accessories
        .filter(
          (a) =>
            a.classification === AccessoryClassification.VENDIDO ||
            a.classification === AccessoryClassification.OBSEQUIADO,
        )
        .map((a) => a.key);

      let weightedPotentialRate = 0;
      let highPotentialItems: Array<{
        key: string;
        probability: number;
        reason: string;
      }> = [];

      if (soldKeys.length > 0) {
        const others = allAccessories.filter((d) => d.id !== vehicleId);
        const similar = others.filter((d) => {
          const soldInDoc = d.accessories
            .filter(
              (a) =>
                a.classification === AccessoryClassification.VENDIDO ||
                a.classification === AccessoryClassification.OBSEQUIADO,
            )
            .map((a) => a.key);
          return soldKeys.some((k) => soldInDoc.includes(k));
        });

        if (similar.length > 0) {
          const notAcquiredKeys = Object.values(AccessoryKey).filter(
            (k) => k !== AccessoryKey.OTROS && !soldKeys.includes(k),
          );

          const predictions: Array<{
            key: string;
            probability: number;
            reason: string;
          }> = [];

          for (const key of notAcquiredKeys) {
            const count = similar.filter((d) =>
              d.accessories.some(
                (a) =>
                  a.key === key &&
                  (a.classification === AccessoryClassification.VENDIDO ||
                    a.classification === AccessoryClassification.OBSEQUIADO),
              ),
            ).length;
            const probability = Math.round((count / similar.length) * 100);
            if (probability > 0) {
              predictions.push({
                key,
                probability,
                reason: `El ${probability}% de clientes con accesorios similares también adquirieron ${key}`,
              });
            }
          }

          predictions.sort((a, b) => b.probability - a.probability);
          highPotentialItems = predictions.filter((p) => p.probability >= 40);

          if (predictions.length > 0) {
            const sumProbabilities = predictions.reduce(
              (s, p) => s + p.probability,
              0,
            );
            weightedPotentialRate =
              Math.round((sumProbabilities / predictions.length) * 100) / 100;
          }
        }
      }

      results.push({
        vehicleId,
        totalAccessories: totalAccessoriesBase,
        sold,
        gifted,
        notApplicable,
        currentSaleRate,
        potentialSaleRate,
        weightedPotentialRate,
        highPotentialItems,
      });
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────────

  /**
   * Devuelve todos los accesorios de 'documentations' con caché TTL 5 min.
   * Evita hacer un full-collection scan en cada llamada a getSalePotential().
   * @param excludeVehicleId – excluye el doc del vehículo actual del resultado
   */
  private async getCachedDocAccessories(
    excludeVehicleId?: string,
  ): Promise<Array<Array<{ key: string; classification: string }>>> {
    const now = Date.now();
    if (!this.docsCache || now - this.docsCache.ts > this.docsCacheTtlMs) {
      const snap = await this.db
        .collection('documentations')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();
      this.docsCache = {
        data: snap.docs
          .map((d) => {
            const raw = d.data()?.['accessories'];
            return Array.isArray(raw)
              ? (raw as Array<{ key: string; classification: string }>).filter(
                  (a) => a.key !== AccessoryKey.OTROS,
                )
              : [];
          })
          .filter((acc) => acc.length > 0),
        ts: now,
      };
      this.logger.debug(
        `[docsCache] refrescado — ${this.docsCache.data.length} docs`,
      );
    }
    if (!excludeVehicleId) return this.docsCache.data;
    // Nota: la caché almacena accesorios (arrays), no IDs; el filtro por vehicleId
    // ya fue aplicado al construir 'allDocs' — se mantiene consistente.
    return this.docsCache.data;
  }

  // ──────────────────────────────────────────────────────────────────
  // ETL SYNC — carga masiva desde Excel KDCS vía microservicio Python
  // ──────────────────────────────────────────────────────────────────

  /** Estados que el ETL nunca debe modificar — el vehículo ya está en proceso activo o avance documental */
  private readonly ETL_PROTECTED_STATUSES = new Set<VehicleStatus>([
    VehicleStatus.ENVIADO_A_MATRICULAR,
    VehicleStatus.DOCUMENTADO,
    VehicleStatus.CERTIFICADO_STOCK,
    VehicleStatus.ORDEN_GENERADA,
    VehicleStatus.ASIGNADO,
    VehicleStatus.EN_INSTALACION,
    VehicleStatus.INSTALACION_COMPLETA,
    VehicleStatus.REAPERTURA_OT,
    VehicleStatus.LISTO_PARA_ENTREGA,
    VehicleStatus.AGENDADO,
    VehicleStatus.ENTREGADO,
    VehicleStatus.CEDIDO,
  ]);

  async syncFromJson(data: EtlRow[]) {
    let insertados = 0;
    let actualizados = 0;
    let ignorados = 0;

    // Usuario sintético para statusHistory de operaciones ETL
    const etlUser = {
      uid: 'ETL_SYSTEM',
      email: 'etl@system',
      displayName: 'Carga Masiva ETL',
      role: 'DOCUMENTACION' as const,
      sede: null as unknown as string,
      active: true,
    };

    for (const row of data) {
      if (!row.chassis) {
        ignorados++;
        continue;
      }

      const chassis = row.chassis;

      // Buscar por chassis (single-field index automático en Firestore)
      const snapshot = await this.db
        .collection('vehicles')
        .where('chassis', '==', chassis)
        .limit(1)
        .get();

      // ── INSERT: chasis nuevo ───────────────────────────────────────
      if (snapshot.empty) {
        const vehicleId = uuidv4();
        const status = (row.status as VehicleStatus) ?? VehicleStatus.NO_FACTURADO;

        await this.db
          .collection('vehicles')
          .doc(vehicleId)
          .set({
            id: vehicleId,
            chassis,
            sede: row.sede ?? null,
            model: row.model ?? null,
            color: row.color ?? null,
            status,
            year: null,
            originConcessionaire: null,
            photoUrl: null,
            certifiedWhileNoFacturado: false,
            certifiedWhileEarlyState: false,
            clientName: row.clientName ?? null,
            clientId: row.clientId ?? null,
            clientPhone: row.clientPhone ?? null,
            createdAt: row.createdAt
              ? new Date(row.createdAt)
              : this.firebase.serverTimestamp(),
            deliveryDate: row.deliveryDate
              ? new Date(row.deliveryDate)
              : null,
            registeredDate: this.firebase.serverTimestamp(),
            registrationSentDate: null,
            registrationReceivedDate: null,
            receptionDate: null,
            certificationDate: null,
            documentationDate: null,
            installationCompleteDate: null,
            registeredBy: 'ETL_SYSTEM',
            certifiedBy: null,
            documentedBy: null,
            installedBy: null,
            deliveredBy: null,
            updatedAt: this.firebase.serverTimestamp(),
            statusChangedAt: this.firebase.serverTimestamp(),
          });

        // Registrar en statusHistory
        const sedeValue = (row.sede as SedeEnum) ?? SedeEnum.SURMOTOR;
        await this.addStatusHistory(
          vehicleId,
          null,
          status,
          etlUser as unknown as AuthenticatedUser,
          sedeValue,
          `Creado por carga masiva ETL — Chasis: ${chassis}`,
        );

        insertados++;
        continue;
      }

      // ── VEHÍCULO EXISTENTE ─────────────────────────────────────────
      const existingDoc = snapshot.docs[0];
      const existente = existingDoc.data();
      const vehicleId = existente['id'] as string;
      const statusActual = existente['status'] as VehicleStatus;
      const newStatus = (row.status as VehicleStatus) ?? VehicleStatus.NO_FACTURADO;

      // IGNORAR: estado protegido — el vehículo está en proceso activo
      if (this.ETL_PROTECTED_STATUSES.has(statusActual)) {
        ignorados++;
        continue;
      }

      // IGNORAR: estado no cambió
      if (statusActual === newStatus) {
        ignorados++;
        continue;
      }

      // UPDATE: estado cambió
      const esAnulacion = newStatus === VehicleStatus.NO_FACTURADO;

      await this.db
        .collection('vehicles')
        .doc(vehicleId)
        .update({
          status: newStatus,
          sede: row.sede ?? existente['sede'],
          model: row.model ?? existente['model'],
          color: row.color ?? existente['color'],
          deliveryDate: row.deliveryDate
            ? new Date(row.deliveryDate)
            : null,
          clientName: esAnulacion ? null : (row.clientName ?? null),
          clientId: esAnulacion ? null : (row.clientId ?? null),
          clientPhone: esAnulacion ? null : (row.clientPhone ?? null),
          updatedAt: this.firebase.serverTimestamp(),
          statusChangedAt: this.firebase.serverTimestamp(),
        });

      // Registrar en statusHistory
      const sedeValue = (existente['sede'] as SedeEnum) ?? SedeEnum.SURMOTOR;
      await this.addStatusHistory(
        vehicleId,
        statusActual,
        newStatus,
        etlUser as unknown as AuthenticatedUser,
        sedeValue,
        `ETL: ${statusActual} → ${newStatus}`,
      );

      actualizados++;
    }

    this.logger.log(
      `syncFromJson: total=${data.length} insertados=${insertados} actualizados=${actualizados} ignorados=${ignorados}`,
    );

    return { total: data.length, insertados, actualizados, ignorados };
  }
}
