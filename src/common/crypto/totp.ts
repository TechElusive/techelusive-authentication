import { createHmac, randomBytes } from 'node:crypto';
import {
  AUTHENTICATOR_APP_URL_PREFIX,
  BASE32_ALPHABET,
  BASE32_BITS_PER_CHARACTER,
  BASE32_CHARACTER_MASK,
  BASE32_PADDING_PATTERN,
  BITS_PER_BYTE,
  BYTE_MASK,
  DECIMAL_BASE,
  DIGITS_ONLY_PATTERN,
  HASH_ALGORITHM,
  TOTP_ALLOWED_DRIFT_STEPS,
  TOTP_CODE_PAD_CHARACTER,
  TOTP_COUNTER_BYTES,
  TOTP_DIGITS,
  TOTP_LABEL_SEPARATOR,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  TOTP_URL_ALGORITHM_NAME,
  URL_QUERY_SEPARATOR,
  WHITESPACE_PATTERN,
} from '@/constants';
import { constantTimeEquals } from './random-secrets';
import { currentUnixTimeSeconds } from '@/common/time';

/**
 * Time-based one-time passwords (RFC 6238): the 6-digit codes shown by Google Authenticator,
 * Microsoft Authenticator, 1Password, Authy and others.
 *
 * The user's app and our server share a secret. Every 30 seconds both compute
 * HMAC-SHA1(secret, current 30-second step) and turn it into 6 digits. If they match, the user
 * has the phone that holds the secret.
 */

/**
 * Creates a new random secret, in the Base32 form authenticator apps expect.
 *
 * @returns The secret, e.g. "JBSWY3DPEHPK3PXP...".
 */
export function createTotpSecret(): string {
  return encodeBase32(randomBytes(TOTP_SECRET_BYTES));
}

/**
 * Builds the link inside the QR code the user scans:
 * otpauth://totp/Issuer:account?secret=...&issuer=Issuer
 *
 * @param secret - The Base32 secret from `createTotpSecret`.
 * @param accountName - Shown in the app under the issuer, usually the user's email.
 * @param issuerName - Your app's name, shown in the authenticator app.
 * @returns The otpauth:// URL to turn into a QR code.
 */
export function buildAuthenticatorAppUrl(secret: string, accountName: string, issuerName: string): string {
  const label = encodeURIComponent(`${issuerName}${TOTP_LABEL_SEPARATOR}${accountName}`);
  const parameters = new URLSearchParams({
    secret,
    issuer: issuerName,
    algorithm: TOTP_URL_ALGORITHM_NAME,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return AUTHENTICATOR_APP_URL_PREFIX + label + URL_QUERY_SEPARATOR + parameters.toString();
}

/**
 * Computes the 6-digit code for one 30-second time step (RFC 6238).
 *
 * @param secret - The Base32 secret shared with the authenticator app.
 * @param timeStep - Which 30-second window, from `timeStepAt`.
 * @returns The code as a zero-padded string, e.g. "042913".
 */
export function totpCodeForTimeStep(secret: string, timeStep: number): string {
  const counter = Buffer.alloc(TOTP_COUNTER_BYTES);
  counter.writeBigUInt64BE(BigInt(timeStep));
  const hmac = createHmac(HASH_ALGORITHM.sha1, decodeBase32(secret)).update(counter).digest();

  // "Dynamic truncation" from RFC 4226: pick 4 bytes based on the last nibble, keep 31 bits.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binaryCode % DECIMAL_BASE ** TOTP_DIGITS).padStart(TOTP_DIGITS, TOTP_CODE_PAD_CHARACTER);
}

/**
 * Converts a time into its 30-second TOTP window number.
 *
 * @param unixTimeSeconds - Seconds since 1970.
 * @returns The time step that contains this moment.
 */
export function timeStepAt(unixTimeSeconds: number): number {
  return Math.floor(unixTimeSeconds / TOTP_PERIOD_SECONDS);
}

/**
 * Checks a code the user typed from their authenticator app.
 *
 * Codes from one step before or after the current one are also accepted, because phone clocks drift.
 * `lastAcceptedTimeStep` blocks replay: a code that was already used (or an older one) is refused,
 * so someone who sees a code over the user's shoulder cannot use it again.
 *
 * @param secret - The user's Base32 secret.
 * @param typedCode - What the user typed; spaces are ignored.
 * @param lastAcceptedTimeStep - The step of the last code accepted for this user, or null if none.
 * @param unixTimeSeconds - The current time; only passed in tests.
 * @returns The matching time step (save it as the new lastAcceptedTimeStep), or null if wrong.
 */
export function verifyTotpCode(
  secret: string,
  typedCode: string,
  lastAcceptedTimeStep: number | null,
  unixTimeSeconds = currentUnixTimeSeconds(),
): number | null {
  const cleanCode = typedCode.replace(WHITESPACE_PATTERN, '');
  if (!DIGITS_ONLY_PATTERN.test(cleanCode) || cleanCode.length !== TOTP_DIGITS) return null;

  const currentStep = timeStepAt(unixTimeSeconds);
  for (let drift = -TOTP_ALLOWED_DRIFT_STEPS; drift <= TOTP_ALLOWED_DRIFT_STEPS; drift++) {
    const step = currentStep + drift;
    const alreadyUsed = lastAcceptedTimeStep !== null && step <= lastAcceptedTimeStep;
    if (!alreadyUsed && constantTimeEquals(totpCodeForTimeStep(secret, step), cleanCode)) return step;
  }
  return null;
}

/**
 * Encodes bytes as Base32 (RFC 4648, no padding), the format authenticator apps use for secrets.
 *
 * @param bytes - The raw bytes.
 * @returns The Base32 text.
 */
export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << BITS_PER_BYTE) | byte;
    bits += BITS_PER_BYTE;
    while (bits >= BASE32_BITS_PER_CHARACTER) {
      output += BASE32_ALPHABET[(value >>> (bits - BASE32_BITS_PER_CHARACTER)) & BASE32_CHARACTER_MASK];
      bits -= BASE32_BITS_PER_CHARACTER;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (BASE32_BITS_PER_CHARACTER - bits)) & BASE32_CHARACTER_MASK];
  return output;
}

/**
 * Decodes Base32 text back into bytes. Lower case and "=" padding are accepted.
 *
 * @param text - The Base32 text.
 * @returns The decoded bytes.
 * @throws If the text contains a character that is not in the Base32 alphabet.
 */
export function decodeBase32(text: string): Buffer {
  const cleanText = text.toUpperCase().replace(BASE32_PADDING_PATTERN, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of cleanText) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Invalid Base32 character');
    value = (value << BASE32_BITS_PER_CHARACTER) | index;
    bits += BASE32_BITS_PER_CHARACTER;
    if (bits >= BITS_PER_BYTE) {
      bytes.push((value >>> (bits - BITS_PER_BYTE)) & BYTE_MASK);
      bits -= BITS_PER_BYTE;
    }
  }
  return Buffer.from(bytes);
}
