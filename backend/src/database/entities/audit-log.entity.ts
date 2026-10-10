import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column() actor: string;
  @Column() action: string;
  @Column({ type: 'jsonb', default: {} }) detail: any;
  @Column({ type: 'inet', nullable: true }) ip: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
