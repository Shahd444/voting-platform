import { Entity, PrimaryColumn } from 'typeorm';

/** Many-to-many: an exhibitor can compete in one or more categories (spec §3.4). */
@Entity('exhibitor_categories')
export class ExhibitorCategory {
  @PrimaryColumn({ name: 'exhibitor_id' }) exhibitorId: number;
  @PrimaryColumn({ name: 'category_id' }) categoryId: number;
}
