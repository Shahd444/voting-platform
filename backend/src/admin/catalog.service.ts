import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../common/http-error';
import { AuditService } from '../core/audit.service';
import { BusService } from '../redis/bus.service';
import { CategoryDto, ExhibitorFormDto } from './admin.dto';

const ALLOWED_IMG: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

export interface UploadedImage { mimetype: string; buffer: Buffer; size: number }

/** Exhibitors, categories and their photos (F9). */
@Injectable()
export class CatalogService {
  constructor(private readonly ds: DataSource, private readonly audit: AuditService, private readonly bus: BusService) {}

  private async changed() {
    await this.bus.cacheDel('ballot');
    await this.bus.publish('results-changed', {});
  }

  private transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.ds.transaction(async manager => {
      // Same lock order as reset and voting: checks and cascades cannot race a new vote.
      await manager.query('LOCK TABLE votes IN SHARE ROW EXCLUSIVE MODE');
      return work(manager);
    });
  }

  // ------------------------------------------------------------------ categories
  /** Categories are always listed in the order they were created. */
  listCategories() {
    return this.ds.query(`
      SELECT c.*, COUNT(ec.exhibitor_id)::int AS exhibitor_count
        FROM categories c LEFT JOIN exhibitor_categories ec ON ec.category_id = c.id
       GROUP BY c.id ORDER BY c.id`);
  }

  private categoryInput(b: CategoryDto) {
    const name = String(b.name || '').trim();
    if (!name || name.length > 80) throw new AppError(400, 'bad_name', 'Category name is required (max 80 chars).');
    const slug = String(b.slug || name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `cat-${Date.now()}`;
    return { name, slug, description: String(b.description || '').trim(), is_active: b.is_active !== false };
  }

  async createCategory(actor: string, ip: string, b: CategoryDto) {
    const c = this.categoryInput(b);
    try {
      const category = await this.transaction(async m => {
        const rows = await m.query(
          'INSERT INTO categories (slug, name, description, is_active) VALUES ($1,$2,$3,$4) RETURNING *',
          [c.slug, c.name, c.description, c.is_active]);
        await this.audit.record(actor, 'category_created', { id: rows[0].id, name: c.name }, ip, m);
        return rows[0];
      });
      await this.changed();
      return { category };
    } catch (e: any) {
      if (e.code === '23505') throw new AppError(409, 'exists', 'A category with that name already exists.');
      throw e;
    }
  }

  async updateCategory(actor: string, ip: string, id: number, b: CategoryDto) {
    const c = this.categoryInput(b);
    const category = await this.transaction(async m => {
      const result = await m.query(
        'UPDATE categories SET slug=$2, name=$3, description=$4, is_active=$5 WHERE id=$1 RETURNING *',
        [id, c.slug, c.name, c.description, c.is_active]).catch((e) => {
          if (e.code === '23505') throw new AppError(409, 'exists', 'A category with that name already exists.');
          throw e;
        });
      const rows = result[0]; // PostgreSQL UPDATE returns [returned rows, affected count].
      if (!rows[0]) throw new AppError(404, 'not_found', 'Category not found.');
      await this.audit.record(actor, 'category_updated', { id }, ip, m);
      return rows[0];
    });
    await this.changed();
    return { category };
  }

  async deleteCategory(actor: string, ip: string, id: number, force: boolean) {
    await this.transaction(async m => {
      const n = (await m.query('SELECT COUNT(*)::int AS n FROM votes WHERE category_id = $1', [id]))[0].n;
      if (n > 0 && !force) throw new AppError(409, 'has_votes', `This category already has ${n} votes. Deactivate it instead, or reset results first.`);
      if (!force) {
        const stranded = await m.query(`SELECT e.id FROM exhibitors e
        JOIN exhibitor_categories ec ON ec.exhibitor_id = e.id
        WHERE e.is_active AND ec.category_id = $1 AND NOT EXISTS
          (SELECT 1 FROM exhibitor_categories other WHERE other.exhibitor_id = e.id AND other.category_id <> $1)`, [id]);
        if (stranded.length) throw new AppError(409, 'category_in_use', 'This is the only category for an active exhibitor. Reassign or hide the exhibitor first.');
      }
      await m.query('DELETE FROM categories WHERE id = $1', [id]);
      await this.audit.record(actor, 'category_deleted', { id, discarded_votes: n }, ip, m);
    });
    await this.changed();
    return { ok: true };
  }

  // ------------------------------------------------------------------ exhibitors
  async listExhibitors() {
    const rows = await this.ds.query(`
      SELECT e.*, COALESCE(array_agg(ec.category_id) FILTER (WHERE ec.category_id IS NOT NULL), '{}') AS category_ids,
             (SELECT COUNT(*)::int FROM votes v WHERE v.exhibitor_id = e.id) AS votes
        FROM exhibitors e LEFT JOIN exhibitor_categories ec ON ec.exhibitor_id = e.id
       GROUP BY e.id ORDER BY e.name`);
    return rows.map((e: any) => ({ ...e, image: e.image_id ? `/img/${e.image_id}` : null }));
  }

  private exhibitorInput(b: ExhibitorFormDto) {
    const name = String(b.name || '').trim();
    if (!name || name.length > 100) throw new AppError(400, 'bad_name', 'Exhibitor name is required (max 100 chars).');
    let cats: unknown = b.category_ids;
    if (typeof cats === "string") { const raw = cats; try { cats = JSON.parse(raw); } catch { cats = raw.split(","); } }
    if (cats !== undefined && !Array.isArray(cats)) throw new AppError(400, 'bad_categories', 'Categories must be a list of valid category IDs.');
    const rawIds = Array.isArray(cats) ? cats : [];
    if (rawIds.some((id) => (typeof id !== 'number' && typeof id !== 'string') ||
      String(id).trim() === '' || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || Number(id) > 2147483647)) {
      throw new AppError(400, 'bad_categories', 'Categories must contain positive integer IDs.');
    }
    const categoryIds = [...new Set(rawIds.map(Number))];
    const description = String(b.description || '').trim();
    const is_active = b.is_active !== 'false';
    if (description.length > 400 || (is_active && !description)) throw new AppError(400, 'bad_description', 'Active exhibitors need a description (max 400 chars).');
    if (is_active && !categoryIds.length) throw new AppError(400, 'bad_categories', 'Active exhibitors need at least one category.');
    return {
      name,
      project: String(b.project || '').trim(),
      description,
      booth: String(b.booth || '').trim(),
      is_active,
      categoryIds,
    };
  }

  private async saveImage(m: EntityManager, file?: UploadedImage): Promise<string | null> {
    if (!file) return null;
    const magic = ALLOWED_IMG[file.mimetype];
    // Validate by magic bytes, not just the client-supplied MIME type
    if (!magic || !magic.every((b, i) => file.buffer[i] === b)) throw new AppError(400, 'bad_image', 'Photo must be a JPEG, PNG or WebP image.');
    const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const rows = await m.query('INSERT INTO images (mime_type, bytes, sha256) VALUES ($1,$2,$3) RETURNING id', [file.mimetype, file.buffer, sha]);
    return rows[0].id;
  }

  /** Removing an exhibitor from a category would cascade-delete its votes there — refuse unless forced. */
  private async setCategories(m: EntityManager, exhibitorId: number, ids: number[], force: boolean) {
    if (ids.length) {
      const found = await m.query('SELECT id FROM categories WHERE id = ANY($1::int[])', [ids]);
      if (found.length !== ids.length) throw new AppError(400, 'bad_categories', 'One or more selected categories do not exist.');
    }
    const withVotes = await m.query(
      `SELECT c.name, COUNT(*)::int AS n FROM votes v JOIN categories c ON c.id = v.category_id
        WHERE v.exhibitor_id = $1 AND NOT (v.category_id = ANY($2::int[])) GROUP BY c.name`, [exhibitorId, ids]);
    if (withVotes.length && !force) {
      throw new AppError(409, 'has_votes', `Removing this exhibitor from ${withVotes.map((r: any) => `"${r.name}" (${r.n} votes)`).join(', ')} would discard those votes.`);
    }
    await m.query('DELETE FROM exhibitor_categories WHERE exhibitor_id = $1 AND NOT (category_id = ANY($2::int[]))', [exhibitorId, ids]);
    if (ids.length) {
      await m.query(
        `INSERT INTO exhibitor_categories (exhibitor_id, category_id)
         SELECT $1, c.id FROM categories c WHERE c.id = ANY($2::int[]) ON CONFLICT (exhibitor_id, category_id) DO NOTHING`, [exhibitorId, ids]);
    }
  }

  async createExhibitor(actor: string, ip: string, b: ExhibitorFormDto, file?: UploadedImage) {
    const e = this.exhibitorInput(b);
    const row = await this.transaction(async (m) => {
      const imageId = await this.saveImage(m, file);
      if (e.is_active && !imageId) throw new AppError(400, 'photo_required', 'Active exhibitors need a photo.');
      const rows = await m.query(
        'INSERT INTO exhibitors (name, project, description, booth, image_id, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [e.name, e.project, e.description, e.booth, imageId, e.is_active]);
      await this.setCategories(m, rows[0].id, e.categoryIds, false);
      await this.audit.record(actor, 'exhibitor_created', { id: rows[0].id, name: e.name }, ip, m);
      return rows[0];
    }).catch((error) => this.exhibitorConflict(error));
    await this.changed();
    return { exhibitor: row };
  }

  async updateExhibitor(actor: string, ip: string, id: number, b: ExhibitorFormDto, file: UploadedImage | undefined, force: boolean) {
    const e = this.exhibitorInput(b);
    const row = await this.transaction(async (m) => {
      const imageId = await this.saveImage(m, file);
      const result = await m.query(
        `UPDATE exhibitors SET name=$2, project=$3, description=$4, booth=$5, is_active=$6, updated_at=now(),
                image_id = CASE WHEN $7::uuid IS NOT NULL THEN $7::uuid WHEN $8 THEN NULL ELSE image_id END
          WHERE id=$1 RETURNING *`,
        [id, e.name, e.project, e.description, e.booth, e.is_active, imageId, b.remove_photo === 'true']);
      const rows = result[0]; // PostgreSQL UPDATE returns [returned rows, affected count].
      if (!rows[0]) throw new AppError(404, 'not_found', 'Exhibitor not found.');
      if (e.is_active && !rows[0].image_id) throw new AppError(400, 'photo_required', 'Active exhibitors need a photo.');
      await this.setCategories(m, id, e.categoryIds, force);
      await m.query('DELETE FROM images i WHERE NOT EXISTS (SELECT 1 FROM exhibitors x WHERE x.image_id = i.id)');
      await this.audit.record(actor, 'exhibitor_updated', { id }, ip, m);
      return rows[0];
    }).catch((error) => this.exhibitorConflict(error));
    await this.changed();
    return { exhibitor: row };
  }

  private exhibitorConflict(error: any): never {
    if (error.code === '23505' && error.constraint === 'unique_exhibitor_identity_per_category') {
      throw new AppError(409, 'duplicate_category_assignment', 'This maker/team and project are already assigned to a selected category. Edit the existing exhibitor to assign more categories.');
    }
    throw error;
  }

  async deleteExhibitor(actor: string, ip: string, id: number, force: boolean) {
    await this.transaction(async m => {
      const n = (await m.query('SELECT COUNT(*)::int AS n FROM votes WHERE exhibitor_id = $1', [id]))[0].n;
      if (n > 0 && !force) {
        throw new AppError(409, 'has_votes', `This exhibitor already has ${n} votes. Hide it instead (untick "Visible"), or delete anyway to discard those votes.`);
      }
      await m.query('DELETE FROM exhibitors WHERE id = $1', [id]);
      await m.query('DELETE FROM images i WHERE NOT EXISTS (SELECT 1 FROM exhibitors x WHERE x.image_id = i.id)');
      await this.audit.record(actor, 'exhibitor_deleted', { id, discarded_votes: n }, ip, m);
    });
    await this.changed();
    return { ok: true };
  }
}
