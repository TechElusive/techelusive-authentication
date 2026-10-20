import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { CodeChannel } from '@/constants';
export type { CodeChannel };

/** Short numeric codes sent by email or SMS for passwordless sign-in. */
@Entity('auth_one_time_codes')
@Index(['channel', 'destination'])
export class OneTimeCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  channel: CodeChannel;

  /** Email address or E.164 phone number the code was sent to. */
  @Column({ type: 'text' })
  destination: string;

  @Column({ name: 'code_hash', type: 'text' })
  codeHash: string;

  @Column({ type: 'text' })
  salt: string;

  /** Wrong guesses so far; the code stops working after the maximum. */
  @Column({ name: 'failed_attempts', type: 'int', default: 0 })
  failedAttempts: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
