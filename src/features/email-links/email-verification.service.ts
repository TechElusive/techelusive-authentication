import { Injectable } from '@nestjs/common';
import { AuthError } from '@/common/auth-error';
import { normalizeEmail } from '@/common/identifiers';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { RequestContext } from '@/common/request-context';
import {
  ACCOUNT_STATUS,
  AUTH_ERRORS,
  EMAIL_TYPE,
  LINK_PURPOSE,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  SUCCESS_MESSAGES,
} from '@/constants';
import { NotificationsService } from '@/features/notifications/notifications.service';
import { SettingsService } from '@/features/settings/settings.service';
import { UsersService } from '@/features/users/users.service';
import { LinkTokensService } from './link-tokens.service';

/**
 * Proves the user owns their email address by sending them a link with a single-use token.
 * Your app's page reads the token from the link and calls POST /auth/email/verify.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly linkTokens: LinkTokensService,
    private readonly notifications: NotificationsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /**
   * Sends (or re-sends) the verification link. Answers the same whether or not the email has an account.
   *
   * @param typedEmail - The email from the request.
   * @param request - Who is asking (for rate limits).
   * @returns A generic success message.
   * @throws AuthError TOO_MANY_REQUESTS after too many emails for this IP or address.
   */
  async sendVerificationEmail(typedEmail: unknown, request: RequestContext) {
    const email = normalizeEmail(typedEmail);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendEmailLinkPerIp(request.ipAddress), RATE_LIMITS.sendEmailLinkPerIp);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendEmailLinkPerEmail(email), RATE_LIMITS.sendEmailLinkPerEmail);

    const user = await this.users.findUserByEmail(email);
    const needsVerifying = user && !user.isEmailVerified && user.status !== ACCOUNT_STATUS.deleted && user.status !== ACCOUNT_STATUS.suspended;
    if (needsVerifying) {
      const token = await this.linkTokens.createLinkToken(LINK_PURPOSE.verifyEmail, email, user.id);
      await this.notifications.sendRequiredEmail({ type: EMAIL_TYPE.verifyEmail, to: email, token });
    }
    return { success: true as const, message: SUCCESS_MESSAGES.verificationEmailSent };
  }

  /**
   * Uses the token from the link. If this was the last verification the settings require, the
   * account becomes ACTIVE and the user can sign in.
   *
   * @param token - The token from the link.
   * @param request - Who is asking (for the audit log).
   * @returns The account's new status and anything still left to verify.
   * @throws AuthError INVALID_TOKEN when the link is unknown, used, expired, or the account's
   *   email has changed since it was sent.
   */
  async verifyEmail(token: unknown, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const usedToken = await this.linkTokens.useLinkToken(token, LINK_PURPOSE.verifyEmail);
    const user = usedToken.userId ? await this.users.findUserById(usedToken.userId) : null;

    // The account's email may have changed after this link was sent; then the link proves nothing.
    if (!user || user.email !== usedToken.email || user.status === ACCOUNT_STATUS.deleted) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);

    const verifiedUser = await this.users.markEmailVerified(user, settings, request);
    return {
      success: true as const,
      message: SUCCESS_MESSAGES.emailVerified,
      status: verifiedUser.status,
      pendingVerifications: this.users.getPendingVerifications(verifiedUser, settings),
    };
  }
}
