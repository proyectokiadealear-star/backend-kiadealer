import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CatalogsService {
  private readonly logger = new Logger(CatalogsService.name);

  constructor(private readonly firebase: FirebaseService) {}

  private get db() { return this.firebase.firestore(); }

  // ── GENÉRICO ──────────────────────────────────────────────────────
  private async getAll(collection: string) {
    const snapshot = await this.db.collection('catalogs').doc(collection).collection('items').orderBy('name', 'asc').get();
    return snapshot.docs.map((d) => d.data());
  }

  private async create(collection: string, data: Record<string, unknown>) {
    // Normalize all string values to UPPERCASE before persisting
    const normalized = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v.toUpperCase().trim() : v]),
    );
    const id = uuidv4();
    const itemData = { id, ...normalized, createdAt: this.firebase.serverTimestamp() };
    await this.db.collection('catalogs').doc(collection).collection('items').doc(id).set(itemData);
    return itemData;
  }

  private async update(collection: string, id: string, data: Record<string, unknown>) {
    const ref = this.db.collection('catalogs').doc(collection).collection('items').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`${collection}/${id} no encontrado`);
    // Normalize all string values to UPPERCASE before persisting
    const normalized = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v.toUpperCase().trim() : v]),
    );
    await ref.update({ ...normalized, updatedAt: this.firebase.serverTimestamp() });
    return { id, updated: true };
  }

  private async remove(collection: string, id: string) {
    await this.db.collection('catalogs').doc(collection).collection('items').doc(id).delete();
    return { id, deleted: true };
  }

  // ── COLORES ───────────────────────────────────────────────────────
  getColors() { return this.getAll('colors'); }
  createColor(name: string) { return this.create('colors', { name }); }
  deleteColor(id: string) { return this.remove('colors', id); }

  // ── MODELOS ───────────────────────────────────────────────────────
  getModels() { return this.getAll('models'); }
  createModel(name: string) { return this.create('models', { name }); }
  deleteModel(id: string) { return this.remove('models', id); }

  // ── CONCESIONARIOS ────────────────────────────────────────────────
  getConcessionaires() { return this.getAll('concessionaires'); }
  createConcessionaire(name: string) { return this.create('concessionaires', { name }); }
  updateConcessionaire(id: string, name: string) { return this.update('concessionaires', id, { name }); }
  deleteConcessionaire(id: string) { return this.remove('concessionaires', id); }

  // ── SEDES ─────────────────────────────────────────────────────────
  getSedes() { return this.getAll('sedes'); }
  createSede(name: string, code: string) { return this.create('sedes', { name, code }); }

  // ── ACCESORIOS ────────────────────────────────────────────────────
  getAccessories() { return this.getAll('accessories'); }
  createAccessory(name: string, key: string) { return this.create('accessories', { name, key }); }
  updateAccessory(id: string, name: string) { return this.update('accessories', id, { name }); }
  deleteAccessory(id: string) { return this.remove('accessories', id); }
}
