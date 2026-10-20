import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto';
import {
  CLOCK_SKEW_TOLERANCE_SECONDS,
  ECDSA_SIGNATURE_ENCODING,
  HASH_ALGORITHM,
  JWK_EXPORT_FORMAT,
  JWK_KEY_TYPE,
  type JwtAlgorithm,
  JWT_ALGORITHM,
  JWT_PART_COUNT,
  JWT_PART_SEPARATOR,
  SIGNING_ALGORITHM,
  TEXT_ENCODING,
} from '@/constants';
import { currentUnixTimeSeconds } from '@/common/time';

/**
 * A small, strict JWT implementation using only Node's built-in crypto.
 *
 * - We SIGN only with ES256.
 * - We VERIFY ES256 (our own tokens) and RS256 (Google and Apple ID tokens), and only the
 *   algorithm the caller allows. This blocks the classic JWT attacks: "alg: none" and
 *   tricking the server into using the wrong kind of key.
 */

/** A JSON Web Key as it appears in a JWKS document. */
export interface JsonWebKey {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  // Elliptic-curve keys (ours)
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  // RSA keys (Google, Apple)
  n?: string;
  e?: string;
}

export type { JwtAlgorithm };

/**
 * Turns a private key stored as a JSON Web Key into a Node KeyObject that can sign tokens.
 *
 * @param jsonWebKey - The full key, including the private "d" part.
 * @returns A private KeyObject for `signJwt`.
 * @throws If the JWK is malformed or is not a private key.
 */
export function privateKeyFromJwk(jsonWebKey: JsonWebKey): KeyObject {
  return createPrivateKey({ key: jsonWebKey as any, format: JWK_EXPORT_FORMAT });
}

/**
 * Turns a JSON Web Key into a Node public KeyObject for checking signatures.
 *
 * Only the public fields are copied (n/e for RSA, crv/x/y for EC), so passing a private JWK
 * by mistake never leaks the private part into the result.
 *
 * @param jsonWebKey - An RSA key (Google, Apple) or an EC key (ours).
 * @returns A public KeyObject for `verifyJwt`.
 * @throws If the JWK is malformed.
 */
export function publicKeyFromJwk(jsonWebKey: JsonWebKey): KeyObject {
  const publicPart =
    jsonWebKey.kty === JWK_KEY_TYPE.rsa
      ? { kty: JWK_KEY_TYPE.rsa, n: jsonWebKey.n, e: jsonWebKey.e }
      : { kty: JWK_KEY_TYPE.ellipticCurve, crv: jsonWebKey.crv, x: jsonWebKey.x, y: jsonWebKey.y };
  return createPublicKey({ key: publicPart as any, format: JWK_EXPORT_FORMAT });
}

/**
 * Creates a signed ES256 token.
 *
 * @param payload - The claims to put in the token (sub, exp, iss...).
 * @param signingKey - Our current private key and its id; the id goes into the header as "kid".
 * @param tokenType - Goes into the header as "typ", e.g. "at+jwt" for access tokens.
 * @returns The token as "header.payload.signature".
 * @example
 * const token = signJwt({ sub: userId, exp }, { keyId, privateKey }, 'at+jwt');
 */
export function signJwt(payload: object, signingKey: { keyId: string; privateKey: KeyObject }, tokenType: string): string {
  const header = { alg: SIGNING_ALGORITHM, typ: tokenType, kid: signingKey.keyId };
  const headerAndPayload = [encodeJsonAsBase64Url(header), encodeJsonAsBase64Url(payload)].join(JWT_PART_SEPARATOR);
  const signature = sign(HASH_ALGORITHM.sha256, Buffer.from(headerAndPayload), {
    key: signingKey.privateKey,
    dsaEncoding: ECDSA_SIGNATURE_ENCODING, // JWT uses the raw r||s signature form, not DER
  });
  return [headerAndPayload, signature.toString(TEXT_ENCODING.base64Url)].join(JWT_PART_SEPARATOR);
}

export interface JwtVerificationRules {
  allowedAlgorithm: JwtAlgorithm;
  /** Accepted "iss" values. */
  expectedIssuers: string[];
  /** Accepted "aud" values; the token must contain at least one. */
  expectedAudiences: string[];
  /** Required "typ" header, or undefined to skip the check (provider tokens don't all set it). */
  expectedTokenType?: string;
  /** Current time in seconds; only set in tests. */
  currentTimeSeconds?: number;
}

/**
 * Checks a token and returns its payload if every check passes, otherwise null.
 *
 * Checks, in order: the shape, the algorithm, the "typ" header, the signature, the expiry
 * ("exp", with a little clock-skew tolerance), "iat" not in the future, the issuer and the audience.
 * Never throws for bad input, so callers can't accidentally leak a stack trace.
 *
 * @param token - The raw token string from the client.
 * @param findPublicKeyById - Looks up the public key named by the token's "kid" header.
 * @param rules - What the token must look like (algorithm, issuers, audiences, type).
 * @returns The payload when the token is valid, or null for anything wrong with it.
 */
export function verifyJwt(
  token: string,
  findPublicKeyById: (keyId: string) => KeyObject | undefined,
  rules: JwtVerificationRules,
): Record<string, any> | null {
  try {
    const parts = token.split(JWT_PART_SEPARATOR);
    if (parts.length !== JWT_PART_COUNT) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const header = decodeBase64UrlJson(encodedHeader);
    const payload = decodeBase64UrlJson(encodedPayload);
    if (!header || !payload) return null;

    if (header.alg !== rules.allowedAlgorithm) return null;
    if (rules.expectedTokenType !== undefined && header.typ !== rules.expectedTokenType) return null;

    const publicKey = typeof header.kid === 'string' ? findPublicKeyById(header.kid) : undefined;
    if (!publicKey) return null;

    const signedContent = Buffer.from([encodedHeader, encodedPayload].join(JWT_PART_SEPARATOR));
    const signature = Buffer.from(encodedSignature, TEXT_ENCODING.base64Url);
    const signatureIsValid =
      rules.allowedAlgorithm === JWT_ALGORITHM.es256
        ? verify(HASH_ALGORITHM.sha256, signedContent, { key: publicKey, dsaEncoding: ECDSA_SIGNATURE_ENCODING }, signature)
        : verify(HASH_ALGORITHM.sha256, signedContent, publicKey, signature);
    if (!signatureIsValid) return null;

    const now = rules.currentTimeSeconds ?? currentUnixTimeSeconds();
    const hasExpired = typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_TOLERANCE_SECONDS <= now;
    const issuedInFuture = typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_TOLERANCE_SECONDS > now;
    if (hasExpired || issuedInFuture) return null;

    if (!rules.expectedIssuers.includes(payload.iss)) return null;
    const tokenAudiences: unknown[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!tokenAudiences.some((audience) => rules.expectedAudiences.includes(audience as string))) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Reads the "kid" (key id) from a token's header WITHOUT checking anything, so the right public key
 * can be fetched before calling verifyJwt.
 *
 * @param token - Any string that may be a JWT.
 * @returns The key id, or undefined for anything that isn't a JWT or has no "kid".
 */
export function readJwtKeyId(token: string): string | undefined {
  try {
    const header = decodeBase64UrlJson(token.split(JWT_PART_SEPARATOR)[0]);
    return typeof header?.kid === 'string' ? header.kid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Encodes a value as JSON, then base64url (the form used in each part of a JWT).
 *
 * @param value - The header or payload object.
 * @returns The base64url text.
 */
function encodeJsonAsBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString(TEXT_ENCODING.base64Url);
}

/**
 * Reverses `encodeJsonAsBase64Url`.
 *
 * @param encoded - One base64url part of a JWT.
 * @returns The decoded object, or null when the JSON is not a plain object.
 * @throws If the text is not valid JSON (callers catch this).
 */
function decodeBase64UrlJson(encoded: string): Record<string, any> | null {
  const decoded = JSON.parse(Buffer.from(encoded, TEXT_ENCODING.base64Url).toString(TEXT_ENCODING.utf8));
  return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : null;
}
