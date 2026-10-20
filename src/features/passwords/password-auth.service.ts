import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { isEmailDomainAllowed, normalizeEmail, normalizePhoneNumber } from '@/common/identifiers';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { RequestContext } from '@/common/request-context';
import {
  ACCOUNT_STATUS,
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  EMAIL_TYPE,
  LINK_PURPOSE,
  type PasswordChangeKind,
  PASSWORD_CHANGE_KIND,
  PASSWORD_REQUIREMENT,
  PENDING_VERIFICATION,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  SESSION_END_REASON,
  SIGN_IN_FAILURE_REASON,
  SIGN_IN_METHOD,
  SIGN_IN_STATUS,
  SUCCESS_MESSAGES,
  VALIDATION_PROBLEM,
} from '@/constants';
import { PasswordEntity, UserEntity } from '@/database/entities';
import { LinkTokensService } from '@/features/email-links/link-tokens.service';
import { EmailVerificationService } from '@/features/email-links/email-verification.service';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { NotificationsService } from '@/features/notifications/notifications.service';
import { SessionService } from '@/features/sessions/session.service';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthSettings } from '@/features/settings/settings.types';
import { SignInService } from '@/features/sign-in/sign-in.service';
import { SignInResult } from '@/features/sign-in/sign-in.types';
import { UsersService } from '@/features/users/users.service';
import { PendingVerification } from '@/features/users/users.types';
import { RegisterInput } from './password.dto';
import { PasswordPolicyService } from './password-policy.service';

/** What POST /auth/register returns when the user still has to verify something. */
export interface RegisteredResult {
  success: true;
  status: typeof SIGN_IN_STATUS.verificationRequired;
  message: string;
  pendingVerifications: PendingVerification[];
}

/**
 * Email + password: register, sign in, forgot / reset password, change password.
 */
@Injectable()
export class PasswordAuthService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly users: UsersService,
    private readonly signIn: SignInService,
    private readonly sessions: SessionService,
    private readonly linkTokens: LinkTokensService,
    private readonly emailVerification: EmailVerificationService,
    private readonly notifications: NotificationsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Creates an account.
   *
   * - If the settings require no verification, the user is signed in straight away.
   * - Otherwise a verification email is sent and the response says what to verify next.
   * - If the email is already registered, the response looks exactly like a new sign-up
   *   (no account is created), so nobody can use this form to find out who has an account.
   *
   * @param input - The sign-up form: email, password, and optional phone, names and consents.
   * @param request - Who is asking (for rate limits and the audit log).
   * @returns Tokens when the account is active at once, otherwise `status: "verification_required"`.
   * @throws AuthError SIGN_UP_CLOSED, EMAIL_DOMAIN_NOT_ALLOWED, TERMS_NOT_ACCEPTED... when a sign-up rule fails.
   * @throws AuthError INVALID_PASSWORD when the password breaks a rule or appeared in a data breach.
   * @throws AuthError TOO_MANY_REQUESTS after too many sign-ups from one IP.
   */
  async register(input: RegisterInput, request: RequestContext): Promise<SignInResult | RegisteredResult> {
    const settings = await this.getPasswordSettings();
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signUpPerIp(request.ipAddress), RATE_LIMITS.signUpPerIp);

    const email = normalizeEmail(input.email);
    const phoneNumber = input.phoneNumber ? normalizePhoneNumber(input.phoneNumber) : null;
    this.assertRegistrationRules(input, email, phoneNumber, settings);
    const password = await this.passwordPolicy.assertPasswordIsAcceptable(input.password, settings);

    const genericResult: RegisteredResult = {
      success: true,
      status: SIGN_IN_STATUS.verificationRequired,
      message: SUCCESS_MESSAGES.registered,
      pendingVerifications: this.newAccountVerifications(phoneNumber, settings),
    };

    const existingUser = await this.users.findUserByEmail(email);
    if (existingUser) {
      // Help a real owner who never finished verifying; tell a stranger nothing.
      if (!existingUser.isEmailVerified) await this.emailVerification.sendVerificationEmail(email, request);
      return genericResult;
    }

    const passwordHash = await this.passwordPolicy.hashPassword(password);
    const newUser = await this.database.transaction(async (transaction) => {
      const createdUser = await this.users.createUser(
        {
          email,
          phoneNumber,
          firstName: input.firstName?.trim() || null,
          lastName: input.lastName?.trim() || null,
          acceptedTerms: input.acceptTerms === true,
          acceptedPrivacyPolicy: input.acceptPrivacyPolicy === true,
        },
        settings,
        request,
        transaction,
      );
      await transaction.insert(PasswordEntity, { userId: createdUser.id, passwordHash });
      return createdUser;
    });

    if (newUser.status === ACCOUNT_STATUS.active) return this.signIn.completeSignIn(newUser, SIGN_IN_METHOD.password, request, settings);

    if (this.users.getPendingVerifications(newUser, settings).includes(PENDING_VERIFICATION.email)) {
      await this.emailVerification.sendVerificationEmail(email, request);
    }
    return genericResult;
  }

  /**
   * Signs in with email + password. Wrong email and wrong password give the same error.
   *
   * @param typedEmail - The email from the request.
   * @param typedPassword - The password from the request.
   * @param request - Who is asking (for rate limits and the audit log).
   * @returns Tokens, or a 2FA challenge when the user has 2FA on.
   * @throws AuthError INVALID_CREDENTIALS when the email or password is wrong.
   * @throws AuthError TOO_MANY_REQUESTS after too many attempts for this IP or account.
   */
  async signInWithPassword(typedEmail: unknown, typedPassword: unknown, request: RequestContext): Promise<SignInResult> {
    const settings = await this.getPasswordSettings();
    const email = normalizeEmail(typedEmail);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signInPerIp(request.ipAddress), RATE_LIMITS.signInPerIp);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signInPerAccount(email), RATE_LIMITS.signInPerAccount);

    const user = await this.users.findUserByEmail(email);
    const storedPassword = user
      ? await this.database.getRepository(PasswordEntity).findOne({ where: { userId: user.id } })
      : null;

    // Always run the slow hash check, even with no account, so response time reveals nothing.
    const isPasswordRight = await this.passwordPolicy.verifyPassword(storedPassword?.passwordHash ?? null, typedPassword);
    if (!user || !storedPassword || !isPasswordRight) {
      await this.signIn.recordFailedSignIn(user?.id ?? null, SIGN_IN_METHOD.password, SIGN_IN_FAILURE_REASON.wrongEmailOrPassword, request);
      throw new AuthError(AUTH_ERRORS.invalidCredentials);
    }

    await this.rateLimiter.reset(RATE_LIMIT_KEY.signInPerAccount(email));
    if (this.passwordPolicy.needsRehash(storedPassword.passwordHash)) {
      await this.savePassword(user.id, typedPassword as string);
    }
    return this.signIn.completeSignIn(user, SIGN_IN_METHOD.password, request, settings);
  }

  /**
   * Emails a password reset link. Always answers the same, whether or not the email has an account.
   *
   * @param typedEmail - The email from the request.
   * @param request - Who is asking (for rate limits and the audit log).
   * @returns A generic success message.
   * @throws AuthError TOO_MANY_REQUESTS after too many emails for this IP or address.
   */
  async requestPasswordReset(typedEmail: unknown, request: RequestContext) {
    await this.getPasswordSettings();
    const email = normalizeEmail(typedEmail);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendEmailLinkPerIp(request.ipAddress), RATE_LIMITS.sendEmailLinkPerIp);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendEmailLinkPerEmail(email), RATE_LIMITS.sendEmailLinkPerEmail);

    const user = await this.users.findUserByEmail(email);
    if (user && user.status !== ACCOUNT_STATUS.deleted && user.status !== ACCOUNT_STATUS.suspended) {
      const token = await this.linkTokens.createLinkToken(LINK_PURPOSE.resetPassword, email, user.id);
      await this.notifications.sendRequiredEmail({ type: EMAIL_TYPE.resetPassword, to: email, token });
      await this.events.record({ name: AUTH_EVENTS.passwordResetRequested, userId: user.id, request });
    }
    return { success: true as const, message: SUCCESS_MESSAGES.passwordResetEmailSent };
  }

  /**
   * Sets a new password from a reset link. Signs the user out everywhere (whoever knew the old
   * password is kicked out) and marks the email verified (the user just proved they read it).
   *
   * @param resetToken - The token from the link in the email.
   * @param newPassword - The new password.
   * @param request - Who is asking (for the audit log).
   * @returns A success message. The user signs in again with the new password.
   * @throws AuthError INVALID_TOKEN when the link is unknown, used, expired, or the
   *   account's email has changed since it was sent.
   * @throws AuthError INVALID_PASSWORD when the new password breaks a rule or appeared in a data breach.
   */
  async resetPassword(resetToken: unknown, newPassword: unknown, request: RequestContext) {
    const settings = await this.getPasswordSettings();
    const password = await this.passwordPolicy.assertPasswordIsAcceptable(newPassword, settings);
    const usedToken = await this.linkTokens.useLinkToken(resetToken, LINK_PURPOSE.resetPassword);

    const user = usedToken.userId ? await this.users.findUserById(usedToken.userId) : null;
    // The email may have changed, or the account been deleted, since the link was sent.
    if (!user || user.email !== usedToken.email || user.status === ACCOUNT_STATUS.deleted) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);

    await this.savePassword(user.id, password);
    await this.linkTokens.cancelLinkTokens(LINK_PURPOSE.resetPassword, user.id);
    await this.sessions.revokeAllSessions(user.id, SESSION_END_REASON.passwordReset);
    await this.users.markEmailVerified(user, settings, request);
    await this.afterPasswordChanged(user, settings, request, PASSWORD_CHANGE_KIND.reset);
    return { success: true as const, message: SUCCESS_MESSAGES.passwordReset };
  }

  /**
   * Changes the password of a signed-in user (they must type the current one).
   * Users who signed up with Google etc. have no password yet and may set one without it.
   * Other devices are signed out; this one stays signed in.
   *
   * @param userId - The signed-in user.
   * @param sessionId - This device's session, which stays signed in.
   * @param currentPassword - The current password (ignored when the user has none yet).
   * @param newPassword - The new password.
   * @param request - Who is asking (for the audit log).
   * @returns A success message.
   * @throws AuthError INVALID_CREDENTIALS when the current password is wrong.
   * @throws AuthError INVALID_PASSWORD when the new password breaks a rule or equals the current one.
   */
  async changePassword(userId: string, sessionId: string, currentPassword: unknown, newPassword: unknown, request: RequestContext) {
    const settings = await this.getPasswordSettings();
    await this.rateLimiter.consume(RATE_LIMIT_KEY.changePasswordPerUser(userId), RATE_LIMITS.changePasswordPerUser);
    const user = await this.users.getUserOrThrow(userId);

    const storedPassword = await this.database.getRepository(PasswordEntity).findOne({ where: { userId } });
    if (storedPassword && !(await this.passwordPolicy.verifyPassword(storedPassword.passwordHash, currentPassword))) {
      throw new AuthError(AUTH_ERRORS.invalidCredentials);
    }
    const password = await this.passwordPolicy.assertPasswordIsAcceptable(newPassword, settings);
    if (storedPassword && (await this.passwordPolicy.verifyPassword(storedPassword.passwordHash, password))) {
      throw new AuthError(AUTH_ERRORS.invalidPassword, { requirements: [PASSWORD_REQUIREMENT.differentFromCurrent] });
    }

    await this.savePassword(userId, password);
    await this.sessions.revokeAllSessions(userId, SESSION_END_REASON.passwordChanged, sessionId);
    await this.afterPasswordChanged(user, settings, request, storedPassword ? PASSWORD_CHANGE_KIND.changed : PASSWORD_CHANGE_KIND.firstSet);
    return { success: true as const, message: SUCCESS_MESSAGES.passwordChanged };
  }

  // -------------------------------------------------------------------------------------------

  /**
   * @returns The current settings.
   * @throws AuthError SIGN_IN_METHOD_DISABLED when email + password is turned off.
   */
  private async getPasswordSettings(): Promise<AuthSettings> {
    const settings = await this.settingsService.getSettings();
    if (!settings.password.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    return settings;
  }

  /**
   * Checks the sign-up form against the registration rules in settings.
   *
   * @param input - The sign-up form.
   * @param email - The normalized email.
   * @param phoneNumber - The normalized phone number, or null.
   * @param settings - The current settings.
   * @throws AuthError for the first rule that fails (SIGN_UP_CLOSED, EMAIL_DOMAIN_NOT_ALLOWED,
   *   INVALID_PHONE, VALIDATION_ERROR, TERMS_NOT_ACCEPTED, PRIVACY_POLICY_NOT_ACCEPTED).
   */
  private assertRegistrationRules(input: RegisterInput, email: string, phoneNumber: string | null, settings: AuthSettings) {
    const rules = settings.registration;
    if (!rules.enabled) throw new AuthError(AUTH_ERRORS.signUpClosed);
    if (!isEmailDomainAllowed(email, rules.allowedEmailDomains)) throw new AuthError(AUTH_ERRORS.emailDomainNotAllowed);
    if (rules.requirePhoneNumber && !phoneNumber) throw new AuthError(AUTH_ERRORS.invalidPhone);
    if (rules.requireFirstAndLastName && (!input.firstName?.trim() || !input.lastName?.trim())) {
      throw new AuthError(AUTH_ERRORS.validationFailed, { problems: [VALIDATION_PROBLEM.namesRequired] });
    }
    if (rules.requireTermsAcceptance && input.acceptTerms !== true) throw new AuthError(AUTH_ERRORS.termsNotAccepted);
    if (rules.requirePrivacyPolicyAcceptance && input.acceptPrivacyPolicy !== true) throw new AuthError(AUTH_ERRORS.privacyPolicyNotAccepted);
  }

  /**
   * The verifications a brand-new email + password account will need (same answer for everyone,
   * so the response can't reveal whether the email was already registered).
   *
   * @param phoneNumber - The phone number from the form, or null.
   * @param settings - The current settings.
   * @returns e.g. ["email"] or ["email", "phone"].
   */
  private newAccountVerifications(phoneNumber: string | null, settings: AuthSettings): PendingVerification[] {
    const pending: PendingVerification[] = [];
    if (settings.activation.requireVerifiedEmail) pending.push(PENDING_VERIFICATION.email);
    if (settings.activation.requireVerifiedPhone && phoneNumber) pending.push(PENDING_VERIFICATION.phone);
    return pending;
  }

  /**
   * Hashes the password and stores it, replacing any old one.
   *
   * @param userId - The user.
   * @param password - The plain password (already checked against the rules).
   */
  private async savePassword(userId: string, password: string) {
    const passwordHash = await this.passwordPolicy.hashPassword(password);
    await this.database.getRepository(PasswordEntity).upsert({ userId, passwordHash }, ['userId']);
  }

  /**
   * Records the change in the audit log and, if enabled, emails the user that it happened.
   *
   * @param user - The user whose password changed.
   * @param settings - The current settings.
   * @param request - Who made the change.
   * @param how - "reset", "changed" or "first_set".
   */
  private async afterPasswordChanged(user: UserEntity, settings: AuthSettings, request: RequestContext, how: PasswordChangeKind) {
    await this.events.record({ name: AUTH_EVENTS.passwordChanged, userId: user.id, request, details: { how } });
    if (settings.password.notifyOnChange && user.email) {
      await this.notifications.sendNoticeEmail({ type: EMAIL_TYPE.passwordChanged, to: user.email });
    }
  }
}
