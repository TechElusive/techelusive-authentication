import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { JsonObject } from './json-object';

/** Security history: sign-ins, failures, password changes, admin actions. Never contains secrets. */
@Entity('auth_audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** Who did it, when not the user themself: "admin:<id>", "system". */
  @Column({ name: 'performed_by', type: 'text', nullable: true })
  performedBy: string | null;

  @Column({ name: 'event_name', type: 'text' })
  eventName: string;

  @Column({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'jsonb', default: {} })
  details: JsonObject;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
