import { Inject, Injectable } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
/** Transport names SimpleWebAuthn accepts ("internal", "hybrid", "usb"...). Stored as text in the database. */
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { DataSource, IsNull } from 'typeorm';
import { AuthOptions, PasskeyOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { createRandomToken, hasRandomTokenFormat, sha256Hex } from '@/common/crypto/random-secrets';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { RequestContext } from '@/common/request-context';
import {
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  CHALLENGE_PURPOSE,
  DEFAULT_PASSKEY_NAME,
  DISPLAY_NAME_SEPARATOR,
  MAXIMUM_PASSKEYS_PER_USER,
  PASSKEY_ATTESTATION_TYPE,
  PASSKEY_CHALLENGE_LIFETIME_SECONDS,
  PASSKEY_RESIDENT_KEY,
  PASSKEY_USER_VERIFICATION,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  REMOVABLE_SIGN_IN_METHOD,
  SECOND_IN_MILLISECONDS,
  SIGN_IN_FAILURE_REASON,
  SIGN_IN_METHOD,
  SORT_ORDER,
  TEXT_ENCODING,
  TOKEN_PREFIX,
  VALIDATION_PROBLEM,
} from '@/constants';
import { ChallengePurpose, PasskeyEntity, SignInChallengeEntity } from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthSettings } from '@/features/settings/settings.types';
import { SignInService } from '@/features/sign-in/sign-in.service';
import { SignInResult } from '@/features/sign-in/sign-in.types';
import { SignInMethodsService } from '@/features/users/sign-in-methods.service';
import { UsersService } from '@/features/users/users.service';

/** A passkey as shown to its owner. The public key is not included (nobody needs it). */
export interface PasskeySummary {
  id: string;
  name: string;
  isBackedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Passkeys (Face ID, Touch ID, Windows Hello, Android, security keys) through WebAuthn.
 *
 * Adding a passkey and signing in with one each take two requests:
 * - ".../options": we create a random challenge and return options for the browser or app,
 *   plus a `challengeToken` to send back with the verify request.
 * - ".../verify": the device signed the challenge; we check the signature.
 *
 * Passkeys must use a fingerprint, face or PIN (user verification = required), which is why
 * a passkey sign-in counts as two factors and skips the authenticator-app step.
 */
@Injectable()
export class PasskeysService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly signIn: SignInService,
    private readonly signInMethods: SignInMethodsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  // -------------------------------------------------------------------------------------------
  // Adding a passkey (user is signed in)
  // -------------------------------------------------------------------------------------------

  /**
   * Starts adding a passkey: creates a challenge and the options to pass to the browser
   * (`navigator.credentials.create`, or SimpleWebAuthn's `startRegistration`).
   *
   * @param userId - The signed-in user.
   * @returns `options` for the device, and a `challengeToken` to send back to finishRegistration.
   * @throws AuthError SIGN_IN_METHOD_DISABLED or NOT_CONFIGURED when passkeys are off or not set up.
   * @throws AuthError VALIDATION_ERROR when the user already has the maximum number of passkeys.
   */
  async startRegistration(userId: string) {
    const { passkeyOptions } = await this.getEnabledPasskeySettings();
    const user = await this.users.getUserOrThrow(userId);
    const existingPasskeys = await this.database.getRepository(PasskeyEntity).find({ where: { userId } });
    if (existingPasskeys.length >= MAXIMUM_PASSKEYS_PER_USER) throw new AuthError(AUTH_ERRORS.validationFailed, { problems: [VALIDATION_PROBLEM.tooManyPasskeys] });

    const browserOptions = await generateRegistrationOptions({
      rpName: passkeyOptions.relyingPartyName,
      rpID: passkeyOptions.relyingPartyId,
      userID: new TextEncoder().encode(user.id),
      userName: user.email ?? user.phoneNumber ?? user.id,
      userDisplayName: [user.firstName, user.lastName].filter(Boolean).join(DISPLAY_NAME_SEPARATOR) || (user.email ?? ''),
      attestationType: PASSKEY_ATTESTATION_TYPE,
      // Stops the same device from being registered twice.
      excludeCredentials: existingPasskeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: { residentKey: PASSKEY_RESIDENT_KEY, userVerification: PASSKEY_USER_VERIFICATION },
    });
    const challengeToken = await this.saveCeremonyChallenge(CHALLENGE_PURPOSE.passkeyRegistration, browserOptions.challenge, userId);
    return { success: true as const, challengeToken, options: browserOptions };
  }

  /**
   * Finishes adding a passkey: checks the device's response and saves the new passkey.
   *
   * @param userId - The signed-in user (must be the one who called startRegistration).
   * @param challengeToken - The token from startRegistration.
   * @param deviceResponse - What the browser returned from `navigator.credentials.create`.
   * @param passkeyName - A label like "MacBook"; a default name is used when empty.
   * @param request - Who is asking (for the audit log).
   * @returns The saved passkey.
   * @throws AuthError INVALID_TOKEN when the challenge is unknown, used or expired.
   * @throws AuthError INVALID_PASSKEY when the response doesn't check out.
   */
  async finishRegistration(userId: string, challengeToken: unknown, deviceResponse: any, passkeyName: string | undefined, request: RequestContext) {
    const { passkeyOptions } = await this.getEnabledPasskeySettings();
    const challenge = await this.useCeremonyChallenge(challengeToken, CHALLENGE_PURPOSE.passkeyRegistration);
    if (challenge.userId !== userId) throw new AuthError(AUTH_ERRORS.invalidPasskey);

    let verification: any;
    try {
      verification = await verifyRegistrationResponse({
        response: deviceResponse,
        expectedChallenge: challenge.webauthnChallenge,
        expectedOrigin: passkeyOptions.allowedOrigins,
        expectedRPID: passkeyOptions.relyingPartyId,
        requireUserVerification: true,
      });
    } catch {
      throw new AuthError(AUTH_ERRORS.invalidPasskey);
    }
    if (!verification?.verified || !verification.registrationInfo) throw new AuthError(AUTH_ERRORS.invalidPasskey);

    const credential = this.readRegisteredCredential(verification.registrationInfo, deviceResponse);
    const savedPasskey = await this.database.getRepository(PasskeyEntity).save({
      userId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      signCount: credential.counter,
      transports: credential.transports,
      isBackedUp: credential.isBackedUp,
      name: passkeyName?.trim() || DEFAULT_PASSKEY_NAME,
    });
    await this.events.record({ name: AUTH_EVENTS.passkeyAdded, userId, request, details: { passkeyId: savedPasskey.id } });
    return { success: true as const, passkey: this.toSummary(savedPasskey) };
  }

  // -------------------------------------------------------------------------------------------
  // Signing in with a passkey (no email needed: the device offers the user's passkeys)
  // -------------------------------------------------------------------------------------------

  /**
   * Starts signing in with a passkey. No email is needed: the device offers the user's passkeys.
   *
   * @param request - Who is asking (for rate limits).
   * @returns `options` for `navigator.credentials.get`, and a `challengeToken` for finishSignIn.
   * @throws AuthError TOO_MANY_REQUESTS after too many attempts from this IP.
   */
  async startSignIn(request: RequestContext) {
    const { passkeyOptions } = await this.getEnabledPasskeySettings();
    await this.rateLimiter.consume(RATE_LIMIT_KEY.signInPerIp(request.ipAddress), RATE_LIMITS.signInPerIp);
    const browserOptions = await generateAuthenticationOptions({
      rpID: passkeyOptions.relyingPartyId,
      userVerification: PASSKEY_USER_VERIFICATION,
    });
    const challengeToken = await this.saveCeremonyChallenge(CHALLENGE_PURPOSE.passkeySignIn, browserOptions.challenge, null);
    return { success: true as const, challengeToken, options: browserOptions };
  }

  /**
   * Finishes signing in with a passkey: checks the signature and signs the user in.
   * Passkeys count as two factors, so the authenticator-app step is skipped.
   *
   * @param challengeToken - The token from startSignIn.
   * @param deviceResponse - What the browser returned from `navigator.credentials.get`.
   * @param request - Who is asking.
   * @returns Tokens.
   * @throws AuthError INVALID_TOKEN when the challenge is unknown, used or expired.
   * @throws AuthError INVALID_PASSKEY when the passkey is unknown or the signature is wrong.
   */
  async finishSignIn(challengeToken: unknown, deviceResponse: any, request: RequestContext): Promise<SignInResult> {
    const { settings, passkeyOptions } = await this.getEnabledPasskeySettings();
    const challenge = await this.useCeremonyChallenge(challengeToken, CHALLENGE_PURPOSE.passkeySignIn);

    const credentialId = typeof deviceResponse?.id === 'string' ? deviceResponse.id : '';
    const passkey = await this.database.getRepository(PasskeyEntity).findOne({ where: { credentialId } });
    if (!passkey) throw new AuthError(AUTH_ERRORS.invalidPasskey);

    let verification: any;
    try {
      verification = await verifyAuthenticationResponse({
        response: deviceResponse,
        expectedChallenge: challenge.webauthnChallenge,
        expectedOrigin: passkeyOptions.allowedOrigins,
        expectedRPID: passkeyOptions.relyingPartyId,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(Buffer.from(passkey.publicKey, TEXT_ENCODING.base64Url)),
          counter: passkey.signCount,
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch {
      verification = undefined;
    }
    if (!verification?.verified) {
      await this.signIn.recordFailedSignIn(passkey.userId, SIGN_IN_METHOD.passkey, SIGN_IN_FAILURE_REASON.passkeySignatureInvalid, request);
      throw new AuthError(AUTH_ERRORS.invalidPasskey);
    }

    await this.database.getRepository(PasskeyEntity).update(
      { id: passkey.id },
      { signCount: verification.authenticationInfo?.newCounter ?? passkey.signCount, lastUsedAt: new Date() },
    );
    const user = await this.users.findUserById(passkey.userId);
    if (!user) throw new AuthError(AUTH_ERRORS.invalidPasskey);
    return this.signIn.completeSignIn(user, SIGN_IN_METHOD.passkey, request, settings);
  }

  // -------------------------------------------------------------------------------------------
  // Managing passkeys
  // -------------------------------------------------------------------------------------------

  /**
   * @param userId - The signed-in user.
   * @returns The user's passkeys, oldest first.
   */
  async listPasskeys(userId: string): Promise<PasskeySummary[]> {
    const passkeys = await this.database.getRepository(PasskeyEntity).find({ where: { userId }, order: { createdAt: SORT_ORDER.oldestFirst } });
    return passkeys.map((passkey) => this.toSummary(passkey));
  }

  /**
   * @param userId - The signed-in user.
   * @param passkeyId - One of the user's passkeys.
   * @param newName - The new label.
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when the passkey isn't the user's.
   */
  async renamePasskey(userId: string, passkeyId: string, newName: string) {
    const result = await this.database.getRepository(PasskeyEntity).update({ id: passkeyId, userId }, { name: newName.trim() });
    if (!result.affected) throw new AuthError(AUTH_ERRORS.notFound);
    return { success: true as const };
  }

  /**
   * Removes one of the user's passkeys, unless it is their last way to sign in.
   *
   * @param userId - The signed-in user.
   * @param passkeyId - One of the user's passkeys.
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when the passkey isn't the user's.
   * @throws AuthError LAST_SIGN_IN_METHOD when it is the user's only way to sign in.
   */
  async removePasskey(userId: string, passkeyId: string, request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const passkeys = this.database.getRepository(PasskeyEntity);
    if (!(await passkeys.exists({ where: { id: passkeyId, userId } }))) throw new AuthError(AUTH_ERRORS.notFound);
    await this.signInMethods.assertCanRemove(await this.users.getUserOrThrow(userId), settings, REMOVABLE_SIGN_IN_METHOD.passkey);
    await passkeys.delete({ id: passkeyId, userId });
    await this.events.record({ name: AUTH_EVENTS.passkeyRemoved, userId, request, details: { passkeyId } });
    return { success: true as const };
  }

  // -------------------------------------------------------------------------------------------

  /**
   * @returns The current settings and the app's passkey options (relying party id, origins).
   * @throws AuthError SIGN_IN_METHOD_DISABLED when passkeys are turned off in settings.
   * @throws AuthError NOT_CONFIGURED when AuthOptions.passkeys is not set.
   */
  private async getEnabledPasskeySettings(): Promise<{ settings: AuthSettings; passkeyOptions: PasskeyOptions }> {
    const settings = await this.settingsService.getSettings();
    if (!settings.passkeys.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    if (!this.options.passkeys) throw new AuthError(AUTH_ERRORS.notConfigured);
    return { settings, passkeyOptions: this.options.passkeys };
  }

  /**
   * Stores the WebAuthn challenge until the finish request arrives, behind a "ch_..." token (only the token's hash is stored).
   *
   * @param purpose - Registration or sign-in.
   * @param webauthnChallenge - The random challenge the device must sign.
   * @param userId - The user adding a passkey, or null for sign-in.
   * @returns The plain token for the client.
   */
  private async saveCeremonyChallenge(purpose: ChallengePurpose, webauthnChallenge: string, userId: string | null) {
    const { plainToken, tokenHash } = createRandomToken(TOKEN_PREFIX.signInChallenge);
    await this.database.getRepository(SignInChallengeEntity).insert({
      purpose,
      userId,
      webauthnChallenge,
      challengeTokenHash: tokenHash,
      expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_LIFETIME_SECONDS * SECOND_IN_MILLISECONDS),
    });
    return plainToken;
  }

  /**
   * Uses up a ceremony challenge (once only, before it expires).
   *
   * @param challengeToken - The token from startRegistration or startSignIn.
   * @param purpose - Registration or sign-in.
   * @returns The user who started it (null for sign-in) and the WebAuthn challenge.
   * @throws AuthError INVALID_TOKEN when the token is unknown, used, expired or for another purpose.
   */
  private async useCeremonyChallenge(challengeToken: unknown, purpose: ChallengePurpose) {
    if (!hasRandomTokenFormat(challengeToken, TOKEN_PREFIX.signInChallenge)) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    const challenges = this.database.getRepository(SignInChallengeEntity);
    const challenge = await challenges.findOne({
      where: { challengeTokenHash: sha256Hex(challengeToken), purpose, usedAt: IsNull() },
    });
    if (!challenge || !challenge.webauthnChallenge || challenge.expiresAt.getTime() <= Date.now()) {
      throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    }
    const result = await challenges.update({ id: challenge.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!result.affected) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    return { userId: challenge.userId, webauthnChallenge: challenge.webauthnChallenge };
  }

  /**
   * Reads the new credential from the library's result. SimpleWebAuthn v11+ nests it under
   * `credential`; older versions used flat fields. Both are handled so an upgrade can't break sign-up.
   *
   * @param registrationInfo - `verification.registrationInfo` from SimpleWebAuthn.
   * @param deviceResponse - The browser's response (fallback source for transports).
   * @returns The credential id and public key (base64url), counter, transports and backup state.
   */
  private readRegisteredCredential(registrationInfo: any, deviceResponse: any) {
    const toBase64Url = (bytes: Uint8Array | string) =>
      typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString(TEXT_ENCODING.base64Url);
    const nested = registrationInfo.credential;
    return {
      id: toBase64Url(nested?.id ?? registrationInfo.credentialID),
      publicKey: toBase64Url(nested?.publicKey ?? registrationInfo.credentialPublicKey),
      counter: Number(nested?.counter ?? registrationInfo.counter ?? 0),
      transports: (nested?.transports ?? deviceResponse?.response?.transports ?? []) as string[],
      isBackedUp: registrationInfo.credentialBackedUp === true,
    };
  }

  /**
   * @param passkey - The passkey row.
   * @returns The passkey as shown to its owner (no public key).
   */
  private toSummary(passkey: PasskeyEntity): PasskeySummary {
    return {
      id: passkey.id,
      name: passkey.name,
      isBackedUp: passkey.isBackedUp,
      createdAt: passkey.createdAt.toISOString(),
      lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
    };
  }
}
