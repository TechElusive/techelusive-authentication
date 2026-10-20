import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { RequestContext } from '@/common/request-context';
import {
  MINUTE_IN_SECONDS,
  ACCOUNT_STATUS,
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  CHALLENGE_PURPOSE,
  EMAIL_TYPE,
  PENDING_VERIFICATION,
  REACTIVATION_CHALLENGE_LIFETIME_SECONDS,
  SESSION_END_REASON,
  type SignInFailureReason,
  SIGN_IN_FAILURE_REASON,
  SIGN_IN_METHOD,
  SIGN_IN_STATUS,
} from '@/constants';
import { SessionEntity, UserEntity } from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { NotificationsService } from '@/features/notifications/notifications.service';
import { SessionService } from '@/features/sessions/session.service';
import { SignInMethod } from '@/features/sessions/session.types';
import { AuthSettings } from '@/features/settings/settings.types';
import { UsersService } from '@/features/users/users.service';
import { SignInChallengesService } from './sign-in-challenges.service';
import { SignedInResult, SignInResult } from './sign-in.types';

/**
 * The one path every sign-in method ends in (password, codes, magic link, Google, passkeys...).
 * Each method only proves who the user is; this service then decides what happens:
 *
 * - Is the account allowed to sign in? Suspended, deactivated or unverified accounts stop here
 *   with a clear error code.
 * - Does the user have 2FA turned on? Then a challenge token is returned instead of tokens.
 * - Otherwise a session starts and tokens are returned (plus the "new sign-in" email and event).
 *
 * Keeping this in one place means a new sign-in method can never forget a security check.
 */
@Injectable()
export class SignInService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly challenges: SignInChallengesService,
    private readonly notifications: NotificationsService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Called by a sign-in method once the user has proven who they are.
   *
   * @param user - The user who proved who they are.
   * @param signInMethod - How they did it (password, passkey, google...).
   * @param request - Who is asking (for the session, emails and audit log).
   * @param settings - The current settings.
   * @returns Either tokens (`status: "signed_in"`), or a challenge token (`status: "two_factor_required"`).
   * @throws AuthError ACCOUNT_NOT_VERIFIED, ACCOUNT_DEACTIVATED or ACCOUNT_SUSPENDED (see `assertAccountCanSignIn`).
   */
  async completeSignIn(
    user: UserEntity,
    signInMethod: SignInMethod,
    request: RequestContext,
    settings: AuthSettings,
  ): Promise<SignInResult> {
    await this.assertAccountCanSignIn(user, signInMethod, request, settings);

    // Passkeys already combine "something you have" with a fingerprint/PIN, so they count as two factors.
    const needsTwoFactor = settings.twoFactor.enabled && user.isTwoFactorEnabled && signInMethod !== SIGN_IN_METHOD.passkey;
    if (needsTwoFactor) {
      const challengeSeconds = settings.twoFactor.challengeExpiresInMinutes * MINUTE_IN_SECONDS;
      const challengeToken = await this.challenges.createChallenge(
        CHALLENGE_PURPOSE.twoFactor,
        user.id,
        signInMethod,
        challengeSeconds,
      );
      return { success: true, status: SIGN_IN_STATUS.twoFactorRequired, challengeToken, expiresIn: challengeSeconds };
    }

    return this.startSignedInSession(user, signInMethod, signInMethod === SIGN_IN_METHOD.passkey, request, settings);
  }

  /**
   * Called by the 2FA service after a correct authenticator or backup code. Checks the account
   * again, because it may have been suspended in the minutes since the first step.
   *
   * @param user - The user who passed both steps.
   * @param signInMethod - The method used for the first step.
   * @param request - Who is asking.
   * @param settings - The current settings.
   * @returns Access and refresh tokens.
   */
  async finishTwoFactorSignIn(
    user: UserEntity,
    signInMethod: SignInMethod,
    request: RequestContext,
    settings: AuthSettings,
  ): Promise<SignedInResult> {
    await this.assertAccountCanSignIn(user, signInMethod, request, settings);
    return this.startSignedInSession(user, signInMethod, true, request, settings);
  }

  /**
   * A deactivated user proved who they are (the sign-in returned ACCOUNT_DEACTIVATED with a
   * reactivationToken). This switches the account back on and signs them in.
   *
   * @param reactivationToken - The token from the ACCOUNT_DEACTIVATED error.
   * @param request - Who is asking.
   * @param settings - The current settings.
   * @returns The same result as `completeSignIn` (tokens, or a 2FA challenge).
   * @throws AuthError INVALID_TOKEN when the token is unknown, used or expired.
   */
  async reactivateAndSignIn(reactivationToken: unknown, request: RequestContext, settings: AuthSettings): Promise<SignInResult> {
    const challenge = await this.challenges.findOpenChallenge(reactivationToken, CHALLENGE_PURPOSE.reactivateAccount);
    if (!(await this.challenges.markChallengeUsed(challenge.challengeId))) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);

    const reactivatedUser = await this.users.reactivateAccount(challenge.userId, settings, request);
    return this.completeSignIn(reactivatedUser, challenge.signInMethod, request, settings);
  }

  /**
   * Signs out the device that made the request.
   *
   * @param userId - The signed-in user.
   * @param sessionId - The session to end (from the access token).
   * @param request - Who is asking (for the audit log).
   */
  async signOut(userId: string, sessionId: string, request: RequestContext): Promise<void> {
    await this.sessions.revokeSession(sessionId, SESSION_END_REASON.signedOut, userId);
    await this.events.record({ name: AUTH_EVENTS.userSignedOut, userId, request, details: { sessionId } });
  }

  /**
   * Signs out every device of the user.
   *
   * @param userId - The signed-in user.
   * @param request - Who is asking (for the audit log).
   * @param keepSessionId - When given, this device stays signed in.
   * @returns How many sessions were ended.
   */
  async signOutEverywhere(userId: string, request: RequestContext, keepSessionId?: string): Promise<number> {
    const endedSessions = await this.sessions.revokeAllSessions(userId, SESSION_END_REASON.signedOutEverywhere, keepSessionId);
    await this.events.record({
      name: AUTH_EVENTS.userSignedOut,
      userId,
      request,
      details: { everywhere: true, endedSessions },
    });
    return endedSessions;
  }

  /**
   * Records a failed attempt in the audit log (wrong password, wrong code...).
   *
   * @param userId - The user it was for, or null when the account is unknown.
   * @param signInMethod - The method that was tried.
   * @param reason - Why it failed.
   * @param request - Who tried.
   */
  async recordFailedSignIn(userId: string | null, signInMethod: SignInMethod, reason: SignInFailureReason, request: RequestContext) {
    await this.events.record({ name: AUTH_EVENTS.userSignInFailed, userId, request, details: { signInMethod, reason } });
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Stops sign-in for accounts that may not sign in, with a code the app can act on.
   * These run only AFTER the user proved who they are, so they reveal nothing to a stranger.
   *
   * A pending account whose verifications are all done is activated here.
   *
   * @param user - The user signing in.
   * @param signInMethod - How they proved who they are.
   * @param request - Who is asking.
   * @param settings - The current settings.
   * @throws AuthError ACCOUNT_NOT_VERIFIED with `pendingVerifications`, so the app can show the right screen.
   * @throws AuthError ACCOUNT_DEACTIVATED with a `reactivationToken` for `reactivateAndSignIn`.
   * @throws AuthError ACCOUNT_SUSPENDED when an admin suspended the account.
   * @throws AuthError INVALID_CREDENTIALS for deleted accounts (so they look like unknown ones).
   */
  private async assertAccountCanSignIn(
    user: UserEntity,
    signInMethod: SignInMethod,
    request: RequestContext,
    settings: AuthSettings,
  ): Promise<void> {
    switch (user.status) {
      case ACCOUNT_STATUS.active:
        return;

      case ACCOUNT_STATUS.pendingVerification: {
        // The app sends the user to the right verification screen using `pendingVerifications`.
        const pendingVerifications = this.users.getPendingVerifications(user, settings);
        if (pendingVerifications.length === 0) {
          await this.users.activateIfReady(user, settings, request);
          return;
        }
        await this.recordFailedSignIn(user.id, signInMethod, SIGN_IN_FAILURE_REASON.accountNotVerified, request);
        throw new AuthError(AUTH_ERRORS.accountNotVerified, {
          pendingVerifications,
          email: pendingVerifications.includes(PENDING_VERIFICATION.email) ? user.email : undefined,
          phoneNumber: pendingVerifications.includes(PENDING_VERIFICATION.phone) ? user.phoneNumber : undefined,
        });
      }

      case ACCOUNT_STATUS.deactivated: {
        const reactivationToken = await this.challenges.createChallenge(
          CHALLENGE_PURPOSE.reactivateAccount,
          user.id,
          signInMethod,
          REACTIVATION_CHALLENGE_LIFETIME_SECONDS,
        );
        throw new AuthError(AUTH_ERRORS.accountDeactivated, { reactivationToken, expiresIn: REACTIVATION_CHALLENGE_LIFETIME_SECONDS });
      }

      case ACCOUNT_STATUS.suspended:
        await this.recordFailedSignIn(user.id, signInMethod, SIGN_IN_FAILURE_REASON.accountSuspended, request);
        throw new AuthError(AUTH_ERRORS.accountSuspended);

      case ACCOUNT_STATUS.deleted:
      default:
        throw new AuthError(AUTH_ERRORS.invalidCredentials);
    }
  }

  /**
   * Starts the session, records the sign-in, and sends the "new sign-in" email for a new device.
   *
   * @param user - The user signing in.
   * @param signInMethod - How they signed in.
   * @param usedTwoFactor - Whether a second factor was used (recorded in the session and tokens).
   * @param request - Who is asking.
   * @param settings - The current settings.
   * @returns Tokens plus the user's public profile.
   */
  private async startSignedInSession(
    user: UserEntity,
    signInMethod: SignInMethod,
    usedTwoFactor: boolean,
    request: RequestContext,
    settings: AuthSettings,
  ): Promise<SignedInResult> {
    const isNewDevice = await this.isNewDeviceForUser(user.id, request);
    const tokens = await this.sessions.startSession(user, signInMethod, usedTwoFactor, request, settings);
    await this.users.recordSignIn(user);

    await this.events.record({
      name: AUTH_EVENTS.userSignedIn,
      userId: user.id,
      request,
      details: { signInMethod, usedTwoFactor, sessionId: tokens.sessionId, isNewDevice },
    });

    if (isNewDevice && settings.security.notifyOnNewSignIn && user.email) {
      await this.notifications.sendNoticeEmail({
        type: EMAIL_TYPE.newSignIn,
        to: user.email,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      });
    }

    return { success: true, status: SIGN_IN_STATUS.signedIn, ...tokens, user: this.users.toPublicProfile(user, settings) };
  }

  /**
   * "New device" = the user has signed in before, but never with this browser/app (user agent).
   * The very first sign-in is not reported, since the user just created the account.
   *
   * @param userId - The user signing in.
   * @param request - Holds the user agent.
   * @returns True when the "new sign-in" email should be sent.
   */
  private async isNewDeviceForUser(userId: string, request: RequestContext): Promise<boolean> {
    const sessionRepository = this.database.getRepository(SessionEntity);
    const hasSignedInBefore = await sessionRepository.exists({ where: { userId } });
    if (!hasSignedInBefore) return false;
    if (!request.userAgent) return true;
    const hasUsedThisDevice = await sessionRepository.exists({ where: { userId, userAgent: request.userAgent } });
    return !hasUsedThisDevice;
  }
}
