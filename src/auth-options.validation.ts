import { AuthOptions } from './auth-options';
import {
  HOST_COOKIE_PREFIX,
  LOCAL_ENCRYPTION_KEY_BYTES,
  OPTIONS_PROBLEM,
  PRODUCTION_ENVIRONMENT,
  REFRESH_TOKEN_COOKIE_DEFAULTS,
  RELYING_PARTY_ID_FORBIDDEN_CHARACTERS,
  TEXT_ENCODING,
  URL_PROTOCOL,
} from './constants';

/**
 * Checks AuthOptions when the app starts, so a mistake stops the app with a clear message
 * instead of failing later on a user's request.
 *
 * @param options - What your `useFactory` returned.
 * @throws Error listing every problem found (missing data source, bad encryption key, etc.).
 */
export function assertValidAuthOptions(options: AuthOptions): void {
  const problems: string[] = [];
  const isProduction = process.env.NODE_ENV === PRODUCTION_ENVIRONMENT;

  if (!options || typeof options !== 'object') throw new Error('AuthModule: useFactory must return the AuthOptions object');
  if (!options.dataSource) problems.push(OPTIONS_PROBLEM.dataSourceRequired);
  if (!options.emailSender || typeof options.emailSender.send !== 'function') problems.push(OPTIONS_PROBLEM.emailSenderRequired);

  try {
    const issuerUrl = new URL(options.issuer);
    if (isProduction && issuerUrl.protocol !== URL_PROTOCOL.https) problems.push(OPTIONS_PROBLEM.issuerMustBeHttps);
  } catch {
    problems.push(OPTIONS_PROBLEM.issuerMustBeUrl);
  }

  const encryption = options.encryption as Record<string, unknown> | undefined;
  if (!encryption) {
    problems.push(OPTIONS_PROBLEM.encryptionRequired);
  } else if ('localKey' in encryption) {
    if (isProduction) problems.push(OPTIONS_PROBLEM.localKeyNotForProduction);
    const keyBytes = typeof encryption.localKey === 'string' ? Buffer.from(encryption.localKey, TEXT_ENCODING.base64) : Buffer.alloc(0);
    if (keyBytes.length !== LOCAL_ENCRYPTION_KEY_BYTES) {
      problems.push(OPTIONS_PROBLEM.localKeyWrongSize);
    }
  } else {
    if (!encryption.awsKmsKeyId || !encryption.awsRegion) problems.push(OPTIONS_PROBLEM.kmsDetailsRequired);
    const legacyKey = encryption.legacyLocalKey;
    if (legacyKey !== undefined && (typeof legacyKey !== 'string' || Buffer.from(legacyKey, TEXT_ENCODING.base64).length !== LOCAL_ENCRYPTION_KEY_BYTES)) {
      problems.push(OPTIONS_PROBLEM.legacyLocalKeyWrongSize);
    }
  }

  if (isProduction && !options.redisUrl && options.singleServer !== true) problems.push(OPTIONS_PROBLEM.redisRequiredInProduction);

  if (options.passkeys) {
    const { relyingPartyId, relyingPartyName, allowedOrigins } = options.passkeys;
    if (!relyingPartyId || RELYING_PARTY_ID_FORBIDDEN_CHARACTERS.some((character) => relyingPartyId.includes(character))) {
      problems.push(OPTIONS_PROBLEM.relyingPartyIdMustBeDomain);
    }
    if (!relyingPartyName) problems.push(OPTIONS_PROBLEM.relyingPartyNameRequired);
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) problems.push(OPTIONS_PROBLEM.allowedOriginsRequired);
  }

  if (options.refreshTokenCookie) {
    const cookie = options.refreshTokenCookie;
    if (!Array.isArray(cookie.allowedOrigins) || cookie.allowedOrigins.length === 0) problems.push(OPTIONS_PROBLEM.cookieAllowedOriginsRequired);
    const name = cookie.name ?? REFRESH_TOKEN_COOKIE_DEFAULTS.name;
    const path = cookie.path ?? REFRESH_TOKEN_COOKIE_DEFAULTS.path;
    if (name.startsWith(HOST_COOKIE_PREFIX) && (cookie.domain !== undefined || path !== REFRESH_TOKEN_COOKIE_DEFAULTS.path)) {
      problems.push(OPTIONS_PROBLEM.hostCookieRules);
    }
  }

  if (problems.length > 0) throw new Error(`AuthModule options are invalid:\n  - ${problems.join('\n  - ')}`);
}
