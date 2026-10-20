import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { ChallengePurpose } from '@/constants';
export type { ChallengePurpose };

/**
 * A sign-in that is half done:
 * - two_factor: the password (or code) was right, now we wait for the 2FA code.
 * - reactivate_account: a DEACTIVATED user proved who they are; the token lets them reactivate.
 * - passkey_*: we sent the device a random challenge and wait for it to sign it.
 */
@Entity('auth_sign_in_challenges')
export class SignInChallengeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  purpose: ChallengePurpose;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** Hash of the token the client sends back to continue (for 2FA). */
  @Index({ unique: true, where: 'challenge_token_hash IS NOT NULL' })
  @Column({ name: 'challenge_token_hash', type: 'text', nullable: true })
  challengeTokenHash: string | null;

  /** The random WebAuthn challenge the device must sign (for passkeys). */
  @Column({ name: 'webauthn_challenge', type: 'text', nullable: true })
  webauthnChallenge: string | null;

  /** For 2FA: how the first step was done, kept for the session record. */
  @Column({ name: 'sign_in_method', type: 'text', nullable: true })
  signInMethod: string | null;

  @Column({ name: 'failed_attempts', type: 'int', default: 0 })
  failedAttempts: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
