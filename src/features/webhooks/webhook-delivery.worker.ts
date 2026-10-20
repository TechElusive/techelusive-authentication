import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { findUrlSafetyProblem } from '@/common/network-safety';
import {
  AUTH_OPTIONS_TOKEN,
  FETCH_REDIRECT_MODE_MANUAL,
  HTTP_HEADER,
  HTTP_METHOD,
  JSON_CONTENT_TYPE,
  LOG_CONTEXT,
  SECOND_IN_MILLISECONDS,
  SUCCESS_STATUS_RANGE,
  WEBHOOK_CLAIM_TIMEOUT_SECONDS,
  WEBHOOK_DELIVERY_ERROR,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_ERROR_MAX_LENGTH,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_REQUEST_TIMEOUT_MS,
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_USER_AGENT,
  WEBHOOK_WORKER_BATCH_SIZE,
  WEBHOOK_WORKER_INTERVAL_MS,
} from '@/constants';
import { WebhookDeliveryEntity, WebhookEntity } from '@/database/entities';
import { createWebhookSignature } from './webhook-signature';
import { WebhooksService } from './webhooks.service';

/**
 * Sends queued webhook deliveries in the background.
 *
 * - Runs every few seconds on every server. Each server claims different rows
 *   (FOR UPDATE SKIP LOCKED), so nothing is sent twice.
 * - A 2xx response = delivered. Anything else is retried with growing delays
 *   (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h), then marked failed.
 * - Redirects are not followed, and the URL is re-checked before every send, so a receiver
 *   can't later point us at a private address.
 */
@Injectable()
export class WebhookDeliveryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LOG_CONTEXT.webhookDelivery);
  private readonly database: DataSource;
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly webhooks: WebhooksService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Starts the timer that sends due deliveries every few seconds.
   */
  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.sendDueDeliveries(), WEBHOOK_WORKER_INTERVAL_MS);
    this.timer.unref(); // Never keeps the process alive on shutdown.
  }

  /**
   * Stops the timer when the app shuts down.
   */
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One round: claim due deliveries and send them. Public so tests and scripts can call it.
   * A round is skipped if the previous one is still running. Errors are logged, never thrown.
   */
  async sendDueDeliveries(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const claimedDeliveries = await this.claimDueDeliveries();
      await Promise.all(claimedDeliveries.map((delivery) => this.sendOne(delivery)));
    } catch (error) {
      this.logger.error(`Webhook round failed: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Takes due rows and pushes their next attempt a little into the future, in one statement.
   * If this server crashes mid-send, another server picks them up after the claim times out.
   *
   * @returns The deliveries this server should send now.
   */
  private async claimDueDeliveries(): Promise<WebhookDeliveryEntity[]> {
    // For UPDATE ... RETURNING, TypeORM's postgres driver returns [rows, affectedRowCount].
    const [rows]: [Array<Record<string, any>>, number] = await this.database.query(
      `UPDATE auth_webhook_deliveries
          SET next_attempt_at = now() + make_interval(secs => $1)
        WHERE id IN (
          SELECT id FROM auth_webhook_deliveries
           WHERE status = $3 AND next_attempt_at <= now()
           ORDER BY next_attempt_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING id, webhook_id, event_name, payload, attempt_count`,
      [WEBHOOK_CLAIM_TIMEOUT_SECONDS, WEBHOOK_WORKER_BATCH_SIZE, WEBHOOK_DELIVERY_STATUS.pending],
    );
    return rows.map((row) =>
      Object.assign(new WebhookDeliveryEntity(), {
        id: row.id,
        webhookId: row.webhook_id,
        eventName: row.event_name,
        payload: row.payload,
        attemptCount: row.attempt_count,
      }),
    );
  }

  /**
   * Sends one delivery and records what happened. The webhook's URL is checked again first.
   *
   * @param delivery - A claimed delivery.
   */
  private async sendOne(delivery: WebhookDeliveryEntity): Promise<void> {
    const webhook = await this.database.getRepository(WebhookEntity).findOne({ where: { id: delivery.webhookId } });
    if (!webhook || !webhook.isEnabled) {
      await this.recordOutcome(delivery, { isDelivered: false, isFinal: true, error: WEBHOOK_DELIVERY_ERROR.webhookUnavailable });
      return;
    }

    const urlProblem = await findUrlSafetyProblem(webhook.url);
    if (urlProblem) {
      await this.recordOutcome(delivery, { isDelivered: false, isFinal: false, error: WEBHOOK_DELIVERY_ERROR.unsafeUrl(urlProblem) });
      return;
    }

    const body = JSON.stringify({ id: delivery.id, ...delivery.payload });
    const signingSecret = await this.webhooks.decryptSigningSecret(webhook);
    try {
      const response = await fetch(webhook.url, {
        method: HTTP_METHOD.post,
        redirect: FETCH_REDIRECT_MODE_MANUAL,
        signal: AbortSignal.timeout(WEBHOOK_REQUEST_TIMEOUT_MS),
        headers: {
          [HTTP_HEADER.contentType]: JSON_CONTENT_TYPE,
          [HTTP_HEADER.outgoingUserAgent]: WEBHOOK_USER_AGENT,
          [WEBHOOK_SIGNATURE_HEADER]: createWebhookSignature(signingSecret, body),
          [WEBHOOK_EVENT_HEADER]: delivery.eventName,
          [WEBHOOK_DELIVERY_ID_HEADER]: delivery.id,
        },
        body,
      });
      const isDelivered = response.status >= SUCCESS_STATUS_RANGE.from && response.status < SUCCESS_STATUS_RANGE.toExclusive;
      await this.recordOutcome(delivery, {
        isDelivered,
        isFinal: isDelivered,
        responseStatus: response.status,
        error: isDelivered ? null : WEBHOOK_DELIVERY_ERROR.httpStatus(response.status),
      });
    } catch (error) {
      await this.recordOutcome(delivery, { isDelivered: false, isFinal: false, error: (error as Error).message });
    }
  }

  /**
   * Saves the result of an attempt and schedules the next retry, or marks the delivery
   * delivered or failed.
   *
   * @param delivery - The delivery that was attempted.
   * @param outcome - Whether it was delivered, whether to stop retrying, the HTTP status and the error.
   */
  private async recordOutcome(
    delivery: WebhookDeliveryEntity,
    outcome: { isDelivered: boolean; isFinal: boolean; responseStatus?: number; error: string | null },
  ) {
    const attemptCount = delivery.attemptCount + 1;
    const retryDelaySeconds = WEBHOOK_RETRY_DELAYS_SECONDS[attemptCount - 1];
    const hasRetriesLeft = !outcome.isFinal && retryDelaySeconds !== undefined;

    await this.database.getRepository(WebhookDeliveryEntity).update(
      { id: delivery.id },
      {
        attemptCount,
        status: outcome.isDelivered
          ? WEBHOOK_DELIVERY_STATUS.delivered
          : hasRetriesLeft
            ? WEBHOOK_DELIVERY_STATUS.pending
            : WEBHOOK_DELIVERY_STATUS.failed,
        deliveredAt: outcome.isDelivered ? new Date() : null,
        lastResponseStatus: outcome.responseStatus ?? null,
        lastError: outcome.error?.slice(0, WEBHOOK_ERROR_MAX_LENGTH) ?? null,
        nextAttemptAt: hasRetriesLeft ? new Date(Date.now() + retryDelaySeconds * SECOND_IN_MILLISECONDS) : new Date(),
      },
    );
  }
}
