import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { isEmailDomainAllowed } from '@/common/identifiers';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { RequestContext } from '@/common/request-context';
import {
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  POSTGRES_UNIQUE_VIOLATION_CODE,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  REMOVABLE_SIGN_IN_METHOD,
  SIGN_UP_DETAIL,
} from '@/constants';
import { SocialAccountEntity, SocialProvider, UserEntity } from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthSettings } from '@/features/settings/settings.types';
import { SignInService } from '@/features/sign-in/sign-in.service';
import { SignInResult } from '@/features/sign-in/sign-in.types';
import { SignInMethodsService } from '@/features/users/sign-in-methods.service';
import { assertSignUpDetailsComplete } from '@/features/users/sign-up-rules';
import { UsersService } from '@/features/users/users.service';
import { SocialSignInInput } from './social.dto';
import { SocialIdentity, SocialProvidersService } from './social-providers.service';

/**
 * Sign in with Google, Apple or Facebook, and link / unlink them to an existing account.
 *
 * Who the token belongs to is decided like this:
 * - The provider account is already linked: sign in as that user.
 * - The provider PROVED the email, and a user has it: link to that user, then sign in.
 * - The email is NOT proven, and a user has it: refuse (ACCOUNT_EXISTS_WITH_OTHER_METHOD).
 *   Otherwise anyone could create a Facebook account with your email and take over yours.
 * - Nobody has the email: create a new account (if sign-up is open).
 */
@Injectable()
export class SocialAuthService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly providers: SocialProvidersService,
    private readonly users: UsersService,
    private readonly signIn: SignInService,
    private readonly signInMethods: SignInMethodsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Signs in (or signs up) with a token from Google, Apple or Facebook.
   * See the class comment for how the token is matched to a user.
   *
   * @param provider - "google", "apple" or "facebook".
   * @param input - The provider's token, the optional nonce, and sign-up details for new accounts.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   * @throws AuthError INVALID_SOCIAL_TOKEN when the provider's token doesn't check out.
   * @throws AuthError ACCOUNT_EXISTS_WITH_OTHER_METHOD when a user has this email but the provider didn't prove it.
   * @throws AuthError SIGN_UP_CLOSED or VALIDATION_ERROR when a new account can't be created.
   */
  async signInWithProvider(provider: SocialProvider, input: SocialSignInInput, request: RequestContext): Promise<SignInResult> {
    const settings = await this.settingsService.getSettings();
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signInPerIp(request.ipAddress), RATE_LIMITS.signInPerIp);
    const identity = await this.providers.verifyCredential(provider, { token: input.token, nonce: input.nonce }, settings);

    // This provider account is already linked to a user.
    const linkedAccount = await this.findLinkedAccount(identity);
    if (linkedAccount) {
      const linkedUser = await this.users.findUserById(linkedAccount.userId);
      if (!linkedUser) throw new AuthError(AUTH_ERRORS.invalidSocialToken);
      return this.signIn.completeSignIn(linkedUser, provider, request, settings);
    }

    // Someone already has this email: link only if the provider proved it.
    const userWithSameEmail = identity.email ? await this.users.findUserByEmail(identity.email) : null;
    if (userWithSameEmail) {
      if (!identity.isEmailVerified) throw new AuthError(AUTH_ERRORS.accountExistsWithOtherMethod);
      await this.users.removeUnprovenPassword(userWithSameEmail, request);
      await this.saveLink(userWithSameEmail.id, identity, request);
      const verifiedUser = await this.users.markEmailVerified(userWithSameEmail, settings, request);
      return this.signIn.completeSignIn(verifiedUser, provider, request, settings);
    }

    // Nobody has this email yet.
    const newUser = await this.createUserFromIdentity(identity, input, settings, request);
    return this.signIn.completeSignIn(newUser, provider, request, settings);
  }

  /**
   * Links a provider account to the signed-in user (e.g. "Connect Google" in settings).
   * Linking the same account again is a no-op.
   *
   * @param userId - The signed-in user.
   * @param provider - "google", "apple" or "facebook".
   * @param input - The provider's token and optional nonce.
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError SOCIAL_ACCOUNT_IN_USE when that provider account belongs to another user.
   */
  async linkProvider(userId: string, provider: SocialProvider, input: SocialSignInInput, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const identity = await this.providers.verifyCredential(provider, { token: input.token, nonce: input.nonce }, settings);
    await this.users.getUserOrThrow(userId);

    const linkedAccount = await this.findLinkedAccount(identity);
    if (linkedAccount) {
      if (linkedAccount.userId === userId) return { success: true as const };
      throw new AuthError(AUTH_ERRORS.socialAccountAlreadyLinked);
    }
    await this.saveLink(userId, identity, request);
    return { success: true as const };
  }

  /**
   * Removes a linked provider, unless it is the user's only way to sign in.
   *
   * @param userId - The signed-in user.
   * @param provider - The provider to disconnect.
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when the provider isn't linked.
   * @throws AuthError LAST_SIGN_IN_METHOD when it is the user's only way to sign in.
   */
  async unlinkProvider(userId: string, provider: SocialProvider, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const user = await this.users.getUserOrThrow(userId);
    const accounts = this.database.getRepository(SocialAccountEntity);
    if (!(await accounts.exists({ where: { userId, provider } }))) throw new AuthError(AUTH_ERRORS.notFound);

    await this.signInMethods.assertCanRemove(user, settings, REMOVABLE_SIGN_IN_METHOD.social);
    await accounts.delete({ userId, provider });
    await this.events.record({ name: AUTH_EVENTS.socialAccountUnlinked, userId, request, details: { provider } });
    return { success: true as const };
  }

  // -------------------------------------------------------------------------------------------

  /**
   * @param identity - Who the provider says the user is.
   * @returns The link row for this provider account, or null.
   */
  private findLinkedAccount(identity: SocialIdentity) {
    return this.database.getRepository(SocialAccountEntity).findOne({
      where: { provider: identity.provider, providerUserId: identity.providerUserId },
    });
  }

  /**
   * Links a provider account to a user.
   *
   * @param userId - The user.
   * @param identity - Who the provider says the user is.
   * @param request - Who is asking (for the audit log).
   * @param transaction - Pass one to save the link together with other rows (e.g. a new user).
   * @throws AuthError SOCIAL_ACCOUNT_IN_USE when two requests link the same provider account at once.
   */
  private async saveLink(userId: string, identity: SocialIdentity, request: RequestContext, transaction = this.database.manager) {
    try {
      await transaction.insert(SocialAccountEntity, {
        userId,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
      });
    } catch (error) {
      // Two requests linked the same provider account at once.
      const code = (error as QueryFailedError & { code?: string }).code;
      if (error instanceof QueryFailedError && code === POSTGRES_UNIQUE_VIOLATION_CODE) throw new AuthError(AUTH_ERRORS.socialAccountAlreadyLinked);
      throw error;
    }
    await this.events.record({ name: AUTH_EVENTS.socialAccountLinked, userId, request, details: { provider: identity.provider } });
  }

  /**
   * Creates a new account from a provider's identity, linked to that provider.
   * Names from the app (Apple sends them only to the app) win over names from the provider.
   *
   * @param identity - Who the provider says the user is.
   * @param input - Sign-up details sent by the app.
   * @param settings - The current settings.
   * @param request - Who is asking.
   * @returns The new user.
   * @throws AuthError SIGN_UP_CLOSED, EMAIL_DOMAIN_NOT_ALLOWED, or VALIDATION_ERROR (e.g. no email from Facebook).
   */
  private async createUserFromIdentity(
    identity: SocialIdentity,
    input: SocialSignInInput,
    settings: AuthSettings,
    request: RequestContext,
  ): Promise<UserEntity> {
    if (!settings.registration.enabled) throw new AuthError(AUTH_ERRORS.signUpClosed);
    // Every account needs an email or phone. Facebook users can refuse to share their email.
    if (!identity.email) throw new AuthError(AUTH_ERRORS.validationFailed, { missingSignUpDetails: [SIGN_UP_DETAIL.email] });
    if (!isEmailDomainAllowed(identity.email, settings.registration.allowedEmailDomains)) {
      throw new AuthError(AUTH_ERRORS.emailDomainNotAllowed);
    }
    // Names from the app (Apple sends them only to the app) win over names from the provider.
    const signUpDetails = {
      ...input,
      firstName: input.firstName?.trim() || identity.firstName || undefined,
      lastName: input.lastName?.trim() || identity.lastName || undefined,
    };
    assertSignUpDetailsComplete(signUpDetails, settings);

    return this.database.transaction(async (transaction) => {
      const newUser = await this.users.createUser(
        {
          email: identity.email,
          isEmailVerified: identity.isEmailVerified,
          firstName: signUpDetails.firstName ?? null,
          lastName: signUpDetails.lastName ?? null,
          acceptedTerms: input.acceptTerms === true,
          acceptedPrivacyPolicy: input.acceptPrivacyPolicy === true,
        },
        settings,
        request,
        transaction,
      );
      await this.saveLink(newUser.id, identity, request, transaction);
      return newUser;
    });
  }
}
