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

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

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

    // 4. Crear documento Vehicle — registro contable (POR_ARRIBAR)
    //    La foto y el concesionario de origen se registran en la certificación física.
    const now = this.firebase.serverTimestamp();
    const vehicleData = {
      id: vehicleId,
      chassis: dto.chassis,
      model: dto.model,
      year: dto.year,
      color: dto.color,
      originConcessionaire: null,
      photoUrl: null,
      sede,
      status: VehicleStatus.POR_ARRIBAR,
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
    };

    await this.db.collection('vehicles').doc(vehicleId).set(vehicleData);

    // 5. Registrar en statusHistory
    await this.addStatusHistory(
      vehicleId,
      null,
      VehicleStatus.POR_ARRIBAR,
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
      status: VehicleStatus.POR_ARRIBAR,
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
    } else if (user.role !== RoleEnum.JEFE_TALLER) {
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

    const needsTextFilter = !!(query.chassis || query.clientId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const start = (page - 1) * limit;

    let vehicles: FirebaseFirestore.DocumentData[];
    let total: number;

    if (needsTextFilter) {
      // Filtros de substring requieren traer todo y filtrar en memoria
      const snapshot = await ref.get();
      vehicles = snapshot.docs
        .map((d) => d.data())
        .sort(
          (a, b) =>
            (b['createdAt']?._seconds ?? 0) - (a['createdAt']?._seconds ?? 0),
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

      total = vehicles.length;
      vehicles = vehicles.slice(start, start + limit);
    } else {
      // Sin filtro de texto: paginación a nivel Firestore
      // orderBy requiere índice compuesto — fallback a memoria si no existe
      try {
        const ordered = ref.orderBy('createdAt', 'desc');
        const [countSnap, dataSnap] = await Promise.all([
          ordered.count().get(),
          ordered.offset(start).limit(limit).get(),
        ]);
        total = countSnap.data().count;
        vehicles = dataSnap.docs.map((d) => d.data());
      } catch {
        // Índice compuesto no existe — fallback
        this.logger.warn(
          'findAll: orderBy+offset falló (índice compuesto faltante). Usando paginación en memoria.',
        );
        const snapshot = await ref.get();
        vehicles = snapshot.docs
          .map((d) => d.data())
          .sort(
            (a, b) =>
              (b['createdAt']?._seconds ?? 0) - (a['createdAt']?._seconds ?? 0),
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
    if (user.role !== RoleEnum.JEFE_TALLER && vehicle['sede'] !== user.sede) {
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
      const allDocsSnap = await this.db.collection('documentations').get();
      const allDocs = allDocsSnap.docs
        .filter((d) => d.id !== vehicleId)
        .map((d) => {
          const raw = d.data()?.['accessories'];
          return Array.isArray(raw)
            ? (raw as Array<{ key: string; classification: string }>).filter(
                (a) => a.key !== AccessoryKey.OTROS,
              )
            : [];
        })
        .filter((acc) => acc.length > 0);

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
}
