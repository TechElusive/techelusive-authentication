import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { createRandomToken, hasRandomTokenFormat, sha256Hex } from '@/common/crypto/random-secrets';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  CHALLENGE_PURPOSE,
  SECOND_IN_MILLISECONDS,
  TOKEN_PREFIX,
  TWO_FACTOR_MAX_ATTEMPTS,
} from '@/constants';
import { ChallengePurpose, SignInChallengeEntity } from '@/database/entities';
import { SignInMethod } from '@/features/sessions/session.types';

/** A challenge that has been checked and is ready to finish. */
export interface OpenChallenge {
  challengeId: string;
  userId: string;
  signInMethod: SignInMethod;
}

/**
 * Short-lived "half done" tokens (prefix "ch_"):
 * - two_factor: the first step passed, the 2FA code is next.
 * - reactivate_account: a DEACTIVATED user proved who they are and may now reactivate.
 *
 * Only the token's hash is stored. A token can be used once, and a few wrong 2FA codes burn it.
 */
@Injectable()
export class SignInChallengesService {
  private readonly database: DataSource;

  constructor(@Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions) {
    this.database = options.dataSource;
  }

  /**
   * Creates a challenge and returns the plain token to give the client. Only its hash is stored.
   *
   * @param purpose - "two_factor" or "reactivate_account".
   * @param userId - The user who passed the first step.
   * @param signInMethod - How they passed it (kept for the final sign-in).
   * @param lifetimeSeconds - How long the token works.
   * @returns The plain "ch_..." token.
   */
  async createChallenge(
    purpose: typeof CHALLENGE_PURPOSE.twoFactor | typeof CHALLENGE_PURPOSE.reactivateAccount,
    userId: string,
    signInMethod: SignInMethod,
    lifetimeSeconds: number,
  ): Promise<string> {
    const { plainToken, tokenHash } = createRandomToken(TOKEN_PREFIX.signInChallenge);
    await this.database.getRepository(SignInChallengeEntity).insert({
      purpose,
      userId,
      signInMethod,
      challengeTokenHash: tokenHash,
      expiresAt: new Date(Date.now() + lifetimeSeconds * SECOND_IN_MILLISECONDS),
    });
    return plainToken;
  }

  /**
   * Looks up a challenge token without using it up.
   *
   * @param challengeToken - The token the client sent.
   * @param purpose - What the token must be for.
   * @returns The challenge's id, user and sign-in method.
   * @throws AuthError INVALID_TOKEN if the token is unknown, already used, expired,
   *   or has had too many wrong codes.
   */
  async findOpenChallenge(challengeToken: unknown, purpose: ChallengePurpose): Promise<OpenChallenge> {
    if (!hasRandomTokenFormat(challengeToken, TOKEN_PREFIX.signInChallenge)) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    const challenge = await this.database.getRepository(SignInChallengeEntity).findOne({
      where: { challengeTokenHash: sha256Hex(challengeToken), purpose, usedAt: IsNull() },
    });
    const isUsable =
      challenge &&
      challenge.userId &&
      challenge.expiresAt.getTime() > Date.now() &&
      challenge.failedAttempts < TWO_FACTOR_MAX_ATTEMPTS;
    if (!isUsable) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    return { challengeId: challenge.id, userId: challenge.userId!, signInMethod: challenge.signInMethod as SignInMethod };
  }

  /**
   * Marks the challenge used, so the same step can never complete twice.
   *
   * @param challengeId - From `findOpenChallenge`.
   * @returns False if another request used it first.
   */
  async markChallengeUsed(challengeId: string): Promise<boolean> {
    const result = await this.database
      .getRepository(SignInChallengeEntity)
      .update({ id: challengeId, usedAt: IsNull() }, { usedAt: new Date() });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Counts a wrong code. After TWO_FACTOR_MAX_ATTEMPTS the challenge stops working.
   *
   * @param challengeId - From `findOpenChallenge`.
   */
  async recordFailedAttempt(challengeId: string): Promise<void> {
    await this.database.getRepository(SignInChallengeEntity).increment({ id: challengeId }, 'failedAttempts', 1);
  }
}
