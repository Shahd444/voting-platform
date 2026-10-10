import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Only an HMAC of the code is stored. */
@Entity('otp_challenges')
export class OtpChallenge {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'visitor_id', type: 'uuid' }) visitorId: string;
  @Column({ name: 'code_hash' }) codeHash: string;
  @Column({ name: 'payload_enc' }) payloadEnc: string;
  @Column({ type: 'inet', nullable: true }) ip: string | null;
  @Column({ default: 0 }) attempts: number;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true }) consumedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
