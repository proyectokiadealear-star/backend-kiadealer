import { Injectable } from '@nestjs/common';
import { Query, WriteBatch } from 'firebase-admin/firestore';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuditService } from '../../modules/audit/audit.service';
import {
  TenantScopedDocument,
  TenantScopedRepository,
} from '../../common/repositories/tenant-scoped.repository';

export interface Vehicle extends TenantScopedDocument {
  chassis?: string;
  status?: string;
  sede?: string;
  establishmentId?: string;
  [key: string]: unknown;
}

export interface StatusHistoryEntry {
  id?: string;
  status: string;
  changedBy: string;
  changedByRole?: string;
  changedAt: unknown;
  note?: string;
  [key: string]: unknown;
}

const STATUS_HISTORY_SUBCOLLECTION = 'statusHistory';

/** Límite de operaciones por batch de Firestore. */
const BATCH_LIMIT = 500;

@Injectable()
export class VehiclesRepository extends TenantScopedRepository<Vehicle> {
  protected readonly collectionName = 'vehicles';

  constructor(firebase: FirebaseService, audit: AuditService) {
    super(firebase, audit);
  }

  /**
   * Consulta base acotada al concesionario, para que el servicio encadene sus
   * propios filtros de negocio (status, sede, rangos de fecha).
   *
   * Es la única vía por la que el servicio arma consultas propias: devuelve
   * una `Query` que YA tiene el `where('tenantId')` aplicado, así que ningún
   * filtro posterior puede sacarla del scope.
   */
  query(): Query {
    return this.scopedQuery();
  }

  // ── Subcolección statusHistory ──────────────────────────────────────────
  //
  // El historial vive bajo `vehicles/{id}/statusHistory`. Firestore NO propaga
  // el scope del padre a sus subcolecciones: quien conozca el id de un
  // vehículo ajeno podría leer su historial completo si el acceso no se
  // valida. Por eso TODA operación de historial verifica primero que el
  // vehículo padre pertenezca al concesionario activo.

  /**
   * Historial de un vehículo, o `null` si el vehículo no existe o es de otro
   * concesionario. Devolver `null` —y no un arreglo vacío— permite al llamador
   * distinguir "sin historial" de "sin acceso".
   */
  async getStatusHistory(
    vehicleId: string,
  ): Promise<StatusHistoryEntry[] | null> {
    if (!(await this.exists(vehicleId))) return null;

    const snapshot = await this.collection()
      .doc(vehicleId)
      .collection(STATUS_HISTORY_SUBCOLLECTION)
      .orderBy('changedAt', 'desc')
      .get();

    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as StatusHistoryEntry,
    );
  }

  /**
   * Agrega una entrada al historial. Devuelve `false` si el vehículo no es
   * accesible desde el concesionario activo, sin escribir nada.
   */
  async addStatusHistory(
    vehicleId: string,
    entry: StatusHistoryEntry,
  ): Promise<boolean> {
    if (!(await this.exists(vehicleId))) return false;

    await this.collection()
      .doc(vehicleId)
      .collection(STATUS_HISTORY_SUBCOLLECTION)
      .add(entry);

    return true;
  }

  // ── Borrado en lote ─────────────────────────────────────────────────────

  /**
   * Borra varios vehículos y su historial, respetando el scope.
   *
   * Verifica pertenencia vehículo por vehículo antes de encolar el borrado:
   * un id ajeno se omite en silencio en vez de borrarse. Devuelve los ids
   * efectivamente borrados para que el llamador reporte con precisión.
   *
   * Los batches de Firestore admiten 500 operaciones; como cada vehículo
   * consume 1 más una por entrada de historial, se corta por debajo del
   * límite y se hacen tantos batches como haga falta.
   */
  async deleteManyWithHistory(vehicleIds: string[]): Promise<string[]> {
    const deleted: string[] = [];
    let batch: WriteBatch = this.firebase.rawFirestore().batch();
    let pending = 0;

    const flush = async () => {
      if (pending === 0) return;
      await batch.commit();
      batch = this.firebase.rawFirestore().batch();
      pending = 0;
    };

    for (const vehicleId of vehicleIds) {
      if (!(await this.exists(vehicleId))) continue;

      const vehicleRef = this.collection().doc(vehicleId);
      const historySnapshot = await vehicleRef
        .collection(STATUS_HISTORY_SUBCOLLECTION)
        .get();

      // +1 por el vehículo mismo. Si el vehículo con su historial no entra en
      // lo que queda del batch, se cierra el batch actual y se abre otro.
      if (pending + historySnapshot.size + 1 > BATCH_LIMIT) await flush();

      for (const historyDoc of historySnapshot.docs) {
        batch.delete(historyDoc.ref);
        pending += 1;
      }
      batch.delete(vehicleRef);
      pending += 1;

      deleted.push(vehicleId);
    }

    await flush();
    return deleted;
  }

  /**
   * Alta o actualización masiva desde el ETL, con `tenantId` forzado desde el
   * contexto en cada documento.
   *
   * `merge: true` preserva los campos que el ETL no trae — es lo que evita
   * que una importación borre datos cargados por el flujo de negocio.
   */
  async upsertMany(
    documents: { id: string; data: Record<string, unknown> }[],
  ): Promise<number> {
    const { tenantId } = this.currentContext();
    let batch = this.firebase.rawFirestore().batch();
    let pending = 0;
    let written = 0;

    for (const document of documents) {
      batch.set(
        this.collection().doc(document.id),
        { ...document.data, tenantId },
        { merge: true },
      );
      pending += 1;
      written += 1;

      if (pending === BATCH_LIMIT) {
        await batch.commit();
        batch = this.firebase.rawFirestore().batch();
        pending = 0;
      }
    }

    if (pending > 0) await batch.commit();
    return written;
  }
}
