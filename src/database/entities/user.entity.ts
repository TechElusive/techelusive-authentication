import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ACCOUNT_STATUS, type AccountStatus } from '@/constants';
import type { JsonObject } from './json-object';

/**
 * A person who can sign in. Every way of signing in (password, phone, Google, passkey...) points here.
 * Your app keeps its own profile data in its own tables, linked by `UserEntity.id` (the token's "sub").
 */
@Entity('auth_users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stored in lower case. Null for users who only signed up with a phone number, or after deletion. */
  @Index({ unique: true, where: 'email IS NOT NULL' })
  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  isEmailVerified: boolean;

  /** E.164 format, e.g. +919876543210. */
  @Index({ unique: true, where: 'phone_number IS NOT NULL' })
  @Column({ name: 'phone_number', type: 'text', nullable: true })
  phoneNumber: string | null;

  @Column({ name: 'phone_verified', type: 'boolean', default: false })
  isPhoneVerified: boolean;

  @Column({ name: 'first_name', type: 'text', nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', type: 'text', nullable: true })
  lastName: string | null;

  /** App-wide roles, copied into every access token, e.g. ["user"]. */
  @Column({ type: 'text', array: true, default: '{}' })
  roles: string[];

  /** PENDING_VERIFICATION, ACTIVE, SUSPENDED, DEACTIVATED or DELETED. Only the backend changes it. */
  @Column({ type: 'text', default: ACCOUNT_STATUS.pendingVerification })
  status: AccountStatus;

  /** Why an admin suspended the account (internal; never shown to the user). */
  @Column({ name: 'suspension_reason', type: 'text', nullable: true })
  suspensionReason: string | null;

  @Column({ name: 'status_changed_at', type: 'timestamptz', nullable: true })
  statusChangedAt: Date | null;

  @Column({ name: 'terms_accepted_at', type: 'timestamptz', nullable: true })
  termsAcceptedAt: Date | null;

  @Column({ name: 'privacy_policy_accepted_at', type: 'timestamptz', nullable: true })
  privacyPolicyAcceptedAt: Date | null;

  /** Set by your app (AuthService.markOnboardingComplete) once the profile setup is done. */
  @Column({ name: 'onboarding_completed_at', type: 'timestamptz', nullable: true })
  onboardingCompletedAt: Date | null;

  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false })
  isTwoFactorEnabled: boolean;

  /** Free-form data your app wants to keep with the user (shown to admins, never put secrets here). */
  @Column({ type: 'jsonb', default: {} })
  metadata: JsonObject;

  @Column({ name: 'last_signed_in_at', type: 'timestamptz', nullable: true })
  lastSignedInAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
