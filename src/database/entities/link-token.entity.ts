import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { LinkTokenPurpose } from '@/constants';
export type { LinkTokenPurpose };

/** Tokens inside emailed links (verify email, reset password, magic sign-in). Single use. */
@Entity('auth_link_tokens')
export class LinkTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  purpose: LinkTokenPurpose;

  /** Set when the link is for an existing user. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** The email the link was sent to (a magic link can create a new account for it). */
  @Column({ type: 'text' })
  email: string;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
