import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Event settings (voting window, IP ranges, geofence, display key …) — database-driven per spec §6. */
@Entity('settings')
export class Setting {
  @PrimaryColumn() key: string;
  @Column({ type: 'jsonb' }) value: any;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
