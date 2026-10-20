import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { createRandomToken, hasRandomTokenFormat, sha256Hex } from '@/common/crypto/random-secrets';
import { RequestContext } from '@/common/request-context';
import {
  API_KEY_LAST_USED_UPDATE_SECONDS,
  API_KEY_PREVIEW_LENGTH,
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  LOG_CONTEXT,
  PERFORMED_BY,
  SECOND_IN_MILLISECONDS,
  SORT_ORDER,
  TOKEN_PREFIX,
} from '@/constants';
import { ApiKeyEntity } from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  organizationId?: string | null;
  expiresAt?: Date | null;
}

/** An API key as shown in lists. The secret itself is never shown again after creation. */
export type ApiKeySummary = Omit<ApiKeyEntity, 'keyHash'>;

/**
 * Keys that let other servers call your API (machine to machine).
 * The full key is returned once, when created. Only its SHA-256 hash is stored.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(LOG_CONTEXT.apiKeys);
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Creates a key. Returns the plain key: show it to the admin once, it cannot be read again.
   *
   * @param input - Name, scopes, and optional organization and expiry date.
   * @param createdByUserId - The admin creating it (for the audit log).
   * @param request - Who is asking.
   * @returns `apiKey` (the plain key) and `details` (what lists show).
   */
  async createApiKey(input: CreateApiKeyInput, createdByUserId: string, request: RequestContext) {
    const { plainToken: plainKey, tokenHash: keyHash } = createRandomToken(TOKEN_PREFIX.apiKey);
    const savedKey = await this.database.getRepository(ApiKeyEntity).save({
      name: input.name,
      scopes: [...new Set(input.scopes)],
      organizationId: input.organizationId ?? null,
      expiresAt: input.expiresAt ?? null,
      createdByUserId,
      keyHash,
      keyPreview: plainKey.slice(0, TOKEN_PREFIX.apiKey.length + 1 + API_KEY_PREVIEW_LENGTH),
    });
    await this.events.record({
      name: AUTH_EVENTS.apiKeyCreated,
      userId: createdByUserId,
      performedBy: PERFORMED_BY.admin(createdByUserId),
      request,
      details: { apiKeyId: savedKey.id, name: savedKey.name, scopes: savedKey.scopes },
    });
    return { apiKey: plainKey, details: this.toSummary(savedKey) };
  }

  /**
   * @param organizationId - When given, only that organization's keys.
   * @returns The keys, newest first, without their hashes.
   */
  async listApiKeys(organizationId?: string): Promise<ApiKeySummary[]> {
    const keys = await this.database.getRepository(ApiKeyEntity).find({
      where: organizationId ? { organizationId } : {},
      order: { createdAt: SORT_ORDER.newestFirst },
    });
    return keys.map((key) => this.toSummary(key));
  }

  /**
   * Stops a key from working at once.
   *
   * @param apiKeyId - The key.
   * @param revokedByUserId - The admin revoking it (for the audit log).
   * @param request - Who is asking.
   * @throws AuthError NOT_FOUND when there is no such key, or it was already revoked.
   */
  async revokeApiKey(apiKeyId: string, revokedByUserId: string, request: RequestContext): Promise<void> {
    const result = await this.database
      .getRepository(ApiKeyEntity)
      .update({ id: apiKeyId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!result.affected) throw new AuthError(AUTH_ERRORS.notFound);
    await this.events.record({
      name: AUTH_EVENTS.apiKeyRevoked,
      userId: revokedByUserId,
      performedBy: PERFORMED_BY.admin(revokedByUserId),
      request,
      details: { apiKeyId },
    });
  }

  /**
   * Used by the guard. Checks a key sent by another server.
   *
   * @param presentedKey - The key from the request header.
   * @returns The key's row (with its scopes) when it is valid, not revoked and not expired.
   * @throws AuthError INVALID_API_KEY otherwise (the same error for every reason, so callers learn nothing).
   */
  async verifyApiKey(presentedKey: unknown): Promise<ApiKeyEntity> {
    if (!hasRandomTokenFormat(presentedKey, TOKEN_PREFIX.apiKey)) throw new AuthError(AUTH_ERRORS.invalidApiKey);

    const apiKey = await this.database.getRepository(ApiKeyEntity).findOne({
      where: { keyHash: sha256Hex(presentedKey), revokedAt: IsNull() },
    });
    const isExpired = apiKey?.expiresAt != null && apiKey.expiresAt.getTime() <= Date.now();
    if (!apiKey || isExpired) throw new AuthError(AUTH_ERRORS.invalidApiKey);

    this.updateLastUsedInBackground(apiKey);
    return apiKey;
  }

  /**
   * Records when a key was last used, at most once a minute per key, without slowing the request.
   *
   * @param apiKey - The key that was just used.
   */
  private updateLastUsedInBackground(apiKey: ApiKeyEntity) {
    const lastUsedMs = apiKey.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - lastUsedMs < API_KEY_LAST_USED_UPDATE_SECONDS * SECOND_IN_MILLISECONDS) return;
    this.database
      .getRepository(ApiKeyEntity)
      .update({ id: apiKey.id }, { lastUsedAt: new Date() })
      .catch((error: Error) => this.logger.warn(`Could not update lastUsedAt for API key ${apiKey.id}: ${error.message}`));
  }

  /**
   * @param apiKey - The key row.
   * @returns The key without its hash, safe to show in lists.
   */
  private toSummary(apiKey: ApiKeyEntity): ApiKeySummary {
    const { keyHash: _hiddenHash, ...summary } = apiKey;
    return summary;
  }
}
