import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { WEBHOOK_DELIVERY_STATUS, type WebhookDeliveryStatus } from '@/constants';
import type { JsonObject } from './json-object';
export type { WebhookDeliveryStatus };

/** One event to send to one webhook, with its retry state. */
@Entity('auth_webhook_deliveries')
@Index(['status', 'nextAttemptAt'])
export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'webhook_id', type: 'uuid' })
  webhookId: string;

  @Column({ name: 'event_name', type: 'text' })
  eventName: string;

  @Column({ type: 'jsonb' })
  payload: JsonObject;

  @Column({ type: 'text', default: WEBHOOK_DELIVERY_STATUS.pending })
  status: WebhookDeliveryStatus;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt: Date;

  @Column({ name: 'last_response_status', type: 'int', nullable: true })
  lastResponseStatus: number | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;
}
