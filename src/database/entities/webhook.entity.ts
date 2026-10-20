import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** An address that receives events (user.created, user.signed_in...). */
@Entity('auth_webhooks')
export class WebhookEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  url: string;

  /** Events to send; empty means all events. */
  @Column({ name: 'event_names', type: 'text', array: true, default: '{}' })
  eventNames: string[];

  /** Secret used to sign each delivery so the receiver can trust it. Encrypted at rest. */
  @Column({ name: 'encrypted_signing_secret', type: 'text' })
  encryptedSigningSecret: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
