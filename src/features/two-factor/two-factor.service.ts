import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { constantTimeEquals, createBackupCode, createSalt, hashShortCode, normalizeBackupCode } from '@/common/crypto/random-secrets';
import { buildAuthenticatorAppUrl, createTotpSecret, verifyTotpCode } from '@/common/crypto/totp';
import { EncryptionService } from '@/common/encryption.service';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { RequestContext } from '@/common/request-context';
import {
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  BACKUP_CODE_COUNT,
  BACKUP_CODE_DISPLAY_GROUP_LENGTH,
  BACKUP_CODE_DISPLAY_SEPARATOR,
  CHALLENGE_PURPOSE,
  ENCRYPTION_PURPOSE,
  PERFORMED_BY,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  SESSION_END_REASON,
  SIGN_IN_FAILURE_REASON,
  TOTP_DEFAULT_ISSUER_NAME,
} from '@/constants';
import { BackupCodeEntity, TwoFactorSecretEntity, UserEntity } from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { SessionService } from '@/features/sessions/session.service';
import { SettingsService } from '@/features/settings/settings.service';
import { SignInChallengesService } from '@/features/sign-in/sign-in-challenges.service';
import { SignInService } from '@/features/sign-in/sign-in.service';
import { SignedInResult } from '@/features/sign-in/sign-in.types';
import { UsersService } from '@/features/users/users.service';

/**
 * Two-factor authentication with an authenticator app (Google Authenticator, Microsoft
 * Authenticator, 1Password, Authy...), plus single-use backup codes for a lost phone.
 *
 * Turning it on:   POST /auth/2fa/setup   -> secret + QR-code URL
 *                  POST /auth/2fa/enable  -> first code from the app; returns backup codes (shown once)
 * Signing in:      sign-in returns { status: "two_factor_required", challengeToken }
 *                  POST /auth/2fa/verify  -> challengeToken + code (or a backup code) -> tokens
 */
@Injectable()
export class TwoFactorService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly encryption: EncryptionService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly signIn: SignInService,
    private readonly challenges: SignInChallengesService,
    private readonly rateLimiter: RateLimiterService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  // -------------------------------------------------------------------------------------------
  // Turning 2FA on and off
  // -------------------------------------------------------------------------------------------

  /**
   * Starts setup: creates a new secret. Show `authenticatorAppUrl` as a QR code (and `secret` for
   * typing by hand). Nothing changes for the user until they confirm with a code (`confirmSetup`).
   * Calling it again replaces the unconfirmed secret.
   *
   * @param userId - The signed-in user.
   * @returns The plain secret and the otpauth:// URL for the QR code.
   * @throws AuthError FEATURE_DISABLED when 2FA is turned off in settings.
   * @throws AuthError TWO_FACTOR_ALREADY_ENABLED when the user already has 2FA on.
   */
  async startSetup(userId: string) {
    await this.assertTwoFactorAllowed();
    const user = await this.users.getUserOrThrow(userId);
    if (user.isTwoFactorEnabled) throw new AuthError(AUTH_ERRORS.twoFactorAlreadyEnabled);

    const secret = createTotpSecret();
    await this.database.getRepository(TwoFactorSecretEntity).upsert(
      {
        userId,
        encryptedSecret: await this.encryption.encrypt(secret, this.encryptionContext(userId)),
        confirmedAt: null,
        lastUsedTimeStep: null,
      },
      ['userId'],
    );
    const accountName = user.email ?? user.phoneNumber ?? user.id;
    const issuerName = this.options.appName ?? TOTP_DEFAULT_ISSUER_NAME;
    return { success: true as const, secret, authenticatorAppUrl: buildAuthenticatorAppUrl(secret, accountName, issuerName) };
  }

  /**
   * Finishes setup: the user types the first code from their app. Turns 2FA on, signs out other
   * devices, and returns backup codes. Show them once and ask the user to save them.
   *
   * @param userId - The signed-in user.
   * @param currentSessionId - This device's session, which stays signed in.
   * @param code - The 6-digit code from the authenticator app.
   * @param request - Who is asking (for the audit log).
   * @returns The plain backup codes, formatted like "k7m2-x9p4".
   * @throws AuthError TWO_FACTOR_SETUP_NOT_STARTED when `startSetup` wasn't called first.
   * @throws AuthError INVALID_OTP when the code is wrong.
   * @throws AuthError TOO_MANY_REQUESTS after too many attempts.
   */
  async confirmSetup(userId: string, currentSessionId: string, code: unknown, request: RequestContext) {
    await this.assertTwoFactorAllowed();
    await this.rateLimiter.consume(RATE_LIMIT_KEY.twoFactorPerUser(userId), RATE_LIMITS.twoFactorPerUser);
    const user = await this.users.getUserOrThrow(userId);
    if (user.isTwoFactorEnabled) throw new AuthError(AUTH_ERRORS.twoFactorAlreadyEnabled);

    const storedSecret = await this.database.getRepository(TwoFactorSecretEntity).findOne({ where: { userId, confirmedAt: IsNull() } });
    if (!storedSecret) throw new AuthError(AUTH_ERRORS.twoFactorSetupNotStarted);
    if (!(await this.checkAuthenticatorCode(storedSecret, code))) throw new AuthError(AUTH_ERRORS.invalidTwoFactorCode);

    await this.database.getRepository(TwoFactorSecretEntity).update({ userId }, { confirmedAt: new Date() });
    await this.database.getRepository(UserEntity).update({ id: userId }, { isTwoFactorEnabled: true });
    const backupCodes = await this.replaceBackupCodes(userId);
    await this.sessions.revokeAllSessions(userId, SESSION_END_REASON.twoFactorEnabled, currentSessionId);
    await this.events.record({ name: AUTH_EVENTS.twoFactorEnabled, userId, request });
    return { success: true as const, backupCodes };
  }

  /**
   * Turns 2FA off. Requires a current authenticator code or a backup code.
   *
   * @param userId - The signed-in user.
   * @param code - An authenticator code or a backup code.
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError TWO_FACTOR_NOT_ENABLED when 2FA is already off.
   * @throws AuthError INVALID_OTP when the code is wrong.
   */
  async disable(userId: string, code: unknown, request: RequestContext) {
    await this.rateLimiter.consume(RATE_LIMIT_KEY.twoFactorPerUser(userId), RATE_LIMITS.twoFactorPerUser);
    const user = await this.users.getUserOrThrow(userId);
    if (!user.isTwoFactorEnabled) throw new AuthError(AUTH_ERRORS.twoFactorNotEnabled);
    if (!(await this.checkAnyCode(userId, code))) throw new AuthError(AUTH_ERRORS.invalidTwoFactorCode);

    await this.removeTwoFactor(userId);
    await this.events.record({ name: AUTH_EVENTS.twoFactorDisabled, userId, request });
    return { success: true as const };
  }

  /**
   * Replaces all backup codes (e.g. the user lost the list). The old codes stop working.
   *
   * @param userId - The signed-in user.
   * @param code - An authenticator code or a backup code.
   * @returns The new plain backup codes.
   * @throws AuthError TWO_FACTOR_NOT_ENABLED when 2FA is off.
   * @throws AuthError INVALID_OTP when the code is wrong.
   */
  async regenerateBackupCodes(userId: string, code: unknown) {
    await this.rateLimiter.consume(RATE_LIMIT_KEY.twoFactorPerUser(userId), RATE_LIMITS.twoFactorPerUser);
    const user = await this.users.getUserOrThrow(userId);
    if (!user.isTwoFactorEnabled) throw new AuthError(AUTH_ERRORS.twoFactorNotEnabled);
    if (!(await this.checkAnyCode(userId, code))) throw new AuthError(AUTH_ERRORS.invalidTwoFactorCode);
    return { success: true as const, backupCodes: await this.replaceBackupCodes(userId) };
  }

  /**
   * Counts the unused backup codes (show a warning when it gets low).
   *
   * @param userId - The user to check.
   * @returns How many backup codes are left.
   */
  async countRemainingBackupCodes(userId: string): Promise<number> {
    return this.database.getRepository(BackupCodeEntity).count({ where: { userId, usedAt: IsNull() } });
  }

  /**
   * Admin: turns 2FA off for a user who lost their phone and backup codes.
   * Only call this after checking who the user is some other way.
   *
   * @param userId - The user whose 2FA is removed.
   * @param adminUserId - The admin doing it (recorded in the audit log).
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when the user doesn't exist.
   */
  async resetForUser(userId: string, adminUserId: string, request: RequestContext) {
    await this.users.getUserOrThrow(userId);
    await this.removeTwoFactor(userId);
    await this.events.record({
      name: AUTH_EVENTS.twoFactorDisabled,
      userId,
      performedBy: PERFORMED_BY.admin(adminUserId),
      request,
      details: { resetByAdmin: true },
    });
    return { success: true as const };
  }

  // -------------------------------------------------------------------------------------------
  // The second step of sign-in
  // -------------------------------------------------------------------------------------------

  /**
   * The second step of sign-in: checks the code for a challenge token returned by the first step.
   *
   * @param challengeToken - The "ch_..." token from `{ status: "two_factor_required" }`.
   * @param code - An authenticator code or a backup code.
   * @param request - Who is asking (for rate limits, sessions and the audit log).
   * @returns The signed-in result with access and refresh tokens.
   * @throws AuthError INVALID_TOKEN when the challenge is unknown, used, expired or burnt by wrong codes.
   * @throws AuthError INVALID_OTP when the code is wrong.
   */
  async verifySignInChallenge(challengeToken: unknown, code: unknown, request: RequestContext): Promise<SignedInResult> {
    const settings = await this.settingsService.getSettings();
    const challenge = await this.challenges.findOpenChallenge(challengeToken, CHALLENGE_PURPOSE.twoFactor);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.twoFactorPerUser(challenge.userId), RATE_LIMITS.twoFactorPerUser);

    if (!(await this.checkAnyCode(challenge.userId, code))) {
      await this.challenges.recordFailedAttempt(challenge.challengeId);
      await this.signIn.recordFailedSignIn(challenge.userId, challenge.signInMethod, SIGN_IN_FAILURE_REASON.wrongTwoFactorCode, request);
      throw new AuthError(AUTH_ERRORS.invalidTwoFactorCode);
    }
    if (!(await this.challenges.markChallengeUsed(challenge.challengeId))) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);

    const user = await this.users.getUserOrThrow(challenge.userId);
    return this.signIn.finishTwoFactorSignIn(user, challenge.signInMethod, request, settings);
  }

  // -------------------------------------------------------------------------------------------

  /**
   * @throws AuthError FEATURE_DISABLED when 2FA is turned off in settings.
   */
  private async assertTwoFactorAllowed() {
    const settings = await this.settingsService.getSettings();
    if (!settings.twoFactor.enabled) throw new AuthError(AUTH_ERRORS.featureDisabled);
  }

  /**
   * Accepts a 6-digit authenticator code, or a backup code (which is then used up).
   *
   * @param userId - The user the code belongs to.
   * @param code - What the user typed.
   * @returns True when the code was correct.
   */
  private async checkAnyCode(userId: string, code: unknown): Promise<boolean> {
    if (typeof code !== 'string') return false;
    const storedSecret = await this.database
      .getRepository(TwoFactorSecretEntity)
      .findOne({ where: { userId } });
    if (storedSecret?.confirmedAt && (await this.checkAuthenticatorCode(storedSecret, code))) return true;
    return this.useBackupCode(userId, code);
  }

  /**
   * Checks an authenticator code and remembers its time step, so the same code can't be used twice.
   * The UPDATE only succeeds if no newer code was accepted meanwhile (two requests at once).
   *
   * @param storedSecret - The user's row with the encrypted secret.
   * @param code - What the user typed.
   * @returns True when the code was correct and not used before.
   */
  private async checkAuthenticatorCode(storedSecret: TwoFactorSecretEntity, code: unknown): Promise<boolean> {
    if (typeof code !== 'string') return false;
    const secret = await this.encryption.decrypt(storedSecret.encryptedSecret, this.encryptionContext(storedSecret.userId));
    const matchedTimeStep = verifyTotpCode(secret, code, storedSecret.lastUsedTimeStep);
    if (matchedTimeStep === null) return false;

    const result = await this.database
      .getRepository(TwoFactorSecretEntity)
      .createQueryBuilder()
      .update(TwoFactorSecretEntity)
      .set({ lastUsedTimeStep: matchedTimeStep })
      .where('user_id = :userId AND (last_used_time_step IS NULL OR last_used_time_step < :matchedTimeStep)', {
        userId: storedSecret.userId,
        matchedTimeStep,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Checks a backup code and marks it used, so it works only once.
   *
   * @param userId - The user the code belongs to.
   * @param typedCode - What the user typed; dashes, spaces and capitals are ignored.
   * @returns True when the code matched an unused backup code (and this request was the one to use it).
   */
  private async useBackupCode(userId: string, typedCode: string): Promise<boolean> {
    const normalizedCode = normalizeBackupCode(typedCode);
    const unusedCodes = await this.database.getRepository(BackupCodeEntity).find({ where: { userId, usedAt: IsNull() } });
    // Check every code (no early exit), so the time taken doesn't hint at which one matched.
    let matchingCode: BackupCodeEntity | undefined;
    for (const storedCode of unusedCodes) {
      if (constantTimeEquals(hashShortCode(normalizedCode, storedCode.salt), storedCode.codeHash)) matchingCode = storedCode;
    }
    if (!matchingCode) return false;
    const result = await this.database
      .getRepository(BackupCodeEntity)
      .update({ id: matchingCode.id, usedAt: IsNull() }, { usedAt: new Date() });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Deletes old backup codes and creates new ones. Only their hashes are stored.
   *
   * @param userId - The user to create codes for.
   * @returns The plain codes, formatted like "k7m2-x9p4", to show the user once.
   */
  private async replaceBackupCodes(userId: string): Promise<string[]> {
    const plainCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => createBackupCode());
    await this.database.transaction(async (transaction) => {
      await transaction.delete(BackupCodeEntity, { userId });
      await transaction.insert(
        BackupCodeEntity,
        plainCodes.map((code) => {
          const salt = createSalt();
          return { userId, salt, codeHash: hashShortCode(code, salt) };
        }),
      );
    });
    return plainCodes.map(
      (code) => [code.slice(0, BACKUP_CODE_DISPLAY_GROUP_LENGTH), code.slice(BACKUP_CODE_DISPLAY_GROUP_LENGTH)].join(BACKUP_CODE_DISPLAY_SEPARATOR),
    );
  }

  /**
   * Deletes the secret and backup codes and turns 2FA off, all in one transaction.
   *
   * @param userId - The user to turn 2FA off for.
   */
  private async removeTwoFactor(userId: string) {
    await this.database.transaction(async (transaction) => {
      await transaction.delete(TwoFactorSecretEntity, { userId });
      await transaction.delete(BackupCodeEntity, { userId });
      await transaction.update(UserEntity, { id: userId }, { isTwoFactorEnabled: false });
    });
  }

  /**
   * Binds the encrypted secret to its user, so a secret copied to another user's row won't decrypt.
   *
   * @param userId - The secret's owner.
   * @returns The context for `EncryptionService`.
   */
  private encryptionContext(userId: string) {
    return { purpose: ENCRYPTION_PURPOSE.totpSecret, userId };
  }
}
