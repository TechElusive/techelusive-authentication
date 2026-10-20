import { Injectable } from '@nestjs/common';
import { AuthError } from '@/common/auth-error';
import { isEmailDomainAllowed, isPhoneCountryAllowed, normalizeEmail, normalizePhoneNumber } from '@/common/identifiers';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { RequestContext } from '@/common/request-context';
import {
  ACCOUNT_STATUS,
  AUTH_ERRORS,
  CODE_CHANNEL,
  EMAIL_TYPE,
  LINK_PURPOSE,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  SIGN_IN_METHOD,
  SUCCESS_MESSAGES,
} from '@/constants';
import { UserEntity } from '@/database/entities';
import { LinkTokensService } from '@/features/email-links/link-tokens.service';
import { NotificationsService } from '@/features/notifications/notifications.service';
import { OneTimeCodesService } from '@/features/one-time-codes/one-time-codes.service';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthSettings } from '@/features/settings/settings.types';
import { SignInService } from '@/features/sign-in/sign-in.service';
import { SignInResult } from '@/features/sign-in/sign-in.types';
import { assertSignUpDetailsComplete } from '@/features/users/sign-up-rules';
import { UsersService } from '@/features/users/users.service';
import { SignUpDetailsInput } from './passwordless.dto';

/**
 * Users who may receive a code or link: anyone except suspended and deleted accounts.
 *
 * @param user - An existing account.
 * @returns True when a sign-in message may be sent to this user.
 */
const canReceiveSignInMessages = (user: UserEntity) => user.status !== ACCOUNT_STATUS.suspended && user.status !== ACCOUNT_STATUS.deleted;

/**
 * Sign in without a password:
 * - Email OTP: a 6-digit code by email.
 * - Magic link: a one-click link by email.
 * - Phone OTP: a 6-digit code by SMS.
 *
 * The same endpoints also VERIFY the email / phone of an existing account, because receiving the
 * code proves ownership. If the settings allow sign-up, an unknown email / phone gets a new account.
 *
 * "Send" endpoints always answer the same, so they never reveal who has an account.
 */
@Injectable()
export class PasswordlessAuthService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly signIn: SignInService,
    private readonly oneTimeCodes: OneTimeCodesService,
    private readonly linkTokens: LinkTokensService,
    private readonly notifications: NotificationsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Email OTP
  // -------------------------------------------------------------------------------------------

  /**
   * Emails a 6-digit sign-in code. Always answers the same, whether or not the email has an account.
   *
   * @param typedEmail - The email from the request.
   * @param request - Who is asking (for rate limits).
   * @returns A generic success message.
   * @throws AuthError SIGN_IN_METHOD_DISABLED when email codes are turned off.
   * @throws AuthError TOO_MANY_REQUESTS (with `retryAfterSeconds`) when a code was sent to this email a moment ago.
   * @throws AuthError TOO_MANY_REQUESTS after too many codes for this IP or email.
   */
  async sendEmailCode(typedEmail: unknown, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    if (!settings.emailOtp.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    const email = normalizeEmail(typedEmail);
    await this.consumeSendLimits(email, request);

    if (await this.mayReceiveMessage(await this.users.findUserByEmail(email), settings.emailOtp.allowSignUp, email, settings)) {
      const code = await this.oneTimeCodes.createCode(CODE_CHANNEL.email, email, settings.emailOtp);
      await this.notifications.sendRequiredEmail({ type: EMAIL_TYPE.signInCode, to: email, code });
    }
    return { success: true as const, message: SUCCESS_MESSAGES.codeSent };
  }

  /**
   * Signs in with an email code. This also verifies the email, and creates the account when the
   * email is new and sign-up is allowed.
   *
   * @param typedEmail - The email the code was sent to.
   * @param code - The code the user typed.
   * @param signUpDetails - Names and consents, only needed when this creates a new account.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   * @throws AuthError OTP_EXPIRED or INVALID_OTP when the code is not usable or wrong.
   * @throws AuthError SIGN_UP_CLOSED when the email is new and sign-up is not allowed.
   */
  async verifyEmailCode(typedEmail: unknown, code: unknown, signUpDetails: SignUpDetailsInput, request: RequestContext): Promise<SignInResult> {
    const settings = await this.settingsService.getSettings();
    if (!settings.emailOtp.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    const email = normalizeEmail(typedEmail);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signInPerIp(request.ipAddress), RATE_LIMITS.signInPerIp);

    const existingUser = await this.users.findUserByEmail(email);
    // Check sign-up details BEFORE using the code, so a missing name doesn't burn it.
    if (!existingUser) this.assertMaySignUp(settings.emailOtp.allowSignUp, signUpDetails, settings, email);
    await this.oneTimeCodes.verifyCode(CODE_CHANNEL.email, email, code);

    if (existingUser) await this.users.removeUnprovenPassword(existingUser, request);
    const user = existingUser ?? (await this.createVerifiedUser({ email }, signUpDetails, settings, request));
    const verifiedUser = await this.users.markEmailVerified(user, settings, request);
    return this.signIn.completeSignIn(verifiedUser, SIGN_IN_METHOD.emailOtp, request, settings);
  }

  // -------------------------------------------------------------------------------------------
  // Magic link
  // -------------------------------------------------------------------------------------------

  /**
   * Emails a one-click sign-in link. Always answers the same, whether or not the email has an account.
   *
   * @param typedEmail - The email from the request.
   * @param request - Who is asking (for rate limits).
   * @returns A generic success message.
   * @throws AuthError SIGN_IN_METHOD_DISABLED when magic links are turned off.
   * @throws AuthError TOO_MANY_REQUESTS after too many emails for this IP or address.
   */
  async sendMagicLink(typedEmail: unknown, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    if (!settings.magicLink.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    const email = normalizeEmail(typedEmail);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendEmailLinkPerIp(request.ipAddress), RATE_LIMITS.sendEmailLinkPerIp);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendEmailLinkPerEmail(email), RATE_LIMITS.sendEmailLinkPerEmail);

    const user = await this.users.findUserByEmail(email);
    if (await this.mayReceiveMessage(user, settings.magicLink.allowSignUp, email, settings)) {
      const token = await this.linkTokens.createLinkToken(LINK_PURPOSE.magicSignIn, email, user?.id ?? null);
      await this.notifications.sendRequiredEmail({ type: EMAIL_TYPE.magicSignIn, to: email, token });
    }
    return { success: true as const, message: SUCCESS_MESSAGES.magicLinkSent };
  }

  /**
   * Signs in with the token from a magic link. This also verifies the email, and creates the account
   * when the email is new and sign-up is allowed.
   *
   * @param token - The token from the link.
   * @param signUpDetails - Names and consents, only needed when this creates a new account.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   * @throws AuthError INVALID_TOKEN when the link is unknown, used or expired.
   * @throws AuthError SIGN_UP_CLOSED when the email is new and sign-up is not allowed.
   */
  async verifyMagicLink(token: unknown, signUpDetails: SignUpDetailsInput, request: RequestContext): Promise<SignInResult> {
    const settings = await this.settingsService.getSettings();
    if (!settings.magicLink.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signInPerIp(request.ipAddress), RATE_LIMITS.signInPerIp);

    const usedToken = await this.linkTokens.useLinkToken(token, LINK_PURPOSE.magicSignIn);
    // Look up by email, not the id stored in the token, so a link sent before sign-up still works.
    const existingUser = await this.users.findUserByEmail(usedToken.email);
    if (!existingUser) this.assertMaySignUp(settings.magicLink.allowSignUp, signUpDetails, settings, usedToken.email);

    if (existingUser) await this.users.removeUnprovenPassword(existingUser, request);
    const user = existingUser ?? (await this.createVerifiedUser({ email: usedToken.email }, signUpDetails, settings, request));
    const verifiedUser = await this.users.markEmailVerified(user, settings, request);
    return this.signIn.completeSignIn(verifiedUser, SIGN_IN_METHOD.magicLink, request, settings);
  }

  // -------------------------------------------------------------------------------------------
  // Phone OTP
  // -------------------------------------------------------------------------------------------

  /**
   * Sends a 6-digit sign-in code by SMS. Always answers the same, whether or not the number has an account.
   *
   * @param typedPhoneNumber - The phone number from the request, with country code.
   * @param request - Who is asking (for rate limits).
   * @returns A generic success message.
   * @throws AuthError PHONE_COUNTRY_NOT_ALLOWED when the country code is not in the allowed list.
   * @throws AuthError TOO_MANY_REQUESTS (with `retryAfterSeconds`) when a code was sent to this number a moment ago.
   */
  async sendPhoneCode(typedPhoneNumber: unknown, request: RequestContext) {
    const settings = await this.getPhoneSettings();
    const phoneNumber = normalizePhoneNumber(typedPhoneNumber);
    if (!isPhoneCountryAllowed(phoneNumber, settings.phoneOtp.allowedCountryCodes)) throw new AuthError(AUTH_ERRORS.phoneCountryNotAllowed);
    await this.consumeSendLimits(phoneNumber, request);

    const user = await this.users.findUserByPhoneNumber(phoneNumber);
    const mayReceive = user ? canReceiveSignInMessages(user) : settings.phoneOtp.allowSignUp && settings.registration.enabled;
    if (mayReceive) {
      const code = await this.oneTimeCodes.createCode(CODE_CHANNEL.sms, phoneNumber, settings.phoneOtp);
      await this.notifications.sendSmsCode(phoneNumber, code);
    }
    return { success: true as const, message: SUCCESS_MESSAGES.codeSent };
  }

  /**
   * Signs in with an SMS code. This also verifies the phone number, and creates the account when the
   * number is new and sign-up is allowed.
   *
   * @param typedPhoneNumber - The number the code was sent to.
   * @param code - The code the user typed.
   * @param signUpDetails - Names and consents, only needed when this creates a new account.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   * @throws AuthError OTP_EXPIRED or INVALID_OTP when the code is not usable or wrong.
   */
  async verifyPhoneCode(typedPhoneNumber: unknown, code: unknown, signUpDetails: SignUpDetailsInput, request: RequestContext): Promise<SignInResult> {
    const settings = await this.getPhoneSettings();
    const phoneNumber = normalizePhoneNumber(typedPhoneNumber);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signInPerIp(request.ipAddress), RATE_LIMITS.signInPerIp);

    const existingUser = await this.users.findUserByPhoneNumber(phoneNumber);
    if (!existingUser) this.assertMaySignUp(settings.phoneOtp.allowSignUp, signUpDetails, settings, null);
    await this.oneTimeCodes.verifyCode(CODE_CHANNEL.sms, phoneNumber, code);

    const user = existingUser ?? (await this.createVerifiedUser({ phoneNumber }, signUpDetails, settings, request));
    const verifiedUser = await this.users.markPhoneVerified(user, settings, request);
    return this.signIn.completeSignIn(verifiedUser, SIGN_IN_METHOD.phoneOtp, request, settings);
  }

  // -------------------------------------------------------------------------------------------

  /**
   * @returns The current settings.
   * @throws AuthError SIGN_IN_METHOD_DISABLED when phone codes are turned off.
   * @throws AuthError NOT_CONFIGURED when the app has no SMS sender.
   */
  private async getPhoneSettings(): Promise<AuthSettings> {
    const settings = await this.settingsService.getSettings();
    if (!settings.phoneOtp.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    if (!this.notifications.canSendSms) throw new AuthError(AUTH_ERRORS.notConfigured);
    return settings;
  }

  /**
   * Applies the "send a code" rate limits for both the IP and the destination.
   *
   * @param destination - The email or phone number the code goes to.
   * @param request - Who is asking.
   * @throws AuthError TOO_MANY_REQUESTS when either limit is reached.
   */
  private async consumeSendLimits(destination: string, request: RequestContext) {
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendCodePerIp(request.ipAddress), RATE_LIMITS.sendCodePerIp);
    await this.rateLimiter.consume(RATE_LIMIT_KEY.sendCodePerDestination(destination), RATE_LIMITS.sendCodePerDestination);
  }

  /**
   * Decides whether to actually send: existing users who may sign in, or new ones when sign-up is allowed.
   *
   * @param user - The existing account, or null.
   * @param allowSignUp - Whether this sign-in method may create accounts.
   * @param email - The normalized email.
   * @param settings - The current settings.
   * @returns True when the code or link should be sent.
   */
  private async mayReceiveMessage(user: UserEntity | null, allowSignUp: boolean, email: string, settings: AuthSettings) {
    if (user) return canReceiveSignInMessages(user);
    return allowSignUp && settings.registration.enabled && isEmailDomainAllowed(email, settings.registration.allowedEmailDomains);
  }

  /**
   * Checks that a new account may be created with this method and these details.
   *
   * @param allowSignUp - Whether this sign-in method may create accounts.
   * @param details - The names and consents from the request.
   * @param settings - The current settings.
   * @param email - The new account's email, or null for phone sign-up.
   * @throws AuthError SIGN_UP_CLOSED, EMAIL_DOMAIN_NOT_ALLOWED, or an error for missing details.
   */
  private assertMaySignUp(allowSignUp: boolean, details: SignUpDetailsInput, settings: AuthSettings, email: string | null) {
    if (!allowSignUp || !settings.registration.enabled) throw new AuthError(AUTH_ERRORS.signUpClosed);
    if (email && !isEmailDomainAllowed(email, settings.registration.allowedEmailDomains)) throw new AuthError(AUTH_ERRORS.emailDomainNotAllowed);
    assertSignUpDetailsComplete(details, settings);
  }

  /**
   * Creates an account whose email or phone is already verified (the user just received the code).
   *
   * @param contact - The email or the phone number the code was sent to.
   * @param details - The names and consents from the request.
   * @param settings - The current settings.
   * @param request - Who is asking (for the audit log).
   * @returns The new user.
   */
  private createVerifiedUser(
    contact: { email?: string; phoneNumber?: string },
    details: SignUpDetailsInput,
    settings: AuthSettings,
    request: RequestContext,
  ): Promise<UserEntity> {
    return this.users.createUser(
      {
        email: contact.email ?? null,
        isEmailVerified: contact.email !== undefined,
        phoneNumber: contact.phoneNumber ?? null,
        isPhoneVerified: contact.phoneNumber !== undefined,
        firstName: details.firstName?.trim() || null,
        lastName: details.lastName?.trim() || null,
        acceptedTerms: details.acceptTerms === true,
        acceptedPrivacyPolicy: details.acceptPrivacyPolicy === true,
      },
      settings,
      request,
    );
  }
}
