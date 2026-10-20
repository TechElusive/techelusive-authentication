import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A key that lets another server call your API (machine to machine). Stored hashed. */
@Entity('auth_api_keys')
export class ApiKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Index({ unique: true })
  @Column({ name: 'key_hash', type: 'text' })
  keyHash: string;

  /** First characters, shown in lists so people can tell keys apart, e.g. "ak_3Fx9". */
  @Column({ name: 'key_preview', type: 'text' })
  keyPreview: string;

  /** What the key may do, e.g. ["rides:read"]. Your routes check these with @ApiKeyScopes(). */
  @Column({ type: 'text', array: true, default: '{}' })
  scopes: string[];

  /** When set, the key acts on behalf of this organization only. */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
