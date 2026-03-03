import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';

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

  /**
   * Convierte un nombre en un ID slug determinista — igual que en SeedService.
   * Garantiza que el mismo nombre siempre produce el mismo ID.
   */
  private toSlugId(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private async create(collection: string, data: Record<string, unknown>) {
    // Normalizar a MAYUSCULAS solo campos de display (name). Los campos código (key, code) se conservan tal cual.
    const CODE_FIELDS = new Set(['key', 'code']);
    const normalized = Object.fromEntries(
      Object.entries(data).map(([k, v]) =>
        [k, typeof v === 'string' ? (CODE_FIELDS.has(k) ? v.trim() : v.toUpperCase().trim()) : v],
      ),
    );

    // ID determinista basado en el nombre (igual que seed → sin duplicados)
    const id = this.toSlugId(normalized['name'] as string);

    const ref  = this.db.collection('catalogs').doc(collection).collection('items').doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      throw new ConflictException(
        `Ya existe un ítem con el nombre "${normalized['name']}" en el catálogo '${collection}'. ID: ${id}`,
      );
    }

    const itemData = { id, ...normalized, createdAt: this.firebase.serverTimestamp() };
    await ref.set(itemData);
    return itemData;
  }

  private async update(collection: string, id: string, data: Record<string, unknown>) {
    const ref = this.db.collection('catalogs').doc(collection).collection('items').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`${collection}/${id} no encontrado`);
    // Normalizar a MAYUSCULAS solo campos de display (name). Los campos código (key, code) se conservan tal cual.
    const CODE_FIELDS = new Set(['key', 'code']);
    const normalized = Object.fromEntries(
      Object.entries(data).map(([k, v]) =>
        [k, typeof v === 'string' ? (CODE_FIELDS.has(k) ? v.trim() : v.toUpperCase().trim()) : v],
      ),
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
  updateColor(id: string, name: string) { return this.update('colors', id, { name }); }
  deleteColor(id: string) { return this.remove('colors', id); }

  // ── MODELOS ───────────────────────────────────────────────────────
  getModels() { return this.getAll('models'); }
  createModel(name: string) { return this.create('models', { name }); }
  updateModel(id: string, name: string) { return this.update('models', id, { name }); }
  deleteModel(id: string) { return this.remove('models', id); }

  // ── CONCESIONARIOS ────────────────────────────────────────────────
  getConcessionaires() { return this.getAll('concessionaires'); }
  createConcessionaire(name: string) { return this.create('concessionaires', { name }); }
  updateConcessionaire(id: string, name: string) { return this.update('concessionaires', id, { name }); }
  deleteConcessionaire(id: string) { return this.remove('concessionaires', id); }

  // ── SEDES ─────────────────────────────────────────────────────────
  getSedes() { return this.getAll('sedes'); }
  createSede(name: string, code: string) { return this.create('sedes', { name, code }); }
  updateSede(id: string, name: string, code: string) { return this.update('sedes', id, { name, code }); }
  deleteSede(id: string) { return this.remove('sedes', id); }

  // ── ACCESORIOS ────────────────────────────────────────────────────
  getAccessories() { return this.getAll('accessories'); }
  createAccessory(name: string, key: string) { return this.create('accessories', { name, key }); }
  updateAccessory(id: string, name: string) { return this.update('accessories', id, { name }); }
  deleteAccessory(id: string) { return this.remove('accessories', id); }
}
