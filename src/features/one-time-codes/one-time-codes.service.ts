import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { constantTimeEquals, createNumericCode, createSalt, hashShortCode } from '@/common/crypto/random-secrets';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  MINUTE_IN_SECONDS,
  ONE_TIME_CODE_MAX_ATTEMPTS,
  SECOND_IN_MILLISECONDS,
  SORT_ORDER,
} from '@/constants';
import { CodeChannel, OneTimeCodeEntity } from '@/database/entities';

export interface CodeRules {
  codeLength: number;
  expiresInMinutes: number;
  resendAfterSeconds: number;
}

/**
 * Short numeric codes sent by email or SMS ("Your code is 482913").
 *
 * - Only a salted hash of the code is stored.
 * - A new code can be requested after `resendAfterSeconds` (default a minute); it replaces the previous one.
 * - After ONE_TIME_CODE_MAX_ATTEMPTS wrong tries the code stops working.
 * - A code works once.
 */
@Injectable()
export class OneTimeCodesService {
  private readonly database: DataSource;

  constructor(@Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions) {
    this.database = options.dataSource;
  }

  /**
   * Creates a new code for `destination` and returns it so the caller can send it.
   * Any earlier code for the same destination stops working.
   *
   * @param channel - "email" or "sms".
   * @param destination - An email or E.164 phone number.
   * @param rules - Code length, lifetime and how soon a new one may be sent.
   * @returns The plain code to send. Only its hash is stored.
   * @throws AuthError TOO_MANY_REQUESTS (with `retryAfterSeconds`) if a code was sent less than `resendAfterSeconds` ago.
   */
  async createCode(channel: CodeChannel, destination: string, rules: CodeRules): Promise<string> {
    const codes = this.database.getRepository(OneTimeCodeEntity);
    const resendAllowedAfter = new Date(Date.now() - rules.resendAfterSeconds * SECOND_IN_MILLISECONDS);
    const sentRecently = await codes.exists({ where: { channel, destination, createdAt: MoreThan(resendAllowedAfter) } });
    if (sentRecently) throw new AuthError(AUTH_ERRORS.resendTooSoon, { retryAfterSeconds: rules.resendAfterSeconds });

    const code = createNumericCode(rules.codeLength);
    const salt = createSalt();
    await this.database.transaction(async (transaction) => {
      // Only the newest code works.
      await transaction.update(OneTimeCodeEntity, { channel, destination, usedAt: IsNull() }, { usedAt: new Date() });
      await transaction.insert(OneTimeCodeEntity, {
        channel,
        destination,
        salt,
        codeHash: hashShortCode(code, salt),
        expiresAt: new Date(Date.now() + rules.expiresInMinutes * MINUTE_IN_SECONDS * SECOND_IN_MILLISECONDS),
      });
    });
    return code;
  }

  /**
   * Checks a typed code and uses it up if right.
   *
   * @param channel - "email" or "sms".
   * @param destination - The email or phone number the code was sent to.
   * @param typedCode - What the user typed.
   * @throws AuthError OTP_EXPIRED when there is no usable code (none sent, expired, used, or too many wrong tries).
   * @throws AuthError INVALID_OTP (with `attemptsLeft`) when the code is wrong.
   */
  async verifyCode(channel: CodeChannel, destination: string, typedCode: unknown): Promise<void> {
    const codes = this.database.getRepository(OneTimeCodeEntity);
    const latestCode = await codes.findOne({
      where: { channel, destination, usedAt: IsNull() },
      order: { createdAt: SORT_ORDER.newestFirst },
    });
    const isUsable =
      latestCode && latestCode.expiresAt.getTime() > Date.now() && latestCode.failedAttempts < ONE_TIME_CODE_MAX_ATTEMPTS;
    if (!isUsable) throw new AuthError(AUTH_ERRORS.otpExpired);

    const codeIsRight =
      typeof typedCode === 'string' && constantTimeEquals(hashShortCode(typedCode.trim(), latestCode.salt), latestCode.codeHash);
    if (!codeIsRight) {
      await codes.increment({ id: latestCode.id }, 'failedAttempts', 1);
      const attemptsLeft = ONE_TIME_CODE_MAX_ATTEMPTS - latestCode.failedAttempts - 1;
      throw new AuthError(AUTH_ERRORS.invalidOtp, { attemptsLeft: Math.max(attemptsLeft, 0) });
    }

    // Use it up in one UPDATE, so the same code can't sign in twice at the same moment.
    const result = await codes.update({ id: latestCode.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!result.affected) throw new AuthError(AUTH_ERRORS.otpExpired);
  }
}
