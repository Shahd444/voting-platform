import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) slug: string;
  @Column() name: string;
  @Column({ default: '' }) description: string;
  @Column({ name: 'sort_order', default: 0 }) sortOrder: number;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
