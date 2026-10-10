import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Exhibitor photos live in PostgreSQL so app servers stay stateless (see DESIGN_DECISIONS D10). */
@Entity('images')
export class Image {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'mime_type' }) mimeType: string;
  @Column({ type: 'bytea' }) bytes: Buffer;
  @Column() sha256: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
