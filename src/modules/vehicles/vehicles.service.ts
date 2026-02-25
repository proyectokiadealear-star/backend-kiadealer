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
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(private readonly firebase: FirebaseService) {}

  private get db() {
    return this.firebase.firestore();
  }

  // ──────────────────────────────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────────────────────────────
  async create(
    dto: CreateVehicleDto,
    user: AuthenticatedUser,
    photoFile?: Express.Multer.File,
  ) {
    // 1. Validar chasis único
    const existing = await this.db
      .collection('vehicles')
      .where('chassis', '==', dto.chassis)
      .limit(1)
      .get();

    if (!existing.empty) {
      throw new BadRequestException(`El chasis '${dto.chassis}' ya existe en el sistema`);
    }

    // 2. Validar año dinámicamente (resiliente: siempre usa el año actual al momento del request)
    const currentYear = new Date().getFullYear();
    if (dto.year < currentYear) {
      throw new BadRequestException(
        `El año del vehículo debe ser >= ${currentYear}`,
      );
    }

    // 3. Sede se asigna automáticamente desde el claim del usuario (no viene del DTO)
    const sede = user.sede;

    const vehicleId = uuidv4();
    let photoUrl: string | null = null;

    // 3. Subir foto si viene como archivo multipart
    if (photoFile) {
      const storagePath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.uploadBuffer(photoFile.buffer, storagePath, photoFile.mimetype);
      photoUrl = await this.firebase.getSignedUrl(storagePath);
    } else if (dto.photoBase64) {
      // Soporte para base64 (flujo de pruebas / fallback)
      const base64Data = dto.photoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const storagePath = `vehicles/${vehicleId}/photo.jpg`;
      await this.firebase.uploadBuffer(buffer, storagePath, 'image/jpeg');
      photoUrl = await this.firebase.getSignedUrl(storagePath);
    }

    // 4. Crear documento Vehicle
    const now = this.firebase.serverTimestamp();
    const vehicleData = {
      id: vehicleId,
      chassis: dto.chassis,
      model: dto.model,
      year: dto.year,
      color: dto.color,
      originConcessionaire: dto.originConcessionaire,
      photoUrl,
      sede,
      status: VehicleStatus.RECEPCIONADO,
      receptionDate: now,
      certificationDate: null,
      documentationDate: null,
      installationCompleteDate: null,
      deliveryDate: null,
      receivedBy: user.uid,
      certifiedBy: null,
      documentedBy: null,
      installedBy: null,
      deliveredBy: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('vehicles').doc(vehicleId).set(vehicleData);

    // 5. Registrar en statusHistory
    await this.addStatusHistory(vehicleId, null, VehicleStatus.RECEPCIONADO, user, sede);

    this.logger.log(`Vehículo creado: ${vehicleId} (${dto.chassis}) por ${user.uid}`);

    return {
      id: vehicleId,
      chassis: dto.chassis,
      status: VehicleStatus.RECEPCIONADO,
      photoUrl,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // FIND ALL (con paginación y filtros)
  // ──────────────────────────────────────────────────────────────────
  async findAll(query: QueryVehiclesDto, user: AuthenticatedUser) {
    let ref: FirebaseFirestore.Query = this.db.collection('vehicles');

    // Reglas de filtro por sede:
    //  1. Si el query trae ?sede=X  → cualquier rol puede filtrar por esa sede (consulta de stock inter-sede)
    //  2. Sin ?sede y rol != JEFE_TALLER → se restringe a la sede del usuario (vista por defecto)
    //  3. Sin ?sede y rol == JEFE_TALLER → sin restricción (ve todo)
    if (query.sede) {
      ref = ref.where('sede', '==', query.sede);
    } else if (user.role !== RoleEnum.JEFE_TALLER) {
      ref = ref.where('sede', '==', user.sede);
    }

    // Filtrar por chasis (Firestore no tiene LIKE, filtramos post-query)
    if (query.status) {
      const statuses = query.status.split(',').map((s) => s.trim());
      ref = ref.where('status', 'in', statuses);
    }

    const snapshot = await ref.orderBy('createdAt', 'desc').get();
    let vehicles = snapshot.docs.map((d) => d.data());

    // Filtros en memoria (por limitaciones de Firestore)
    if (query.chassis) {
      const chassisLower = query.chassis.toLowerCase();
      vehicles = vehicles.filter((v) =>
        (v.chassis as string).toLowerCase().includes(chassisLower),
      );
    }

    if (query.clientId) {
      vehicles = vehicles.filter((v) => v.clientId === query.clientId);
    }

    const total = vehicles.length;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const start = (page - 1) * limit;
    const paginated = vehicles.slice(start, start + limit);

    // Generar URLs firmadas frescas
    const data = await Promise.all(
      paginated.map(async (v) => {
        if (v.photoUrl) {
          const path = `vehicles/${v.id}/photo.jpg`;
          v = { ...v, photoUrl: await this.firebase.getSignedUrl(path).catch(() => v.photoUrl) };
        }
        return v;
      }),
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
    if (
      user.role !== RoleEnum.JEFE_TALLER &&
      vehicle['sede'] !== user.sede
    ) {
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
  // UPDATE (solo JEFE_TALLER)
  // ──────────────────────────────────────────────────────────────────
  async update(id: string, dto: UpdateVehicleDto) {
    await this.assertExists(id);
    const updates: Record<string, unknown> = {
      ...dto,
      updatedAt: this.firebase.serverTimestamp(),
    };
    delete updates['photoBase64'];
    await this.db.collection('vehicles').doc(id).update(updates);
    return { id, updated: true };
  }

  // ──────────────────────────────────────────────────────────────────
  // DELETE (solo JEFE_TALLER)
  // ──────────────────────────────────────────────────────────────────
  async remove(id: string) {
    await this.assertExists(id);
    await this.db.collection('vehicles').doc(id).delete();
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

    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: this.firebase.serverTimestamp(),
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
  async statsBySede() {
    const snapshot = await this.db.collection('vehicles').get();
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

    if (user.role !== RoleEnum.JEFE_TALLER) {
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
}
