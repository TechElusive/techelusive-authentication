import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { isEmailDomainAllowed, maskEmail, normalizeEmail } from '@/common/identifiers';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { RequestContext } from '@/common/request-context';
import {
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  EMAIL_TYPE,
  LINK_PURPOSE,
  POSTGRES_UNIQUE_VIOLATION_CODE,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  RECENT_SIGN_IN_SECONDS,
  SECOND_IN_MILLISECONDS,
  SUCCESS_MESSAGES,
} from '@/constants';
import { PasswordEntity, SessionEntity, UserEntity } from '@/database/entities';
import { LinkTokensService } from '@/features/email-links/link-tokens.service';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { NotificationsService } from '@/features/notifications/notifications.service';
import { PasswordPolicyService } from '@/features/passwords/password-policy.service';
import { SettingsService } from '@/features/settings/settings.service';
import { UsersService } from '@/features/users/users.service';

/** Links sent to the old address stop working once the email changes. */
const LINKS_FOR_THE_OLD_ADDRESS = [LINK_PURPOSE.verifyEmail, LINK_PURPOSE.resetPassword, LINK_PURPOSE.magicSignIn] as const;

/**
 * Changing the email of an account:
 * - POST /auth/email/change (signed in) checks it's really the owner (current password, or a
 *   recent sign-in for accounts without one) and emails a confirmation link to the NEW address.
 *   It answers the same whether or not that address already belongs to someone, so it can't be
 *   used to find out who has an account.
 * - POST /auth/email/change/confirm (the link) switches the email, marks it verified and tells
 *   the OLD address, so an unwanted change gets noticed.
 */
@Injectable()
export class EmailChangeService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly linkTokens: LinkTokensService,
    private readonly notifications: NotificationsService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly events: AuthEventsService,
    private readonly rateLimiter: RateLimiterService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Starts an email change: checks it's really the owner and emails a confirmation link to the NEW address.
   * Answers the same whether or not that address already belongs to someone.
   * Only one change can be pending: a newer request cancels the older link.
   *
   * @param userId - The signed-in user.
   * @param sessionId - This device's session (used for the "recent sign-in" check).
   * @param typedNewEmail - The new email address.
   * @param currentPassword - Required when the account has a password.
   * @param request - Who is asking (for the audit log).
   * @returns A generic success message.
   * @throws AuthError EMAIL_UNCHANGED when the new email is the current one.
   * @throws AuthError EMAIL_DOMAIN_NOT_ALLOWED when the domain is not in the allowed list.
   * @throws AuthError INVALID_CREDENTIALS or RECENT_SIGN_IN_REQUIRED (see `confirmOwner`).
   */
  async requestEmailChange(userId: string, sessionId: string, typedNewEmail: unknown, currentPassword: unknown, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    await this.rateLimiter.consume(RATE_LIMIT_KEY.changeEmailPerUser(userId), RATE_LIMITS.changeEmailPerUser);
    const user = await this.users.getUserOrThrow(userId);
    const newEmail = normalizeEmail(typedNewEmail);

    if (newEmail === user.email) throw new AuthError(AUTH_ERRORS.emailUnchanged);
    if (!isEmailDomainAllowed(newEmail, settings.registration.allowedEmailDomains)) throw new AuthError(AUTH_ERRORS.emailDomainNotAllowed);
    await this.confirmOwner(user, sessionId, currentPassword);

    // Only one change can be pending: a newer request cancels the older link.
    await this.linkTokens.cancelLinkTokens(LINK_PURPOSE.changeEmail, userId);
    const addressIsFree = (await this.users.findUserByEmail(newEmail)) === null;
    if (addressIsFree) {
      const token = await this.linkTokens.createLinkToken(LINK_PURPOSE.changeEmail, newEmail, userId);
      await this.notifications.sendRequiredEmail({ type: EMAIL_TYPE.confirmEmailChange, to: newEmail, token });
    }
    await this.events.record({
      name: AUTH_EVENTS.emailChangeRequested,
      userId,
      request,
      details: { newEmail: maskEmail(newEmail) },
    });
    return { success: true as const, message: SUCCESS_MESSAGES.emailChangeRequested };
  }

  /**
   * Finishes an email change (the emailed link): switches the email, marks it verified, cancels links sent to the old address,
   * and tells the OLD address so an unwanted change gets noticed.
   *
   * @param token - The token from the confirmation link.
   * @param request - Who is asking (for the audit log).
   * @returns A success message and the updated profile.
   * @throws AuthError INVALID_TOKEN when the link is unknown, used or expired.
   * @throws AuthError EMAIL_IN_USE when someone took the address after the link was sent.
   */
  async confirmEmailChange(token: unknown, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const { userId, email: newEmail } = await this.linkTokens.useLinkToken(token, LINK_PURPOSE.changeEmail);
    if (!userId) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    const user = await this.users.getUserOrThrow(userId);
    const previousEmail = user.email;

    try {
      await this.database.getRepository(UserEntity).update({ id: userId }, { email: newEmail, isEmailVerified: true });
    } catch (error) {
      // Someone else took the address between the request and the click.
      if (error instanceof QueryFailedError && (error as QueryFailedError & { code?: string }).code === POSTGRES_UNIQUE_VIOLATION_CODE) {
        throw new AuthError(AUTH_ERRORS.emailInUse);
      }
      throw error;
    }
    user.email = newEmail;
    user.isEmailVerified = true;

    for (const purpose of LINKS_FOR_THE_OLD_ADDRESS) await this.linkTokens.cancelLinkTokens(purpose, userId);
    if (previousEmail) {
      await this.notifications.sendNoticeEmail({ type: EMAIL_TYPE.emailChanged, to: previousEmail, newEmail: maskEmail(newEmail) });
    }
    await this.events.record({
      name: AUTH_EVENTS.emailChanged,
      userId,
      request,
      details: { previousEmail: previousEmail ? maskEmail(previousEmail) : null, newEmail: maskEmail(newEmail) },
    });

    // A pending account waiting only for a verified email becomes ACTIVE here.
    const updatedUser = await this.users.activateIfReady(user, settings, request);
    return { success: true as const, message: SUCCESS_MESSAGES.emailChanged, user: this.users.toPublicProfile(updatedUser, settings) };
  }

  /**
   * A stolen access token alone must not be enough to take over the account by changing its
   * email. Accounts with a password must type it; others must have signed in in the last minutes.
   *
   * @param user - The signed-in user.
   * @param sessionId - This device's session.
   * @param currentPassword - What the user typed as their current password.
   * @throws AuthError INVALID_CREDENTIALS when the password is wrong.
   * @throws AuthError RECENT_SIGN_IN_REQUIRED when a password-less user signed in too long ago.
   */
  private async confirmOwner(user: UserEntity, sessionId: string, currentPassword: unknown): Promise<void> {
    const storedPassword = await this.database.getRepository(PasswordEntity).findOne({ where: { userId: user.id } });
    if (storedPassword) {
      if (!(await this.passwordPolicy.verifyPassword(storedPassword.passwordHash, currentPassword))) {
        throw new AuthError(AUTH_ERRORS.invalidCredentials);
      }
      return;
    }
    const session = await this.database.getRepository(SessionEntity).findOne({ where: { id: sessionId, userId: user.id } });
    const secondsSinceSignIn = session ? (Date.now() - session.createdAt.getTime()) / SECOND_IN_MILLISECONDS : Infinity;
    if (secondsSinceSignIn > RECENT_SIGN_IN_SECONDS) throw new AuthError(AUTH_ERRORS.recentSignInRequired);
  }
}
