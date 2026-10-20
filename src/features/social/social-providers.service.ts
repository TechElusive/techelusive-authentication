import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { readJwtKeyId, verifyJwt } from '@/common/crypto/jwt';
import { RemotePublicKeys } from '@/common/crypto/remote-public-keys';
import { constantTimeEquals } from '@/common/crypto/random-secrets';
import {
  APPLE_PUBLIC_KEYS_URL,
  APPLE_TOKEN_ISSUER,
  APPLE_TRUE_STRING,
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  FACEBOOK_API,
  FACEBOOK_GRAPH_API_URL,
  FACEBOOK_PROFILE_FIELDS,
  GOOGLE_PUBLIC_KEYS_URL,
  GOOGLE_TOKEN_ISSUERS,
  HASH_ALGORITHM,
  LOG_CONTEXT,
  PROVIDER_ID_TOKEN_ALGORITHM,
  SOCIAL_PROVIDER,
  SOCIAL_PROVIDER_TIMEOUT_MS,
  TEXT_ENCODING,
} from '@/constants';
import { SocialProvider } from '@/database/entities';
import { AuthSettings } from '@/features/settings/settings.types';

/** Who the provider says the user is. */
export interface SocialIdentity {
  provider: SocialProvider;
  /** The provider's permanent id for the user ("sub"). Emails can change; this can't. */
  providerUserId: string;
  email: string | null;
  /** True only when the provider itself confirmed the user owns the email. */
  isEmailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
}

/** What the app sends after the user signed in with the provider's own SDK or button. */
export interface SocialCredential {
  /** Google / Apple: the ID token (a JWT). Facebook: the user access token. */
  token: string;
  /**
   * Optional. If your app put a nonce in the provider request, send the same raw nonce here.
   * It ties the token to this sign-in so a stolen token can't be replayed. Strongly recommended for Apple.
   */
  nonce?: string;
}

/**
 * Checks tokens from Google, Apple and Facebook WITHOUT trusting the app: signatures are verified
 * against the provider's published keys (Google, Apple) or the token is checked with Facebook's API.
 */
@Injectable()
export class SocialProvidersService {
  private readonly logger = new Logger(LOG_CONTEXT.socialProviders);
  private readonly googleKeys = new RemotePublicKeys(GOOGLE_PUBLIC_KEYS_URL);
  private readonly appleKeys = new RemotePublicKeys(APPLE_PUBLIC_KEYS_URL);

  constructor(@Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions) {}

  /**
   * Checks a provider token and returns who it belongs to.
   *
   * @param provider - "google", "apple" or "facebook".
   * @param credential - The token (and optional nonce) the app got from the provider.
   * @param settings - The current settings (which providers are on, client ids).
   * @returns The provider's user id, email and names.
   * @throws AuthError SIGN_IN_METHOD_DISABLED when the provider is turned off.
   * @throws AuthError NOT_CONFIGURED when client ids or the Facebook app secret are missing.
   * @throws AuthError INVALID_SOCIAL_TOKEN when the token doesn't check out.
   */
  async verifyCredential(provider: SocialProvider, credential: SocialCredential, settings: AuthSettings): Promise<SocialIdentity> {
    switch (provider) {
      case SOCIAL_PROVIDER.google:
        if (!settings.google.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
        return this.verifyGoogleIdToken(credential, settings.google.clientIds);
      case SOCIAL_PROVIDER.apple:
        if (!settings.apple.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
        return this.verifyAppleIdToken(credential, settings.apple.clientIds);
      case SOCIAL_PROVIDER.facebook:
        if (!settings.facebook.enabled) throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
        return this.verifyFacebookAccessToken(credential.token, settings.facebook.appId);
      default:
        throw new AuthError(AUTH_ERRORS.signInMethodDisabled);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Google: an RS256 ID token whose "aud" must be one of YOUR client ids.
  // -------------------------------------------------------------------------------------------

  /**
   * @param credential - Google's ID token and optional nonce.
   * @param clientIds - Your Google OAuth client ids (web, iOS, Android).
   * @returns The identity from the token.
   * @throws AuthError INVALID_SOCIAL_TOKEN when the token doesn't check out.
   */
  private async verifyGoogleIdToken(credential: SocialCredential, clientIds: string[]): Promise<SocialIdentity> {
    const claims = await this.verifyProviderIdToken(credential, this.googleKeys, GOOGLE_TOKEN_ISSUERS, clientIds);
    return {
      provider: SOCIAL_PROVIDER.google,
      providerUserId: claims.sub,
      email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
      isEmailVerified: claims.email_verified === true,
      firstName: typeof claims.given_name === 'string' ? claims.given_name : null,
      lastName: typeof claims.family_name === 'string' ? claims.family_name : null,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Apple: like Google. Apple sends the user's name only to the app, only the first time, so
  // the app passes it in the sign-up details. The email may be a private relay address.
  // -------------------------------------------------------------------------------------------

  /**
   * @param credential - Apple's ID token and optional nonce.
   * @param clientIds - Your Apple Services ID / bundle ids.
   * @returns The identity from the token (names are always null; Apple sends them to the app only).
   * @throws AuthError INVALID_SOCIAL_TOKEN when the token doesn't check out.
   */
  private async verifyAppleIdToken(credential: SocialCredential, clientIds: string[]): Promise<SocialIdentity> {
    const claims = await this.verifyProviderIdToken(credential, this.appleKeys, [APPLE_TOKEN_ISSUER], clientIds);
    return {
      provider: SOCIAL_PROVIDER.apple,
      providerUserId: claims.sub,
      email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
      // Apple sends this as a boolean or as the string "true".
      isEmailVerified: claims.email_verified === true || claims.email_verified === APPLE_TRUE_STRING,
      firstName: null,
      lastName: null,
    };
  }

  /**
   * Shared ID-token checks: signature, issuer, audience, expiry, and the nonce when given.
   *
   * @param credential - The ID token and optional nonce.
   * @param providerKeys - The provider's public keys.
   * @param issuers - Accepted "iss" values.
   * @param clientIds - Accepted "aud" values (your client ids).
   * @returns The token's claims.
   * @throws AuthError NOT_CONFIGURED when no client ids are set.
   * @throws AuthError INVALID_SOCIAL_TOKEN when any check fails.
   */
  private async verifyProviderIdToken(
    credential: SocialCredential,
    providerKeys: RemotePublicKeys,
    issuers: string[],
    clientIds: string[],
  ): Promise<Record<string, any> & { sub: string }> {
    if (clientIds.length === 0) throw new AuthError(AUTH_ERRORS.notConfigured);
    await providerKeys.ensureLoaded(readJwtKeyId(credential.token));

    const claims = verifyJwt(credential.token, (keyId) => providerKeys.findLoadedKey(keyId), {
      allowedAlgorithm: PROVIDER_ID_TOKEN_ALGORITHM,
      expectedIssuers: issuers,
      expectedAudiences: clientIds,
    });
    if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0) throw new AuthError(AUTH_ERRORS.invalidSocialToken);

    if (credential.nonce !== undefined || claims.nonce !== undefined) {
      if (!this.nonceMatches(credential.nonce, claims.nonce)) throw new AuthError(AUTH_ERRORS.invalidSocialToken);
    }
    return claims as Record<string, any> & { sub: string };
  }

  /**
   * Apple puts sha256(rawNonce) in the token; Google puts the raw nonce. Accept either form.
   *
   * @param rawNonce - The nonce the app sent.
   * @param nonceInToken - The "nonce" claim from the token.
   * @returns True when they match.
   */
  private nonceMatches(rawNonce: string | undefined, nonceInToken: unknown): boolean {
    if (typeof rawNonce !== 'string' || typeof nonceInToken !== 'string') return false;
    const hashedNonce = createHash(HASH_ALGORITHM.sha256).update(rawNonce).digest(TEXT_ENCODING.hex);
    return constantTimeEquals(nonceInToken, rawNonce) || constantTimeEquals(nonceInToken, hashedNonce);
  }

  // -------------------------------------------------------------------------------------------
  // Facebook: no ID token for most apps, so we ask Facebook whether the access token is valid
  // and was issued to OUR app (otherwise a token from any other app would be accepted).
  // -------------------------------------------------------------------------------------------

  /**
   * Asks Facebook whether the access token is valid and was issued to OUR app, then reads the profile.
   *
   * @param accessToken - The user access token from the Facebook SDK.
   * @param appId - Your Facebook app id.
   * @returns The identity. The email is never treated as verified.
   * @throws AuthError NOT_CONFIGURED when the app id or secret is missing.
   * @throws AuthError INVALID_SOCIAL_TOKEN when the token is invalid or for another app.
   */
  private async verifyFacebookAccessToken(accessToken: string, appId: string): Promise<SocialIdentity> {
    const appSecret = this.options.facebookAppSecret;
    if (!appId || !appSecret) throw new AuthError(AUTH_ERRORS.notConfigured);

    const tokenCheckUrl = new URL(`${FACEBOOK_GRAPH_API_URL}${FACEBOOK_API.debugTokenPath}`);
    tokenCheckUrl.searchParams.set(FACEBOOK_API.inputTokenParameter, accessToken);
    tokenCheckUrl.searchParams.set(FACEBOOK_API.accessTokenParameter, FACEBOOK_API.appAccessToken(appId, appSecret));
    const tokenCheck = await this.fetchFacebookJson(tokenCheckUrl);
    const tokenData = tokenCheck?.data;
    const tokenIsForOurApp = tokenData?.is_valid === true && String(tokenData.app_id) === appId && typeof tokenData.user_id === 'string';
    if (!tokenIsForOurApp) throw new AuthError(AUTH_ERRORS.invalidSocialToken);

    // appsecret_proof proves the call comes from our server, not from someone holding the token.
    const profileUrl = new URL(`${FACEBOOK_GRAPH_API_URL}${FACEBOOK_API.profilePath}`);
    profileUrl.searchParams.set(FACEBOOK_API.fieldsParameter, FACEBOOK_PROFILE_FIELDS);
    profileUrl.searchParams.set(FACEBOOK_API.accessTokenParameter, accessToken);
    profileUrl.searchParams.set(FACEBOOK_API.appSecretProofParameter, createHmac(HASH_ALGORITHM.sha256, appSecret).update(accessToken).digest(TEXT_ENCODING.hex));
    const profile = await this.fetchFacebookJson(profileUrl);
    if (!profile || profile.id !== tokenData.user_id) throw new AuthError(AUTH_ERRORS.invalidSocialToken);

    return {
      provider: SOCIAL_PROVIDER.facebook,
      providerUserId: profile.id,
      email: typeof profile.email === 'string' ? profile.email.toLowerCase() : null,
      // Facebook does not say whether the email was confirmed, so we never treat it as proven.
      isEmailVerified: false,
      firstName: typeof profile.first_name === 'string' ? profile.first_name : null,
      lastName: typeof profile.last_name === 'string' ? profile.last_name : null,
    };
  }

  /**
   * @param url - A Facebook Graph API URL.
   * @returns The JSON response, or null for a non-2xx answer.
   * @throws AuthError INTERNAL_SERVER_ERROR when Facebook can't be reached.
   */
  private async fetchFacebookJson(url: URL): Promise<Record<string, any> | null> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(SOCIAL_PROVIDER_TIMEOUT_MS) });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, any>;
    } catch (error) {
      this.logger.warn(`Facebook API call failed: ${(error as Error).message}`);
      throw new AuthError(AUTH_ERRORS.internalError);
    }
  }
}
