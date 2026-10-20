import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One signed-in device. Signing out ends the session and every refresh token in it. */
@Entity('auth_sessions')
export class SessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** How the user signed in: password, email_code, magic_link, phone_code, google, apple, facebook, passkey. */
  @Column({ name: 'sign_in_method', type: 'text' })
  signInMethod: string;

  /** True when a 2FA code was also checked. */
  @Column({ name: 'used_two_factor', type: 'boolean', default: false })
  usedTwoFactor: boolean;

  /** The organization this device is currently working in (copied into the access token). */
  @Column({ name: 'active_organization_id', type: 'uuid', nullable: true })
  activeOrganizationId: string | null;

  @Column({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz' })
  lastUsedAt: Date;

  /** Hard limit: after this the user must sign in again, however often they refresh. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** Why it ended: signed_out, password_changed, refresh_token_reused, admin... */
  @Column({ name: 'revoked_reason', type: 'text', nullable: true })
  revokedReason: string | null;
}
