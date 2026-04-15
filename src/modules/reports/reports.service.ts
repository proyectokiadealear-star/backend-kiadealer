import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RoleEnum } from '../../common/enums/role.enum';
import PDFDocument = require('pdfkit');
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';
import {
  ALL_VEHICLE_STATUSES,
  AnalyticsFiltersApplied,
  AnalyticsResponseContract,
} from './contracts/analytics.contract';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly firebase: FirebaseService,
  ) {}

  private get db() {
    return this.firebase.firestore();
  }

  private normalizeAccessoryKey(input: unknown): string {
    if (typeof input !== 'string') return 'UNKNOWN';
    const normalized = input.trim().toUpperCase();
    return normalized || 'UNKNOWN';
  }

  private normalizeAccessoryClassification(input: unknown): 'VENDIDO' | 'OBSEQUIADO' | 'NO_APLICA' {
    if (typeof input !== 'string') return 'NO_APLICA';
    const normalized = input.trim().toUpperCase();
    if (normalized === 'VENDIDO' || normalized === 'OBSEQUIADO') return normalized;
    return 'NO_APLICA';
  }

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

  private normalizeModel(model?: string): string | null {
    if (!model) return null;
    const normalized = model
      .trim()
      .replace(/^KIA\s+/i, '')
      .toUpperCase();
    return normalized || null;
  }

  private getISOWeekParts(date: Date): { year: number; week: number } {
    const utc = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    const dayNum = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return { year: utc.getUTCFullYear(), week };
  }

  private parseScheduledDateEndOfDay(value?: string): Date | null {
    if (!value || typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59.999Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private isDocumentationComplete(doc: any): boolean | null {
    if (!doc) return null;
    const status = doc['documentationStatus'];
    if (status === 'COMPLETO') return true;
    if (status === 'PENDIENTE') return false;
    return null;
  }

  private evaluateAccessoriesCompletion(
    doc: any,
    relatedOrders: any[],
  ): { complete: boolean; insufficient: boolean } {
    const rawAccessories = doc?.['accessories'];
    if (!Array.isArray(rawAccessories)) {
      return { complete: false, insufficient: true };
    }

    const requestedKeys = rawAccessories
      .filter(
        (item) =>
          item &&
          typeof item['key'] === 'string' &&
          item['classification'] !== 'NO_APLICA',
      )
      .map((item) => item['key'] as string);

    if (requestedKeys.length === 0) {
      return { complete: true, insufficient: false };
    }

    if (!relatedOrders.length) {
      return { complete: false, insufficient: true };
    }

    const checklistItems = relatedOrders.flatMap((order) =>
      Array.isArray(order?.['checklist']) ? order['checklist'] : [],
    );

    if (!checklistItems.length) {
      return { complete: false, insufficient: true };
    }

    const installedKeys = new Set(
      checklistItems
        .filter(
          (item) =>
            item && typeof item['key'] === 'string' && item['installed'] === true,
        )
        .map((item) => item['key'] as string),
    );

    const allInstalled = requestedKeys.every((key) => installedKeys.has(key));
    return { complete: allInstalled, insufficient: false };
  }

  private computeOtif(
    deliveries: any[],
    allAppointments: any[],
    allDocs: any[],
    allOrders: any[],
  ): {
    numerator: number;
    denominator: number;
    valuePct: number | null;
    missingPromisedDate: number;
    insufficientData: number;
    passed: number;
    failed: number;
    noEvaluable: number;
    totalDeliveriesInPeriod: number;
    totalDeliveriesEvaluable: number;
    failureReasons: {
      late: number;
      incomplete_docs: number;
      incomplete_accessories: number;
    };
    definitionVersion: 'v1';
  } {
    const docsByVehicleId = new Map<string, any>();
    for (const doc of allDocs) {
      const vehicleId = doc?.['vehicleId'];
      if (typeof vehicleId === 'string' && !docsByVehicleId.has(vehicleId)) {
        docsByVehicleId.set(vehicleId, doc);
      }
    }

    const ordersByVehicleId = new Map<string, any[]>();
    for (const order of allOrders) {
      const vehicleId = order?.['vehicleId'];
      if (typeof vehicleId !== 'string') continue;
      const prev = ordersByVehicleId.get(vehicleId) ?? [];
      prev.push(order);
      ordersByVehicleId.set(vehicleId, prev);
    }

    const appointmentsByVehicleId = new Map<string, any[]>();
    for (const appointment of allAppointments) {
      const vehicleId = appointment?.['vehicleId'];
      if (typeof vehicleId !== 'string') continue;
      if (appointment?.['status'] === 'CANCELADO') continue;
      const prev = appointmentsByVehicleId.get(vehicleId) ?? [];
      prev.push(appointment);
      appointmentsByVehicleId.set(vehicleId, prev);
    }

    let numerator = 0;
    let denominator = 0;
    let missingPromisedDate = 0;
    let insufficientData = 0;
    let failed = 0;
    const failureReasons = {
      late: 0,
      incomplete_docs: 0,
      incomplete_accessories: 0,
    };

    for (const vehicle of deliveries) {
      const vehicleId = vehicle?.['id'] as string;
      const deliveryDate = this.toDate(vehicle?.['deliveryDate']);
      if (!vehicleId || !deliveryDate) continue;

      const candidates = appointmentsByVehicleId.get(vehicleId) ?? [];
      const selectedAppointment = [...candidates]
        .sort((a, b) => {
          const aDate = this.parseScheduledDateEndOfDay(a?.['scheduledDate']);
          const bDate = this.parseScheduledDateEndOfDay(b?.['scheduledDate']);
          const aTime = aDate?.getTime() ?? 0;
          const bTime = bDate?.getTime() ?? 0;
          return bTime - aTime;
        })
        .at(0);

      const promisedDate = this.parseScheduledDateEndOfDay(
        selectedAppointment?.['scheduledDate'],
      );
      if (!promisedDate) {
        missingPromisedDate += 1;
        continue;
      }

      const doc = docsByVehicleId.get(vehicleId);
      const docComplete = this.isDocumentationComplete(doc);
      const accessories = this.evaluateAccessoriesCompletion(
        doc,
        ordersByVehicleId.get(vehicleId) ?? [],
      );

      if (docComplete === null || accessories.insufficient) {
        insufficientData += 1;
        continue;
      }

      denominator += 1;

      const onTime = deliveryDate.getTime() <= promisedDate.getTime();
      const docsComplete = docComplete === true;
      const accessoriesComplete = accessories.complete;
      const inFull = docsComplete && accessoriesComplete;
      if (onTime && inFull) {
        numerator += 1;
      } else {
        failed += 1;
        if (!onTime) failureReasons.late += 1;
        if (!docsComplete) failureReasons.incomplete_docs += 1;
        if (!accessoriesComplete) failureReasons.incomplete_accessories += 1;
      }
    }

    const valuePct = denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
    const noEvaluable = missingPromisedDate + insufficientData;

    return {
      numerator,
      denominator,
      valuePct,
      missingPromisedDate,
      insufficientData,
      passed: numerator,
      failed,
      noEvaluable,
      totalDeliveriesInPeriod: deliveries.length,
      totalDeliveriesEvaluable: denominator,
      failureReasons,
      definitionVersion: 'v1',
    };
  }

  private requiresRegistrationReception(status: unknown): boolean {
    return [
      'ENVIADO_A_MATRICULAR',
      'DOCUMENTACION_PENDIENTE',
      'DOCUMENTADO',
      'CERTIFICADO_STOCK',
      'ORDEN_GENERADA',
      'ASIGNADO',
      'EN_INSTALACION',
      'INSTALACION_COMPLETA',
      'LISTO_PARA_ENTREGA',
    ].includes(String(status ?? ''));
  }

  private hasRegistrationReceptionPending(vehicle: any): boolean {
    const status = vehicle?.['status'];
    if (!this.requiresRegistrationReception(status)) {
      return false;
    }

    const registrationReceivedDate = vehicle?.['registrationReceivedDate'];
    if (typeof registrationReceivedDate !== 'string') {
      return true;
    }

    return registrationReceivedDate.trim() === '';
  }

  private buildRegistrationBacklog(filteredVehicles: any[]): {
    pendingReception: number;
    porArribar: number;
    pendingToRegister: number;
  } {
    let pendingReception = 0;
    let porArribar = 0;

    for (const vehicle of filteredVehicles) {
      const status = vehicle?.['status'];
      if (status === 'POR_ARRIBAR') {
        porArribar += 1;
      }

      if (this.hasRegistrationReceptionPending(vehicle)) {
        pendingReception += 1;
      }
    }

    return {
      pendingReception,
      porArribar,
      pendingToRegister: pendingReception + porArribar,
    };
  }

  private parseDayBound(value: string, endOfDay: boolean): Date {
    const parts = value.split('/');
    if (parts.length !== 3) {
      throw new BadRequestException(
        `Formato de fecha inválido: ${value}. Use dd/MM/yyyy`,
      );
    }
    const [day, month, year] = parts;
    const iso = `${year}-${month}-${day}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(
        `Formato de fecha inválido: ${value}. Use dd/MM/yyyy`,
      );
    }

    const utcDay = String(date.getUTCDate()).padStart(2, '0');
    const utcMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const utcYear = String(date.getUTCFullYear());
    const reconstructed = `${utcDay}/${utcMonth}/${utcYear}`;
    if (reconstructed !== value) {
      throw new BadRequestException(`Fecha inválida: ${value}`);
    }

    return date;
  }

  private normalizeFilters(filters?: AnalyticsFiltersDto): {
    sede: string | null;
    modelNormalized: string | null;
    dateFromTs: Date | null;
    dateToTs: Date | null;
    groupBy: 'day' | 'week' | 'month';
    filtersApplied: AnalyticsFiltersApplied;
  } {
    const sede = filters?.sede?.trim() ? filters.sede.trim() : null;
    const modelNormalized = this.normalizeModel(filters?.model);

    const dateFromTs = filters?.dateFrom
      ? this.parseDayBound(filters.dateFrom, false)
      : null;
    const dateToTs = filters?.dateTo
      ? this.parseDayBound(filters.dateTo, true)
      : null;
    const groupBy = filters?.groupBy ?? 'month';

    if (dateFromTs && dateToTs && dateFromTs.getTime() > dateToTs.getTime()) {
      throw new BadRequestException(
        'Rango de fechas inválido: dateFrom debe ser menor o igual a dateTo',
      );
    }

    return {
      sede,
      modelNormalized,
      dateFromTs,
      dateToTs,
      groupBy,
      filtersApplied: {
        sede,
        modelNormalized,
        dateFrom: filters?.dateFrom ?? null,
        dateTo: filters?.dateTo ?? null,
        groupBy,
      },
    };
  }

  async getAnalytics(
    user: AuthenticatedUser,
    filters?: AnalyticsFiltersDto,
  ): Promise<AnalyticsResponseContract> {
    const { sede, modelNormalized, dateFromTs, dateToTs, groupBy, filtersApplied } =
      this.normalizeFilters(filters);

    // ── Fetch all collections in parallel ──────────────────────────────
    const [
      vehiclesSnap,
      ordersSnap,
      docsSnap,
      ceremoniesSnap,
      appointmentsSnap,
      accessoriesCatalogSnap,
    ] =
      await Promise.all([
        this.db.collection('vehicles').get(),
        this.db.collection('service-orders').get(),
        this.db.collection('documentations').get(),
        this.db.collection('deliveryCeremonies').get(),
        this.db.collection('appointments').get(),
        this.db.collection('catalogs').doc('accessories').collection('items').get(),
      ]);

    const all: any[] = vehiclesSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const allOrders: any[] = ordersSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const allDocs: any[] = docsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const allCeremonies: any[] = ceremoniesSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const allAppointments: any[] = appointmentsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const accessoriesCatalog: any[] = accessoriesCatalogSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

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

    if (sede) {
      vehicles = vehicles.filter((v) => v['sede'] === sede);
    }

    if (modelNormalized) {
      vehicles = vehicles.filter((v) => {
        const vModel = (v['model'] ?? '').replace(/^KIA\s+/i, '').toUpperCase();
        return vModel === modelNormalized;
      });
    }

    // Build a Set of vehicleIds that pass the sede/model filter, for joins
    const allowedVehicleIds = new Set(vehicles.map((v: any) => v.id as string));

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
    const avgDaysToDelivery = deliveryDurations.length
      ? Math.round(
          (deliveryDurations.reduce((s, d) => s + d, 0) /
            deliveryDurations.length) *
            10,
        ) / 10
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
    const byModelRotation: Record<string, { avgDays: number; count: number }> =
      {};
    for (const [model, days] of Object.entries(modelDaysMap)) {
      byModelRotation[model] = {
        avgDays:
          Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10,
        count: days.length,
      };
    }

    // ── Accessories — read from `documentations` collection ──────────────
    // documentations[].accessories[].classification = VENDIDO | OBSEQUIADO | NO_APLICA
    // Filter: only documentations whose vehicleId belongs to an allowed,
    // delivered vehicle (plus date range on documentation.createdAt)
    const accByKey: Record<
      string,
      { VENDIDO: number; OBSEQUIADO: number; NO_APLICA: number }
    > = {};
    for (const item of accessoriesCatalog) {
      const key = this.normalizeAccessoryKey(item?.['key'] ?? item?.['name'] ?? item?.['id']);
      if (!accByKey[key]) {
        accByKey[key] = { VENDIDO: 0, OBSEQUIADO: 0, NO_APLICA: 0 };
      }
    }
    const deliveredVehicleIds = new Set(
      vehicles
        .filter((v) => v['status'] === 'ENTREGADO')
        .map((v) => v.id as string),
    );

    for (const doc of allDocs) {
      const vid = doc['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      if (!deliveredVehicleIds.has(vid)) continue;
      // REQ-DATE-01: apply date range filter on doc.createdAt (fail-open: if null → include)
      const docCreatedAt = this.toDate(doc['createdAt']);
      if (docCreatedAt !== null) {
        if (dateFromTs && docCreatedAt < dateFromTs) continue;
        if (dateToTs && docCreatedAt > dateToTs) continue;
      }
      const accs: any[] = doc['accessories'] ?? [];
      for (const acc of accs) {
        const key = this.normalizeAccessoryKey(acc['key']);
        const classification = this.normalizeAccessoryClassification(acc['classification']);
        if (!accByKey[key])
          accByKey[key] = { VENDIDO: 0, OBSEQUIADO: 0, NO_APLICA: 0 };
        if (classification === 'VENDIDO') accByKey[key].VENDIDO++;
        else if (classification === 'OBSEQUIADO') accByKey[key].OBSEQUIADO++;
        else accByKey[key].NO_APLICA++;
      }
    }
    const topSold = Object.entries(accByKey)
      .map(([key, vals]) => ({ key, vendido: vals.VENDIDO }))
      .sort((a, b) => b.vendido - a.vendido)
      .slice(0, 5);
    const totalVendido = Object.values(accByKey).reduce(
      (s, x) => s + x.VENDIDO,
      0,
    );
    const totalObsequiado = Object.values(accByKey).reduce(
      (s, x) => s + x.OBSEQUIADO,
      0,
    );
    const totalNoAplica = Object.values(accByKey).reduce(
      (s, x) => s + x.NO_APLICA,
      0,
    );

    // ── Top Asesores (órdenes) — from `service-orders`, field createdBy ──
    // Filter orders by: vehicleId in allowedVehicleIds + createdAt in date range
    const asesorOrdenesMap: Record<
      string,
      { name: string; sede: string; ordenes: number }
    > = {};
    for (const order of allOrders) {
      const vid = order['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      const createdAt = this.toDate(order['createdAt']);
      if (dateFromTs && createdAt && createdAt < dateFromTs) continue;
      if (dateToTs && createdAt && createdAt > dateToTs) continue;
      const uid = order['createdBy'] as string | undefined;
      if (!uid) continue;
      const name = (order['createdByName'] as string | undefined) ?? uid;
      const sede =
        vehicleSedeMap[vid] ?? (order['sede'] as string | undefined) ?? '';
      if (!asesorOrdenesMap[uid])
        asesorOrdenesMap[uid] = { name, sede, ordenes: 0 };
      asesorOrdenesMap[uid].ordenes++;
    }
    const topOrdenesGeneradas = Object.entries(asesorOrdenesMap)
      .map(([uid, val]) => ({ uid, ...val }))
      .sort((a, b) => b.ordenes - a.ordenes)
      .slice(0, 10);

    // ── Top Asesores (entregas) — from `deliveryCeremonies`, field deliveredBy ──
    // Filter ceremonies by: vehicleId in allowedVehicleIds + createdAt in date range
    const asesorEntregasMap: Record<
      string,
      { name: string; sede: string; entregas: number }
    > = {};
    for (const ceremony of allCeremonies) {
      const vid = ceremony['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      const createdAt = this.toDate(ceremony['createdAt']);
      if (dateFromTs && createdAt && createdAt < dateFromTs) continue;
      if (dateToTs && createdAt && createdAt > dateToTs) continue;
      const uid = ceremony['deliveredBy'] as string | undefined;
      if (!uid) continue;
      const name = (ceremony['deliveredByName'] as string | undefined) ?? uid;
      const sede = vehicleSedeMap[vid] ?? '';
      if (!asesorEntregasMap[uid])
        asesorEntregasMap[uid] = { name, sede, entregas: 0 };
      asesorEntregasMap[uid].entregas++;
    }
    const topEntregas = Object.entries(asesorEntregasMap)
      .map(([uid, val]) => ({ uid, ...val }))
      .sort((a, b) => b.entregas - a.entregas)
      .slice(0, 10);

    // ── Top Taller (OTs) — from `service-orders`, field assignedTechnicianId ──
    // Filter: vehicleId in allowedVehicleIds + assignedAt in date range + has technician
    const tallerMap: Record<
      string,
      { name: string; sede: string; totalOTs: number }
    > = {};
    for (const order of allOrders) {
      const vid = order['vehicleId'] as string | undefined;
      if (!vid || !allowedVehicleIds.has(vid)) continue;
      const uid = order['assignedTechnicianId'] as string | undefined;
      if (!uid) continue;
      const assignedAt = this.toDate(
        order['assignedAt'] ?? order['updatedAt'] ?? order['createdAt'],
      );
      if (dateFromTs && assignedAt && assignedAt < dateFromTs) continue;
      if (dateToTs && assignedAt && assignedAt > dateToTs) continue;
      const name =
        (order['assignedTechnicianName'] as string | undefined) ?? uid;
      const sede =
        vehicleSedeMap[vid] ?? (order['sede'] as string | undefined) ?? '';
      if (!tallerMap[uid]) tallerMap[uid] = { name, sede, totalOTs: 0 };
      tallerMap[uid].totalOTs++;
    }
    const topTaller = Object.entries(tallerMap)
      .map(([uid, val]) => ({ uid, ...val }))
      .sort((a, b) => b.totalOTs - a.totalOTs)
      .slice(0, 10);

    // Delivery trend series by explicit groupBy requested by frontend.
    const now = new Date();
    const monthlyMap: Record<string, number> = {};
    const effectiveFrom =
      dateFromTs ?? new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const effectiveTo = dateToTs ?? now;

    if (groupBy === 'day') {
      const cur = new Date(effectiveFrom);
      cur.setHours(0, 0, 0, 0);
      while (cur <= effectiveTo) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        monthlyMap[key] = 0;
        cur.setDate(cur.getDate() + 1);
      }
    } else if (groupBy === 'week') {
      const cur = new Date(effectiveFrom);
      cur.setHours(0, 0, 0, 0);
      while (cur <= effectiveTo) {
        const weekStart = new Date(cur);
        const day = weekStart.getDay();
        const offsetToMonday = (day + 6) % 7;
        weekStart.setDate(weekStart.getDate() - offsetToMonday);
        const iso = this.getISOWeekParts(weekStart);
        const key = `${iso.year}-W${String(iso.week).padStart(2, '0')}`;
        monthlyMap[key] = 0;
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      const cur = new Date(
        effectiveFrom.getFullYear(),
        effectiveFrom.getMonth(),
        1,
      );
      while (cur <= effectiveTo) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap[key] = 0;
        cur.setMonth(cur.getMonth() + 1);
      }
    }

    for (const v of filteredDeliveries) {
      const del = this.toDate(v['deliveryDate']);
      if (!del) continue;
      let key: string;
      if (groupBy === 'day') {
        key = `${del.getFullYear()}-${String(del.getMonth() + 1).padStart(2, '0')}-${String(del.getDate()).padStart(2, '0')}`;
      } else if (groupBy === 'week') {
        const iso = this.getISOWeekParts(del);
        key = `${iso.year}-W${String(iso.week).padStart(2, '0')}`;
      } else {
        key = `${del.getFullYear()}-${String(del.getMonth() + 1).padStart(2, '0')}`;
      }
      if (key in monthlyMap) monthlyMap[key] = (monthlyMap[key] ?? 0) + 1;
    }
    const byMonthlyDeliveries = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    // REQ-DATE-02: count vehicles whose createdAt falls within the selected range
    // fail-closed: if createdAt is null → do NOT count as "ingressed in period"
    const vehiclesCreatedInPeriod = vehicles.filter((v) => {
      const ca = this.toDate(v['createdAt']);
      if (!ca) return false;
      if (dateFromTs && ca < dateFromTs) return false;
      if (dateToTs && ca > dateToTs) return false;
      return true;
    }).length;

    const registrationBacklog = this.buildRegistrationBacklog(filtered);

    const otif = this.computeOtif(
      filteredDeliveries,
      allAppointments.filter((apt) => {
        const vid = apt?.['vehicleId'];
        return typeof vid === 'string' && allowedVehicleIds.has(vid);
      }),
      allDocs,
      allOrders,
    );

    return {
      total: filtered.length,
      vehiclesDelivered: filteredDeliveries.length,
      vehiclesCreatedInPeriod,
      registrationBacklog,
      byStatus,
      bySede,
      byModel,
      byColor,
      avgDaysToDelivery,
      medianDaysToDelivery,
      byModelRotation,
      byMonthlyDeliveries,
      deliverySeriesGranularity: groupBy,
      accessories: {
        byKey: accByKey,
        topSold,
        totalVendido,
        totalObsequiado,
        totalNoAplica,
      },
      topAsesores: {
        ordenesGeneradas: topOrdenesGeneradas,
        entregas: topEntregas,
      },
      topTaller,
      otif,
      filtersApplied,
    };
  }
  async generateVehicleReport(
    vehicleId: string,
    user: AuthenticatedUser,
  ): Promise<Buffer> {
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
    const snap = await this.db
      .collection('vehicles')
      .where('assignedTechnicianUid', '==', uid)
      .get();
    const vehicles = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
    const completed = vehicles.filter((v) => v.status === 'ENTREGADO').length;
    return {
      uid,
      totalAssigned: vehicles.length,
      totalCompleted: completed,
      completionRate: vehicles.length
        ? Math.round((completed / vehicles.length) * 100)
        : 0,
    };
  }
}
