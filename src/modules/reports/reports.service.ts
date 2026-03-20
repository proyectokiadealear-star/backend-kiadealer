import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import PDFDocument = require('pdfkit');

// REQ-BI-01: all 15 pipeline statuses always present in byStatus response
const ALL_VEHICLE_STATUSES = [
  'NO_FACTURADO',
  'POR_ARRIBAR',
  'ENVIADO_A_MATRICULAR',
  'CERTIFICADO_STOCK',
  'DOCUMENTACION_PENDIENTE',
  'DOCUMENTADO',
  'ORDEN_GENERADA',
  'ASIGNADO',
  'EN_INSTALACION',
  'INSTALACION_COMPLETA',
  'REAPERTURA_OT',
  'LISTO_PARA_ENTREGA',
  'AGENDADO',
  'ENTREGADO',
  'CEDIDO',
] as const;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
  ) {}

  private get db() { return this.firebase.firestore(); }

  private toDate(field: any): Date | null {
    if (!field) return null;
    if (typeof field === 'string') {
      const d = new Date(field);
      return isNaN(d.getTime()) ? null : d;
    }
    const secs = field._seconds ?? field.seconds;
    if (typeof secs === 'number') return new Date(secs * 1000);
    if (field.toDate) return field.toDate();
    return null;
  }
  async getAnalytics(
    user: AuthenticatedUser,
    filters?: { sede?: string; model?: string; dateFrom?: string; dateTo?: string },
  ) {
    // ── Fetch all collections in parallel ──────────────────────────────
    const [vehiclesSnap, ordersSnap, docsSnap, ceremoniesSnap] = await Promise.all([
      this.db.collection('vehicles').get(),
      this.db.collection('service-orders').get(),
      this.db.collection('documentations').get(),
      this.db.collection('deliveryCeremonies').get(),
    ]);

    const all: any[] = vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allOrders: any[] = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allDocs: any[] = docsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allCeremonies: any[] = ceremoniesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Build vehicleId → sede lookup for cross-collection joins
    const vehicleSedeMap: Record<string, string> = {};
    for (const v of all) vehicleSedeMap[v.id] = v['sede'] ?? '';

    const allowedSedes: string[] | null =
      user.role === RoleEnum.SOPORTE ||
      user.role === RoleEnum.SUPERVISOR ||
      user.role === RoleEnum.JEFE_TALLER
        ? null
        : [user.sede].filter(Boolean);

    let vehicles = all.filter((v) => {
      if (!allowedSedes) return true;
      return allowedSedes.includes(v['sede']);
    });

    if (filters?.sede) {
      vehicles = vehicles.filter((v) => v['sede'] === filters!.sede);
    }

    if (filters?.model) {
      const modelQuery = filters.model.trim().replace(/^KIA\s+/i, '').toUpperCase();
      vehicles = vehicles.filter((v) => {
        const vModel = (v['model'] ?? '').replace(/^KIA\s+/i, '').toUpperCase();
        return vModel === modelQuery;
      });
    }

    // Build a Set of vehicleIds that pass the sede/model filter, for joins
    const allowedVehicleIds = new Set(vehicles.map((v: any) => v.id as string));

    let dateFromTs: Date | null = null;
    let dateToTs: Date | null = null;
    if (filters?.dateFrom) {
      const p = filters.dateFrom.split('/');
      dateFromTs = new Date(p[2] + '-' + p[1] + '-' + p[0] + 'T00:00:00');
    }
    if (filters?.dateTo) {
      const p = filters.dateTo.split('/');
      dateToTs = new Date(p[2] + '-' + p[1] + '-' + p[0] + 'T23:59:59');
    }

    // "filtered" = todo el inventario activo (sede + modelo) — SIN filtro de fecha.
    // El filtro de fecha aplica SOLO a métricas de entrega (deliveries).
    const filtered = vehicles;

    // filteredDeliveries: vehículos entregados DENTRO del rango de fechas seleccionado
    const filteredDeliveries = vehicles.filter((v) => {
      if (v['status'] !== 'ENTREGADO') return false;
      const del = this.toDate(v['deliveryDate']);
      if (!del) return false;
      if (dateFromTs && del < dateFromTs) return false;
      if (dateToTs && del > dateToTs) return false;
      return true;
    });

    // REQ-BI-01: initialize all 15 statuses to 0 so the frontend always
    // receives a complete pipeline snapshot — even for stages with no vehicles
    const byStatus: Record<string, number> = {};
    for (const s of ALL_VEHICLE_STATUSES) byStatus[s] = 0;
    for (const v of filtered) {
      const s = v['status'] ?? 'UNKNOWN';
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    const bySede: Record<string, number> = {};
    for (const v of filtered) {
      const s = v['sede'] ?? 'UNKNOWN';
      bySede[s] = (bySede[s] ?? 0) + 1;
    }

    const byModel: Record<string, number> = {};
    for (const v of filtered) {
      const m = v['model'] ?? 'UNKNOWN';
      byModel[m] = (byModel[m] ?? 0) + 1;
    }

    const byColor: Record<string, number> = {};
    for (const v of filtered) {
      const c = v['color'] ?? 'UNKNOWN';
      byColor[c] = (byColor[c] ?? 0) + 1;
    }

    // avg/median — calculados sobre entregas del período seleccionado (filteredDeliveries)
    const deliveryDurations: number[] = [];
    for (const v of filteredDeliveries) {
      const ca = this.toDate(v['createdAt']);
      const del = this.toDate(v['deliveryDate']);
      if (!ca || !del) continue;
      const days = (del.getTime() - ca.getTime()) / 86400000;
      if (days >= 0) deliveryDurations.push(days);
    }
    const avgDaysToDelivery =
      deliveryDurations.length
        ? Math.round((deliveryDurations.reduce((s, d) => s + d, 0) / deliveryDurations.length) * 10) / 10
        : null;
    let medianDaysToDelivery: number | null = null;
    if (deliveryDurations.length) {
      const sorted = [...deliveryDurations].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianDaysToDelivery =
        sorted.length % 2 === 0
          ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
          : Math.round(sorted[mid] * 10) / 10;
    }

    // byModelRotation — calculado sobre entregas del período (filteredDeliveries)
    const modelDaysMap: Record<string, number[]> = {};
    for (const v of filteredDeliveries) {
      const ca = this.toDate(v['createdAt']);
      const del = this.toDate(v['deliveryDate']);
      if (!ca || !del) continue;
      const days = (del.getTime() - ca.getTime()) / 86400000;
      if (days < 0) continue;
      const m = (v['model'] ?? 'UNKNOWN').replace(/^KIA\s+/i, '');
      if (!modelDaysMap[m]) modelDaysMap[m] = [];
      modelDaysMap[m].push(days);
    }
    const byModelRotation: Record<string, { avgDays: number; count: number }> = {};
    for (const [model, days] of Object.entries(modelDaysMap)) {
      byModelRotation[model] = {
        avgDays: Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10,
        count: days.length,
      };
    }

    // ── Accessories — read from `documentations` collection ──────────────
    // documentations[].accessories[].classification = VENDIDO | OBSEQUIADO | NO_APLICA
    // Filter: only documentations whose vehicleId belongs to an allowed vehicle
    const accByKey: Record<string, { VENDIDO: number; OBSEQUIADO: number; NO_APLICA: number }> = {};
    for (const doc of allDocs) {
      const vid = doc['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      // Apply sede filter if set
      if (filters?.sede && vehicleSedeMap[vid] !== filters.sede) continue;
      const accs: any[] = doc['accessories'] ?? [];
      for (const acc of accs) {
        const key = acc['key'] ?? 'UNKNOWN';
        const classification = (acc['classification'] ?? 'NO_APLICA') as string;
        if (!accByKey[key]) accByKey[key] = { VENDIDO: 0, OBSEQUIADO: 0, NO_APLICA: 0 };
        if (classification === 'VENDIDO') accByKey[key].VENDIDO++;
        else if (classification === 'OBSEQUIADO') accByKey[key].OBSEQUIADO++;
        else accByKey[key].NO_APLICA++;
      }
    }
    const topSold = Object.entries(accByKey)
      .map(([key, vals]) => ({ key, vendido: vals.VENDIDO }))
      .sort((a, b) => b.vendido - a.vendido)
      .slice(0, 5);
    const totalVendido = Object.values(accByKey).reduce((s, x) => s + x.VENDIDO, 0);
    const totalObsequiado = Object.values(accByKey).reduce((s, x) => s + x.OBSEQUIADO, 0);

    // ── Top Asesores (órdenes) — from `service-orders`, field createdBy ──
    // Filter orders by: vehicleId in allowedVehicleIds + createdAt in date range
    const asesorOrdenesMap: Record<string, { name: string; sede: string; ordenes: number }> = {};
    for (const order of allOrders) {
      const vid = order['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      if (filters?.sede && vehicleSedeMap[vid] !== filters.sede) continue;
      const createdAt = this.toDate(order['createdAt']);
      if (dateFromTs && createdAt && createdAt < dateFromTs) continue;
      if (dateToTs && createdAt && createdAt > dateToTs) continue;
      const uid = order['createdBy'] as string | undefined;
      if (!uid) continue;
      const name = (order['createdByName'] as string | undefined) ?? uid;
      const sede = vehicleSedeMap[vid] ?? (order['sede'] as string | undefined) ?? '';
      if (!asesorOrdenesMap[uid]) asesorOrdenesMap[uid] = { name, sede, ordenes: 0 };
      asesorOrdenesMap[uid].ordenes++;
    }
    const topOrdenesGeneradas = Object.entries(asesorOrdenesMap)
      .map(([uid, val]) => ({ uid, ...val }))
      .sort((a, b) => b.ordenes - a.ordenes)
      .slice(0, 10);

    // ── Top Asesores (entregas) — from `deliveryCeremonies`, field deliveredBy ──
    // Filter ceremonies by: vehicleId in allowedVehicleIds + createdAt in date range
    const asesorEntregasMap: Record<string, { name: string; sede: string; entregas: number }> = {};
    for (const ceremony of allCeremonies) {
      const vid = ceremony['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      if (filters?.sede && vehicleSedeMap[vid] !== filters.sede) continue;
      const createdAt = this.toDate(ceremony['createdAt']);
      if (dateFromTs && createdAt && createdAt < dateFromTs) continue;
      if (dateToTs && createdAt && createdAt > dateToTs) continue;
      const uid = ceremony['deliveredBy'] as string | undefined;
      if (!uid) continue;
      const name = (ceremony['deliveredByName'] as string | undefined) ?? uid;
      const sede = vehicleSedeMap[vid] ?? '';
      if (!asesorEntregasMap[uid]) asesorEntregasMap[uid] = { name, sede, entregas: 0 };
      asesorEntregasMap[uid].entregas++;
    }
    const topEntregas = Object.entries(asesorEntregasMap)
      .map(([uid, val]) => ({ uid, ...val }))
      .sort((a, b) => b.entregas - a.entregas)
      .slice(0, 10);

    // ── Top Taller (OTs) — from `service-orders`, field assignedTechnicianId ──
    // Filter: vehicleId in allowedVehicleIds + assignedAt in date range + has technician
    const tallerMap: Record<string, { name: string; sede: string; totalOTs: number }> = {};
    for (const order of allOrders) {
      const vid = order['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      if (filters?.sede && vehicleSedeMap[vid] !== filters.sede) continue;
      const uid = order['assignedTechnicianId'] as string | undefined;
      if (!uid) continue;
      const assignedAt = this.toDate(order['assignedAt'] ?? order['updatedAt'] ?? order['createdAt']);
      if (dateFromTs && assignedAt && assignedAt < dateFromTs) continue;
      if (dateToTs && assignedAt && assignedAt > dateToTs) continue;
      const name = (order['assignedTechnicianName'] as string | undefined) ?? uid;
      const sede = vehicleSedeMap[vid] ?? (order['sede'] as string | undefined) ?? '';
      if (!tallerMap[uid]) tallerMap[uid] = { name, sede, totalOTs: 0 };
      tallerMap[uid].totalOTs++;
    }
    const topTaller = Object.entries(tallerMap)
      .map(([uid, val]) => ({ uid, ...val }))
      .sort((a, b) => b.totalOTs - a.totalOTs)
      .slice(0, 10);

    // REQ-BI-09: monthly delivery trend — last 12 months based on deliveryDate
    const monthlyMap: Record<string, number> = {};
    const now = new Date();
    // Pre-seed the last 12 calendar months so months with 0 deliveries appear too
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap[key] = 0;
    }
    for (const v of filteredDeliveries) {
      const del = this.toDate(v['deliveryDate']);
      if (!del) continue;
      const key = `${del.getFullYear()}-${String(del.getMonth() + 1).padStart(2, '0')}`;
      if (key in monthlyMap) monthlyMap[key] = (monthlyMap[key] ?? 0) + 1;
    }
    const byMonthlyDeliveries = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    return {
      total: filtered.length,
      vehiclesDelivered: filteredDeliveries.length,
      byStatus,
      bySede,
      byModel,
      byColor,
      avgDaysToDelivery,
      medianDaysToDelivery,
      byModelRotation,
      byMonthlyDeliveries,
      accessories: {
        byKey: accByKey,
        topSold,
        totalVendido,
        totalObsequiado,
      },
      topAsesores: {
        ordenesGeneradas: topOrdenesGeneradas,
        entregas: topEntregas,
      },
      topTaller,
    };
  }
  async generateVehicleReport(vehicleId: string, user: AuthenticatedUser): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const snap = await this.db.collection('vehicles').doc(vehicleId).get();
    if (!snap.exists) throw new Error('Vehicle not found');
    const v = snap.data() as any;
    doc.fontSize(18).text('Reporte de Trazabilidad', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text('ID: ' + vehicleId);
    doc.text('Modelo: ' + (v.model ?? '-'));
    doc.text('VIN: ' + (v.vin ?? '-'));
    doc.text('Estado: ' + (v.status ?? '-'));
    doc.text('Sede: ' + (v.sede ?? '-'));
    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async getTechnicianPerformance(uid: string) {
    const snap = await this.db.collection('vehicles')
      .where('assignedTechnicianUid', '==', uid)
      .get();
    const vehicles = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
    const completed = vehicles.filter((v) => v.status === 'ENTREGADO').length;
    return {
      uid,
      totalAssigned: vehicles.length,
      totalCompleted: completed,
      completionRate: vehicles.length ? Math.round((completed / vehicles.length) * 100) : 0,
    };
  }
}
