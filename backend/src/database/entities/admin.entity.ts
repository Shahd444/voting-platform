import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type AdminRole = 'admin' | 'viewer';

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) username: string;
  @Column({ name: 'password_hash' }) passwordHash: string;
  @Column({ name: 'totp_secret_enc', type: 'text', nullable: true }) totpSecretEnc: string | null;
  @Column({ name: 'totp_enabled', default: false }) totpEnabled: boolean;
  @Column({ type: 'text', default: 'admin' }) role: AdminRole;
  @Column({ name: 'failed_logins', default: 0 }) failedLogins: number;
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true }) lockedUntil: Date | null;
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true }) lastLoginAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
