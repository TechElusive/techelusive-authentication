import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { createRandomToken, hasRandomTokenFormat, sha256Hex } from '@/common/crypto/random-secrets';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  HOUR_IN_SECONDS,
  LINK_PURPOSE,
  LINK_TOKEN_KINDS,
  MINUTE_IN_SECONDS,
  SECOND_IN_MILLISECONDS,
} from '@/constants';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthSettings } from '@/features/settings/settings.types';
import { LinkTokenEntity, LinkTokenPurpose } from '@/database/entities';

/**
 * How long each kind of link works, from the settings.
 *
 * @param purpose - The kind of link.
 * @param settings - The current settings.
 * @returns The lifetime in seconds.
 */
function linkLifetimeSeconds(purpose: LinkTokenPurpose, settings: AuthSettings): number {
  switch (purpose) {
    case LINK_PURPOSE.verifyEmail:
      return settings.emailVerification.linkExpiresInHours * HOUR_IN_SECONDS;
    case LINK_PURPOSE.resetPassword:
      return settings.passwordReset.linkExpiresInMinutes * MINUTE_IN_SECONDS;
    case LINK_PURPOSE.magicSignIn:
      return settings.magicLink.expiresInMinutes * MINUTE_IN_SECONDS;
    case LINK_PURPOSE.changeEmail:
      return settings.emailChange.linkExpiresInMinutes * MINUTE_IN_SECONDS;
  }
}

/** A link token that was valid and has now been used up. */
export interface UsedLinkToken {
  userId: string | null;
  email: string;
}

/**
 * Single-use tokens put in emailed links (verify email, reset password, magic sign-in).
 * Only the hash is stored. Creating a new token of a kind cancels the older ones for that email,
 * so only the newest link in the user's inbox works.
 */
@Injectable()
export class LinkTokensService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Creates a single-use token for an emailed link. Older unused tokens of the same kind for this
   * email stop working, so only the newest link in the inbox works.
   *
   * @param purpose - What the link is for (verify email, reset password, magic sign-in, change email).
   * @param email - The address the link is sent to.
   * @param userId - The account it belongs to, or null (e.g. a magic link before sign-up).
   * @returns The plain token to put in the link. Only its hash is stored.
   */
  async createLinkToken(purpose: LinkTokenPurpose, email: string, userId: string | null): Promise<string> {
    const { prefix } = LINK_TOKEN_KINDS[purpose];
    const lifetimeSeconds = linkLifetimeSeconds(purpose, await this.settingsService.getSettings());
    const { plainToken, tokenHash } = createRandomToken(prefix);

    await this.database.transaction(async (transaction) => {
      await transaction.update(LinkTokenEntity, { purpose, email, usedAt: IsNull() }, { usedAt: new Date() });
      await transaction.insert(LinkTokenEntity, {
        purpose,
        email,
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + lifetimeSeconds * SECOND_IN_MILLISECONDS),
      });
    });
    return plainToken;
  }

  /**
   * Uses up a token. Done in one UPDATE so that two clicks at the same moment can't both succeed.
   *
   * @param token - The token from the link.
   * @param purpose - What the link must be for.
   * @returns The user id and email the token was created for.
   * @throws AuthError INVALID_TOKEN for any problem (unknown, used, expired, wrong kind).
   */
  async useLinkToken(token: unknown, purpose: LinkTokenPurpose): Promise<UsedLinkToken> {
    if (!hasRandomTokenFormat(token, LINK_TOKEN_KINDS[purpose].prefix)) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);

    const result = await this.database
      .createQueryBuilder()
      .update(LinkTokenEntity)
      .set({ usedAt: () => 'now()' })
      .where('token_hash = :tokenHash AND purpose = :purpose AND used_at IS NULL AND expires_at > now()', {
        tokenHash: sha256Hex(token),
        purpose,
      })
      // returning() takes entity property names; the raw rows use column names (user_id).
      .returning(['userId', 'email'])
      .execute();

    const usedRow = result.raw[0] as { user_id: string | null; email: string } | undefined;
    if (!usedRow) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    return { userId: usedRow.user_id, email: usedRow.email };
  }

  /**
   * Cancels every unused link of a kind for a user (e.g. reset links after the password changed).
   *
   * @param purpose - The kind of link.
   * @param userId - The user.
   */
  async cancelLinkTokens(purpose: LinkTokenPurpose, userId: string): Promise<void> {
    await this.database.getRepository(LinkTokenEntity).update({ purpose, userId, usedAt: IsNull() }, { usedAt: new Date() });
  }
}
