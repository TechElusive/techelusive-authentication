import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { EncryptionService } from '@/common/encryption.service';
import { findUrlSafetyProblem } from '@/common/network-safety';
import {
  AuthEventName,
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  DEFAULT_PAGE_SIZE,
  ENCRYPTION_PURPOSE,
  MAXIMUM_PAGE_SIZE,
  MAXIMUM_WEBHOOKS,
  SORT_ORDER,
  TEXT_ENCODING,
  VALIDATION_PROBLEM,
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_SECRET_BYTES,
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_TEST_EVENT_NAME,
  WEBHOOK_TEST_MESSAGE,
} from '@/constants';
import { WebhookDeliveryEntity, WebhookEntity } from '@/database/entities';
import { typeormRow } from '@/database/typeorm-row';

export interface WebhookInput {
  url: string;
  /** Event names to receive, e.g. ["user.created"]. Empty = every event. */
  eventNames?: string[];
  description?: string | null;
  isEnabled?: boolean;
}

/** A webhook as shown to admins. The signing secret is only shown when created or rotated. */
export type WebhookSummary = Omit<WebhookEntity, 'encryptedSigningSecret'>;

const KNOWN_EVENT_NAMES = new Set<string>(Object.values(AUTH_EVENTS));

/**
 * Admin management of webhooks: URLs that receive auth events as signed HTTP POSTs.
 * Deliveries themselves are sent by WebhookDeliveryWorker.
 */
@Injectable()
export class WebhooksService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly encryption: EncryptionService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Creates a webhook. Returns the signing secret ONCE: the receiver needs it to verify deliveries.
   *
   * @param input - URL, event names (empty = every event), description and on/off state.
   * @returns The webhook and its plain signing secret.
   * @throws AuthError UNSAFE_WEBHOOK_URL when the URL is not https or points at a private address.
   * @throws AuthError VALIDATION_ERROR for unknown event names or too many webhooks.
   */
  async createWebhook(input: WebhookInput) {
    const webhooks = this.database.getRepository(WebhookEntity);
    if ((await webhooks.count()) >= MAXIMUM_WEBHOOKS) throw new AuthError(AUTH_ERRORS.validationFailed, { problems: [VALIDATION_PROBLEM.tooManyWebhooks] });
    await this.assertUrlIsSafe(input.url);
    const eventNames = this.validateEventNames(input.eventNames ?? []);

    const webhookId = randomUUID();
    const signingSecret = this.createSigningSecret();
    const savedWebhook = await webhooks.save({
      id: webhookId,
      url: input.url,
      eventNames,
      description: input.description ?? null,
      isEnabled: input.isEnabled ?? true,
      encryptedSigningSecret: await this.encryption.encrypt(signingSecret, this.encryptionContext(webhookId)),
    });
    return { success: true as const, webhook: this.toSummary(savedWebhook), signingSecret };
  }

  /**
   * Lists every webhook, oldest first.
   *
   * @returns The webhooks, without their secrets.
   */
  async listWebhooks(): Promise<WebhookSummary[]> {
    const webhooks = await this.database.getRepository(WebhookEntity).find({ order: { createdAt: SORT_ORDER.oldestFirst } });
    return webhooks.map((webhook) => this.toSummary(webhook));
  }

  /**
   * Changes a webhook. Fields left undefined are not touched.
   *
   * @param webhookId - The webhook.
   * @param changes - The fields to change.
   * @returns The updated webhook.
   * @throws AuthError NOT_FOUND when there is no such webhook.
   * @throws AuthError UNSAFE_WEBHOOK_URL or VALIDATION_ERROR for a bad URL or event name.
   */
  async updateWebhook(webhookId: string, changes: Partial<WebhookInput>) {
    const webhooks = this.database.getRepository(WebhookEntity);
    const webhook = await webhooks.findOne({ where: { id: webhookId } });
    if (!webhook) throw new AuthError(AUTH_ERRORS.notFound);

    if (changes.url !== undefined) {
      await this.assertUrlIsSafe(changes.url);
      webhook.url = changes.url;
    }
    if (changes.eventNames !== undefined) webhook.eventNames = this.validateEventNames(changes.eventNames);
    if (changes.description !== undefined) webhook.description = changes.description;
    if (changes.isEnabled !== undefined) webhook.isEnabled = changes.isEnabled;
    return { success: true as const, webhook: this.toSummary(await webhooks.save(webhook)) };
  }

  /**
   * Deletes a webhook (its deliveries are deleted with it).
   *
   * @param webhookId - The webhook.
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when there is no such webhook.
   */
  async deleteWebhook(webhookId: string) {
    const result = await this.database.getRepository(WebhookEntity).delete({ id: webhookId });
    if (!result.affected) throw new AuthError(AUTH_ERRORS.notFound);
    return { success: true as const };
  }

  /**
   * Replaces the signing secret (e.g. it leaked). The old one stops working at once.
   *
   * @param webhookId - The webhook.
   * @returns The new plain signing secret, shown only this once.
   * @throws AuthError NOT_FOUND when there is no such webhook.
   */
  async rotateSigningSecret(webhookId: string) {
    const signingSecret = this.createSigningSecret();
    const result = await this.database.getRepository(WebhookEntity).update(
      { id: webhookId },
      { encryptedSigningSecret: await this.encryption.encrypt(signingSecret, this.encryptionContext(webhookId)) },
    );
    if (!result.affected) throw new AuthError(AUTH_ERRORS.notFound);
    return { success: true as const, signingSecret };
  }

  /**
   * Recent deliveries of one webhook, newest first, for debugging a receiver.
   *
   * @param webhookId - The webhook.
   * @param page - 1-based page number.
   * @param pageSize - Rows per page (capped at MAXIMUM_PAGE_SIZE).
   * @returns One page of deliveries, plus the total.
   */
  async listDeliveries(webhookId: string, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
    const take = Math.min(Math.max(pageSize, 1), MAXIMUM_PAGE_SIZE);
    const [deliveries, total] = await this.database.getRepository(WebhookDeliveryEntity).findAndCount({
      where: { webhookId },
      order: { createdAt: SORT_ORDER.newestFirst },
      skip: (Math.max(page, 1) - 1) * take,
      take,
    });
    return { success: true as const, deliveries, total, page, pageSize: take };
  }

  /**
   * Sends a failed (or any) delivery again, right away, with a fresh set of retries.
   *
   * @param webhookId - The webhook the delivery belongs to.
   * @param deliveryId - The delivery.
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when the delivery doesn't exist for this webhook.
   */
  async retryDelivery(webhookId: string, deliveryId: string) {
    const result = await this.database
      .getRepository(WebhookDeliveryEntity)
      .update({ id: deliveryId, webhookId }, { status: WEBHOOK_DELIVERY_STATUS.pending, nextAttemptAt: new Date(), attemptCount: 0 });
    if (!result.affected) throw new AuthError(AUTH_ERRORS.notFound);
    return { success: true as const };
  }

  /**
   * Queues a "webhook.test" delivery so the receiver can be checked end to end.
   *
   * @param webhookId - The webhook.
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when there is no such webhook.
   */
  async sendTestDelivery(webhookId: string) {
    if (!(await this.database.getRepository(WebhookEntity).exists({ where: { id: webhookId } }))) throw new AuthError(AUTH_ERRORS.notFound);
    await this.database.getRepository(WebhookDeliveryEntity).insert(
      typeormRow<WebhookDeliveryEntity>({
        webhookId,
        eventName: WEBHOOK_TEST_EVENT_NAME,
        payload: { name: WEBHOOK_TEST_EVENT_NAME, userId: null, data: { message: WEBHOOK_TEST_MESSAGE }, occurredAt: new Date().toISOString() },
        status: WEBHOOK_DELIVERY_STATUS.pending,
        nextAttemptAt: new Date(),
      }),
    );
    return { success: true as const };
  }

  /**
   * Reads a webhook's signing secret. Used by the delivery worker.
   *
   * @param webhook - The webhook row.
   * @returns The plain signing secret.
   */
  decryptSigningSecret(webhook: WebhookEntity): Promise<string> {
    return this.encryption.decrypt(webhook.encryptedSigningSecret, this.encryptionContext(webhook.id));
  }

  // -------------------------------------------------------------------------------------------

  /**
   * @param url - The webhook URL.
   * @throws AuthError UNSAFE_WEBHOOK_URL (with `problem`) when the server must not call it.
   */
  private async assertUrlIsSafe(url: string) {
    const problem = await findUrlSafetyProblem(url);
    if (problem) throw new AuthError(AUTH_ERRORS.unsafeWebhookUrl, { problem });
  }

  /**
   * @param eventNames - The event names the admin chose.
   * @returns The names without duplicates.
   * @throws AuthError VALIDATION_ERROR listing any names that are not real events.
   */
  private validateEventNames(eventNames: string[]): AuthEventName[] {
    const unknownNames = eventNames.filter((name) => !KNOWN_EVENT_NAMES.has(name));
    if (unknownNames.length > 0) {
      throw new AuthError(AUTH_ERRORS.validationFailed, { problems: [VALIDATION_PROBLEM.unknownEventNames(unknownNames)] });
    }
    return [...new Set(eventNames)] as AuthEventName[];
  }

  /**
   * @returns A new random signing secret like "whsec_...".
   */
  private createSigningSecret(): string {
    return `${WEBHOOK_SECRET_PREFIX}${randomBytes(WEBHOOK_SECRET_BYTES).toString(TEXT_ENCODING.base64Url)}`;
  }

  /**
   * Binds the encrypted secret to its webhook, so a secret copied to another row won't decrypt.
   *
   * @param webhookId - The webhook.
   * @returns The context for `EncryptionService`.
   */
  private encryptionContext(webhookId: string) {
    return { purpose: ENCRYPTION_PURPOSE.webhookSigningSecret, webhookId };
  }

  /**
   * @param webhook - The webhook row.
   * @returns The webhook without its encrypted secret, safe to show to admins.
   */
  private toSummary(webhook: WebhookEntity): WebhookSummary {
    const { encryptedSigningSecret: _hiddenSecret, ...summary } = webhook;
    return summary;
  }
}
