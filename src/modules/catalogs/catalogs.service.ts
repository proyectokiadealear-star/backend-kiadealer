import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CATALOG_REPOSITORY_TOKENS,
  CatalogItem,
  CatalogItemsRepository,
} from './catalogs.repository';

/** Campos código: se conservan tal cual. Todo lo demás (display) va en MAYUSCULAS. */
const CODE_FIELDS = new Set(['key', 'code']);

/**
 * Normaliza a MAYUSCULAS los campos de display, dejando los campos código
 * (key, code) sin tocar. Es lógica de negocio pura, sin relación con el
 * scope de tenant, por eso vive acá y no en el repositorio.
 */
function normalize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      typeof v === 'string'
        ? CODE_FIELDS.has(k)
          ? v.trim()
          : v.toUpperCase().trim()
        : v,
    ]),
  );
}

@Injectable()
export class CatalogsService {
  constructor(
    @Inject(CATALOG_REPOSITORY_TOKENS.colors)
    private readonly colors: CatalogItemsRepository,
    @Inject(CATALOG_REPOSITORY_TOKENS.models)
    private readonly models: CatalogItemsRepository,
    @Inject(CATALOG_REPOSITORY_TOKENS.concessionaires)
    private readonly concessionaires: CatalogItemsRepository,
    @Inject(CATALOG_REPOSITORY_TOKENS.sedes)
    private readonly sedes: CatalogItemsRepository,
    @Inject(CATALOG_REPOSITORY_TOKENS.accessories)
    private readonly accessories: CatalogItemsRepository,
  ) {}

  // ── GENÉRICO ──────────────────────────────────────────────────────
  private getAll(repo: CatalogItemsRepository): Promise<CatalogItem[]> {
    return repo.findAllSorted();
  }

  private create(
    repo: CatalogItemsRepository,
    data: Record<string, unknown>,
  ): Promise<CatalogItem> {
    return repo.createItem(
      normalize(data) as Omit<CatalogItem, 'tenantId' | 'id' | 'createdAt'>,
    );
  }

  /**
   * Lanza NotFoundException si el ítem no existe o pertenece a otro
   * concesionario — el repositorio ya traduce ambos casos a `null` (ver
   * TenantScopedRepository.findById, D-104); acá solo se traduce a 404.
   */
  private async update(
    repo: CatalogItemsRepository,
    label: string,
    id: string,
    data: Record<string, unknown>,
  ) {
    const updated = await repo.updateItem(id, normalize(data));
    if (!updated) throw new NotFoundException(`${label}/${id} no encontrado`);
    return { id, updated: true };
  }

  /**
   * Igual que `update`: un delete sobre un ítem ajeno o inexistente ahora
   * responde 404 en vez del 200 silencioso que tenía el servicio original.
   * Es un cambio de comportamiento deliberado — lo exige el contrato de
   * aislamiento entre concesionarios (un tenant no puede ni confirmar que un
   * id existe en otro tenant, ni borrar algo que no es suyo sin que quede
   * marcado como error).
   */
  private async remove(
    repo: CatalogItemsRepository,
    label: string,
    id: string,
  ) {
    const deleted = await repo.delete(id);
    if (!deleted) throw new NotFoundException(`${label}/${id} no encontrado`);
    return { id, deleted: true };
  }

  // ── COLORES ───────────────────────────────────────────────────────
  getColors() {
    return this.getAll(this.colors);
  }
  createColor(name: string) {
    return this.create(this.colors, { name });
  }
  updateColor(id: string, name: string) {
    return this.update(this.colors, 'colors', id, { name });
  }
  deleteColor(id: string) {
    return this.remove(this.colors, 'colors', id);
  }

  // ── MODELOS ───────────────────────────────────────────────────────
  getModels() {
    return this.getAll(this.models);
  }
  createModel(name: string) {
    return this.create(this.models, { name });
  }
  updateModel(id: string, name: string) {
    return this.update(this.models, 'models', id, { name });
  }
  deleteModel(id: string) {
    return this.remove(this.models, 'models', id);
  }

  // ── CONCESIONARIOS ────────────────────────────────────────────────
  getConcessionaires() {
    return this.getAll(this.concessionaires);
  }
  createConcessionaire(name: string) {
    return this.create(this.concessionaires, { name });
  }
  updateConcessionaire(id: string, name: string) {
    return this.update(this.concessionaires, 'concessionaires', id, { name });
  }
  deleteConcessionaire(id: string) {
    return this.remove(this.concessionaires, 'concessionaires', id);
  }

  // ── SEDES ─────────────────────────────────────────────────────────
  getSedes() {
    return this.getAll(this.sedes);
  }
  createSede(name: string, code: string) {
    return this.create(this.sedes, { name, code });
  }
  updateSede(id: string, name: string, code: string) {
    return this.update(this.sedes, 'sedes', id, { name, code });
  }
  deleteSede(id: string) {
    return this.remove(this.sedes, 'sedes', id);
  }

  // ── ACCESORIOS ────────────────────────────────────────────────────
  getAccessories() {
    return this.getAll(this.accessories);
  }
  createAccessory(name: string, key: string) {
    return this.create(this.accessories, { name, key });
  }
  updateAccessory(id: string, name: string) {
    return this.update(this.accessories, 'accessories', id, { name });
  }
  deleteAccessory(id: string) {
    return this.remove(this.accessories, 'accessories', id);
  }
}
