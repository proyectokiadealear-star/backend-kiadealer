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
    const snapshot = await this.db.collection('vehicles').get();
    const all = snapshot.docs.map((d) => d.data());

    const filtered = all.filter((v) => {
      if (user.role !== RoleEnum.JEFE_TALLER && v['sede'] !== user.sede) return false;
      if (filters?.sede && v['sede'] !== filters.sede) return false;
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

    return {
      total: filtered.length,
      byStatus,
      bySede,
      byModel,
      vehiclesDelivered: byStatus['Entregado'] ?? 0,
    };
  }

  async getTechnicianPerformance(uid: string) {
    const ordersSnap = await this.db
      .collection('serviceOrders')
      .where('assignedTechnicianId', '==', uid)
      .get();

    const orders = ordersSnap.docs.map((d) => d.data());
    const total = orders.length;
    const completed = orders.filter((o) => o['status'] === 'INSTALACION_COMPLETA' || o['status'] === 'LISTO_ENTREGA').length;
    const pending = total - completed;

    return { technicianId: uid, totalAssigned: total, completed, pending };
  }
}
