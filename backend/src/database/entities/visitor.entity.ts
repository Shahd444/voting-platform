import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Name and phone are AES-256-GCM encrypted; phone_hash (HMAC) is the uniqueness key. */
@Entity('visitors')
export class Visitor {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'name_enc' }) nameEnc: string;
  @Column({ name: 'phone_enc' }) phoneEnc: string;
  @Column({ name: 'phone_hash', unique: true }) phoneHash: string;
  @Column({ name: 'phone_last4' }) phoneLast4: string;
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true }) verifiedAt: Date | null;
  @Column({ name: 'consent_outreach', default: false }) consentOutreach: boolean;
  @Column({ name: 'created_ip', type: 'inet', nullable: true }) createdIp: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
