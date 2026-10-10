import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** UNIQUE(visitor_id, category_id) is the core anti-duplicate rule (F12), enforced by PostgreSQL. */
@Entity('votes')
@Unique('one_vote_per_category', ['visitorId', 'categoryId'])
export class Vote {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'visitor_id', type: 'uuid' }) visitorId: string;
  @Column({ name: 'category_id' }) categoryId: number;
  @Column({ name: 'exhibitor_id' }) exhibitorId: number;
  @Column({ type: 'inet', nullable: true }) ip: string | null;
  @Column({ name: 'geo_lat', type: 'double precision', nullable: true }) geoLat: number | null;
  @Column({ name: 'geo_lng', type: 'double precision', nullable: true }) geoLng: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
