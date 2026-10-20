import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { JsonObject } from './json-object';

/** A company or team. Users join organizations with a role (owner, admin, member). */
@Entity('auth_organizations')
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  /** Unique handle, e.g. "acme-india". */
  @Index({ unique: true })
  @Column({ type: 'text' })
  slug: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: JsonObject;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
