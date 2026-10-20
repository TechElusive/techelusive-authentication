import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthEvent, AuthOptions } from '@/auth-options';
import { RequestContext } from '@/common/request-context';
import { AuthEventName, AUTH_OPTIONS_TOKEN, LOG_CONTEXT, WEBHOOK_DELIVERY_STATUS } from '@/constants';
import { AuditLogEntity, WebhookDeliveryEntity, WebhookEntity } from '@/database/entities';
import type { JsonObject } from '@/database/entities/json-object';
import { typeormRow, typeormRows } from '@/database/typeorm-row';

export interface RecordEventInput {
  name: AuthEventName;
  /** The user the event is about. */
  userId: string | null;
  /** Who did it when not the user themself: "admin:<id>", "system". */
  performedBy?: string | null;
  request?: RequestContext;
  /** Extra facts. Never put passwords, tokens or codes here. */
  details?: JsonObject;
}

/**
 * The single place every auth event goes through. One call writes the audit log, then calls
 * your `onEvent` handler, then queues a delivery for every webhook subscribed to the event.
 *
 * Recording an event never breaks the action that caused it: failures here are logged, not thrown.
 */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(LOG_CONTEXT.events);
  private readonly database: DataSource;

  constructor(@Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions) {
    this.database = options.dataSource;
  }

  /**
   * Records an event: writes the audit log, calls your `onEvent` handler, and queues webhook deliveries.
   * Never throws, so recording an event can't break the action that caused it.
   *
   * @param input - The event name, who it is about, who did it, the request, and extra details.
   * @example
   * await events.record({ name: AUTH_EVENTS.userSignedOut, userId, request, details: { sessionId } });
   */
  async record(input: RecordEventInput): Promise<void> {
    const event: AuthEvent = {
      name: input.name,
      userId: input.userId,
      data: input.details ?? {},
      occurredAt: new Date().toISOString(),
    };

    await this.writeAuditLog(input);
    await this.callAppHandler(event);
    await this.queueWebhookDeliveries(event);
  }

  /**
   * @param input - The event to write. Failures are logged, not thrown.
   */
  private async writeAuditLog(input: RecordEventInput) {
    try {
      await this.database.getRepository(AuditLogEntity).insert(
        typeormRow<AuditLogEntity>({
          eventName: input.name,
          userId: input.userId,
          performedBy: input.performedBy ?? null,
          ipAddress: input.request?.ipAddress ?? null,
          userAgent: input.request?.userAgent ?? null,
          details: input.details ?? {},
        }),
      );
    } catch (error) {
      this.logger.error(`Could not write audit log for "${input.name}": ${(error as Error).message}`);
    }
  }

  /**
   * Calls AuthOptions.onEvent, if set. Failures in your handler are logged, not thrown.
   *
   * @param event - The event to pass on.
   */
  private async callAppHandler(event: AuthEvent) {
    if (!this.options.onEvent) return;
    try {
      await this.options.onEvent(event);
    } catch (error) {
      this.logger.error(`Your onEvent handler failed for "${event.name}": ${(error as Error).message}`);
    }
  }

  /**
   * Queues one delivery per enabled webhook that subscribes to this event. The worker sends them.
   * Failures are logged, not thrown.
   *
   * @param event - The event to deliver.
   */
  private async queueWebhookDeliveries(event: AuthEvent) {
    try {
      const enabledWebhooks = await this.database.getRepository(WebhookEntity).find({ where: { isEnabled: true } });
      const subscribedWebhooks = enabledWebhooks.filter(
        (webhook) => webhook.eventNames.length === 0 || webhook.eventNames.includes(event.name),
      );
      if (subscribedWebhooks.length === 0) return;

      await this.database.getRepository(WebhookDeliveryEntity).insert(
        typeormRows<WebhookDeliveryEntity>(
          subscribedWebhooks.map((webhook) => ({
            webhookId: webhook.id,
            eventName: event.name,
            payload: { ...event },
            status: WEBHOOK_DELIVERY_STATUS.pending,
            nextAttemptAt: new Date(),
          })),
        ),
      );
    } catch (error) {
      this.logger.error(`Could not queue webhooks for "${event.name}": ${(error as Error).message}`);
    }
  }
}
