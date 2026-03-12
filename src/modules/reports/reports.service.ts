import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RoleEnum } from '../../common/enums/role.enum';
import PDFDocument = require('pdfkit');

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly vehiclesService: VehiclesService,
  ) {}

  private get db() { return this.firebase.firestore(); }

  async generateVehicleReport(vehicleId: string, user: AuthenticatedUser): Promise<Buffer> {
    const vehicle = await this.vehiclesService.assertExists(vehicleId);
    const statusHistory = await this.vehiclesService.getStatusHistory(vehicleId);

    const [certSnap, docSnap] = await Promise.all([
      this.db.collection('certifications').doc(vehicleId).get(),
      this.db.collection('documentations').doc(vehicleId).get(),
    ]);

    const cert = certSnap.exists ? certSnap.data() : null;
    const doc = docSnap.exists ? docSnap.data() : null;

    return new Promise((resolve, reject) => {
      const pdfDoc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);

      // ── ENCABEZADO ───────────────────────────────────────────
      pdfDoc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('KIA DEALER MANAGEMENT SYSTEM', { align: 'center' });
      pdfDoc.fontSize(14).text('Reporte de Trazabilidad del Vehículo', { align: 'center' });
      pdfDoc.moveDown();
      pdfDoc.fontSize(10).text(`Generado el: ${new Date().toLocaleString('es-EC')}`, { align: 'right' });
      pdfDoc.moveTo(50, pdfDoc.y).lineTo(545, pdfDoc.y).stroke();
      pdfDoc.moveDown();

      // ── DATOS DEL VEHÍCULO ────────────────────────────────────
      pdfDoc.fontSize(12).font('Helvetica-Bold').text('Datos del Vehículo');
      pdfDoc.font('Helvetica').fontSize(10);
      pdfDoc.text(`Chasis: ${vehicle['chassis']}`);
      pdfDoc.text(`Modelo: ${vehicle['model']} ${vehicle['year']}`);
      pdfDoc.text(`Color: ${vehicle['color']}`);
      pdfDoc.text(`Sede: ${vehicle['sede']}`);
      pdfDoc.text(`Concesionario de origen: ${vehicle['originConcessionaire']}`);
      pdfDoc.text(`Estado actual: ${vehicle['status']}`);
      pdfDoc.moveDown();

      // ── CLIENTE ───────────────────────────────────────────────
      if (doc) {
        pdfDoc.fontSize(12).font('Helvetica-Bold').text('Datos del Cliente');
        pdfDoc.font('Helvetica').fontSize(10);
        pdfDoc.text(`Nombre: ${doc['clientName']}`);
        pdfDoc.text(`Cédula: ${doc['clientId']}`);
        pdfDoc.text(`Teléfono: ${doc['clientPhone']}`);
        pdfDoc.text(`Tipo de matrícula: ${doc['registrationType']}`);
        pdfDoc.moveDown();
      }

      // ── CERTIFICACIÓN ─────────────────────────────────────────
      if (cert) {
        pdfDoc.fontSize(12).font('Helvetica-Bold').text('Certificación');
        pdfDoc.font('Helvetica').fontSize(10);
        pdfDoc.text(`Radio: ${cert['radio']}`);
        pdfDoc.text(`Aros: ${cert['rims']?.status}`);
        pdfDoc.text(`Asientos: ${cert['seatType']}`);
        pdfDoc.text(`Antena: ${cert['antenna']}`);
        pdfDoc.text(`Cubre maletero: ${cert['trunkCover']}`);
        pdfDoc.text(`Kilometraje: ${cert['mileage']} km`);
        pdfDoc.text(`Improntas: ${cert['imprints']}`);
        pdfDoc.moveDown();
      }

      // ── HISTORIAL DE ESTADOS ──────────────────────────────────
      pdfDoc.fontSize(12).font('Helvetica-Bold').text('Historial de Estados');
      pdfDoc.font('Helvetica').fontSize(9);

      for (const entry of statusHistory) {
        const prev = entry['previousStatus'] ?? '—';
        const next = entry['newStatus'];
        const who = entry['changedByName'];
        const when = entry['changedAt']
          ? new Date(entry['changedAt']['_seconds'] * 1000).toLocaleString('es-EC')
          : '—';
        const notes = entry['notes'] ? ` (${entry['notes']})` : '';
        pdfDoc.text(`• ${prev} → ${next} | ${who} | ${when}${notes}`);
      }

      pdfDoc.end();
    });
  }

  async getAnalytics(
    user: AuthenticatedUser,
    filters?: { sede?: string; dateFrom?: string; dateTo?: string },
  ) {
    // Soporta DD/MM/YYYY y YYYY-MM-DD
    const parseDate = (raw?: string): Date | null => {
      if (!raw) return null;
      if (raw.includes('/')) {
        const [d, m, y] = raw.split('/');
        return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00.000Z`);
      }
      return new Date(`${raw}T00:00:00.000Z`);
    };

    const fromDate = parseDate(filters?.dateFrom);
    const toDate = filters?.dateTo
      ? new Date(`${parseDate(filters.dateTo)!.toISOString().slice(0, 10)}T23:59:59.999Z`)
      : null;

    // ── Construir query Firestore con filtros en servidor ────────────────
    let query: FirebaseFirestore.Query = this.db.collection('vehicles');

    // Filtro por sede: si no es JEFE_TALLER, forzar la sede del usuario;
    // si lo es pero se pasa filtro de sede, aplicarlo también.
    const sedeFilter = user.role !== RoleEnum.JEFE_TALLER
      ? user.sede
      : (filters?.sede ?? null);
    if (sedeFilter) {
      query = query.where('sede', '==', sedeFilter);
    }

    // Filtro por rango de fechas en Firestore cuando se usan los dos extremos
    if (fromDate && toDate) {
      query = query
        .where('receptionDate', '>=', fromDate)
        .where('receptionDate', '<=', toDate);
    } else if (fromDate) {
      query = query.where('receptionDate', '>=', fromDate);
    } else if (toDate) {
      query = query.where('receptionDate', '<=', toDate);
    }

    const snapshot = await query.get();
    const all = snapshot.docs.map((d) => d.data());

    // Filtro en memoria como salvaguarda (por si receptionDate es Timestamp vs string)
    const filtered = all.filter((v) => {
      if (filters?.sede && user.role === RoleEnum.JEFE_TALLER && v['sede'] !== filters.sede) return false;
      if (fromDate || toDate) {
        const rd = v['receptionDate'];
        if (!rd) return false;
        const vDate = rd._seconds ? new Date(rd._seconds * 1000) : new Date(rd);
        if (fromDate && vDate < fromDate) return false;
        if (toDate && vDate > toDate) return false;
      }
      return true;
    });

    const byStatus: Record<string, number> = {};
    const bySede: Record<string, number> = {};
    const byModel: Record<string, number> = {};

    for (const v of filtered) {
      byStatus[v['status']] = (byStatus[v['status']] ?? 0) + 1;
      bySede[v['sede']] = (bySede[v['sede']] ?? 0) + 1;
      byModel[v['model']] = (byModel[v['model']] ?? 0) + 1;
    }

    const vehicleIds = filtered.map((v) => v['id'] as string).filter(Boolean);

    // ── BLOQUE 1: accessories ──────────────────────────────────────────
    // Lectura directa por vehicleId en 'documentations' → sin índice compuesto
    const docSnaps = await Promise.all(
      vehicleIds.map((id) => this.db.collection('documentations').doc(id).get()),
    );

    const byKey: Record<string, Record<string, number>> = {};
    let totalVendido = 0;
    let totalObsequiado = 0;

    for (const snap of docSnaps) {
      if (!snap.exists) continue;
      const accessories: Array<{ key: string; classification: string }> =
        snap.data()!['accessories'] ?? [];
      for (const acc of accessories) {
        if (!byKey[acc.key]) byKey[acc.key] = { VENDIDO: 0, OBSEQUIADO: 0, NO_APLICA: 0 };
        byKey[acc.key][acc.classification] = (byKey[acc.key][acc.classification] ?? 0) + 1;
        if (acc.classification === 'VENDIDO') totalVendido++;
        if (acc.classification === 'OBSEQUIADO') totalObsequiado++;
      }
    }

    const topSold = Object.entries(byKey)
      .map(([key, counts]) => ({ key, vendido: counts['VENDIDO'] ?? 0 }))
      .sort((a, b) => b.vendido - a.vendido)
      .slice(0, 5);

    // ── BLOQUE 2: topAsesores ──────────────────────────────────────────
    // Cuenta documentedBy (órdenes generadas) y deliveredBy (entregas)
    const documentedByCount: Record<string, number> = {};
    const deliveredByCount: Record<string, number> = {};

    for (const v of filtered) {
      const docBy = v['documentedBy'] as string | undefined;
      const delBy = v['deliveredBy'] as string | undefined;
      if (docBy) documentedByCount[docBy] = (documentedByCount[docBy] ?? 0) + 1;
      if (delBy) deliveredByCount[delBy] = (deliveredByCount[delBy] ?? 0) + 1;
    }

    // Lectura directa por uid en 'users' → sin índice
    const allUids = [
      ...new Set([...Object.keys(documentedByCount), ...Object.keys(deliveredByCount)]),
    ];

    const userSnaps = await Promise.all(
      allUids.map((uid) => this.db.collection('users').doc(uid).get()),
    );

    const userMap: Record<string, { name: string; sede: string }> = {};
    for (const snap of userSnaps) {
      if (!snap.exists) continue;
      const d = snap.data()!;
      userMap[snap.id] = { name: d['displayName'] ?? snap.id, sede: d['sede'] ?? '' };
    }

    const ordenesGeneradas = Object.entries(documentedByCount)
      .map(([uid, ordenes]) => ({
        uid,
        name: userMap[uid]?.name ?? uid,
        sede: userMap[uid]?.sede ?? '',
        ordenes,
      }))
      .sort((a, b) => b.ordenes - a.ordenes)
      .slice(0, 5);

    const entregas = Object.entries(deliveredByCount)
      .map(([uid, count]) => ({
        uid,
        name: userMap[uid]?.name ?? uid,
        sede: userMap[uid]?.sede ?? '',
        entregas: count,
      }))
      .sort((a, b) => b.entregas - a.entregas)
      .slice(0, 5);

    return {
      total: filtered.length,
      byStatus,
      bySede,
      byModel,
      vehiclesDelivered: byStatus['ENTREGADO'] ?? byStatus['Entregado'] ?? 0,
      accessories: {
        byKey,
        topSold,
        totalVendido,
        totalObsequiado,
      },
      topAsesores: {
        ordenesGeneradas,
        entregas,
      },
    };
  }

  async getTechnicianPerformance(uid: string) {
    const ordersSnap = await this.db
      .collection('service-orders')
      .where('assignedTechnicianId', '==', uid)
      .get();

    const orders = ordersSnap.docs.map((d) => d.data());
    const total = orders.length;
    const completed = orders.filter((o) => o['status'] === 'INSTALACION_COMPLETA' || o['status'] === 'LISTO_ENTREGA').length;
    const pending = total - completed;

    return { technicianId: uid, totalAssigned: total, completed, pending };
  }
}
