import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** The secret shared with a user's authenticator app. Encrypted, because we must read it to check codes. */
@Entity('auth_two_factor_secrets')
export class TwoFactorSecretEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'encrypted_secret', type: 'text' })
  encryptedSecret: string;

  /** Null while the user is still setting up (has not typed a first code). */
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  /** The last 30-second step a code was accepted for; older codes are refused (no replay). */
  @Column({ name: 'last_used_time_step', type: 'bigint', nullable: true, transformer: { to: (v: number | null) => v, from: (v: string | null) => (v === null ? null : Number(v)) } })
  lastUsedTimeStep: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
