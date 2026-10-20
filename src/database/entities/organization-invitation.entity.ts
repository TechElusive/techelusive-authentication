import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { OrganizationRole } from '@/constants';

/** An emailed invitation to join an organization. Single use. */
@Entity('auth_organization_invitations')
export class OrganizationInvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text' })
  role: OrganizationRole;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash: string;

  @Column({ name: 'invited_by_user_id', type: 'uuid' })
  invitedByUserId: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
