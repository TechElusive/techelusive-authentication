import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BACKUP_CODE_ALPHABET,
  BACKUP_CODE_FORMATTING_CHARACTERS_PATTERN,
  BACKUP_CODE_LENGTH,
  BASE64URL_TEXT_PATTERN,
  DECIMAL_BASE,
  HASH_ALGORITHM,
  RANDOM_TOKEN_BASE64URL_LENGTH,
  RANDOM_TOKEN_BYTES,
  SALTED_CODE_SEPARATOR,
  SHORT_CODE_SALT_BYTES,
  TEXT_ENCODING,
  TokenPrefix,
  TOKEN_PREFIX_SEPARATOR,
} from '@/constants';

/**
 * Random secrets we give out, and how we store them.
 *
 * Rule: the plain secret is shown to the user exactly once. The database only ever holds a hash,
 * so even a full database leak gives an attacker nothing they can use.
 */

/**
 * Creates a long random token like "rt_Xy3...".
 *
 * @param prefix - Says what the token is for (e.g. "rt" for refresh tokens), which helps when one leaks.
 * @returns `plainToken` to hand to the user once, and `tokenHash` to store in the database.
 */
export function createRandomToken(prefix: TokenPrefix): { plainToken: string; tokenHash: string } {
  const plainToken = `${prefix}${TOKEN_PREFIX_SEPARATOR}${randomBytes(RANDOM_TOKEN_BYTES).toString(TEXT_ENCODING.base64Url)}`;
  return { plainToken, tokenHash: sha256Hex(plainToken) };
}

/**
 * Checks that a value has exactly the shape of a token we created with this prefix.
 * A cheap check to run before any database lookup.
 *
 * @param value - Anything the client sent.
 * @param prefix - The prefix the token should start with.
 * @returns True when the value looks like one of our tokens.
 */
export function hasRandomTokenFormat(value: unknown, prefix: TokenPrefix): value is string {
  const base64UrlLengthOf32Bytes = RANDOM_TOKEN_BASE64URL_LENGTH;
  return (
    typeof value === 'string' &&
    value.length === prefix.length + 1 + base64UrlLengthOf32Bytes &&
    value.startsWith(`${prefix}${TOKEN_PREFIX_SEPARATOR}`) &&
    BASE64URL_TEXT_PATTERN.test(value)
  );
}

/**
 * Hashes text with SHA-256. Used for long random tokens, which are too random to guess,
 * so no salt or slow hash is needed.
 *
 * @param value - The text to hash.
 * @returns The hash as 64 hex characters.
 */
export function sha256Hex(value: string): string {
  return createHash(HASH_ALGORITHM.sha256).update(value, TEXT_ENCODING.utf8).digest(TEXT_ENCODING.hex);
}

/**
 * Creates a numeric code such as "482915" for email or SMS sign-in.
 * Uses crypto.randomInt, which has no bias towards particular digits.
 *
 * @param numberOfDigits - How long the code should be.
 * @returns The code as a string (it may start with 0).
 */
export function createNumericCode(numberOfDigits: number): string {
  return Array.from({ length: numberOfDigits }, () => randomInt(0, DECIMAL_BASE)).join('');
}

/**
 * Hashes a short code (SMS/email codes, backup codes). A random salt per code means two users
 * with the same code get different hashes. Short codes are also protected by expiry and attempt limits.
 *
 * @param code - The plain code.
 * @param salt - The code's own salt, from `createSalt`.
 * @returns The hash to store or compare.
 */
export function hashShortCode(code: string, salt: string): string {
  return sha256Hex(`${salt}${SALTED_CODE_SEPARATOR}${code}`);
}

/**
 * Creates a random salt for `hashShortCode`.
 *
 * @returns The salt as hex text.
 */
export function createSalt(): string {
  return randomBytes(SHORT_CODE_SALT_BYTES).toString(TEXT_ENCODING.hex);
}

/**
 * Creates a backup code like "k7m2x9p4" (shown to users as "k7m2-x9p4").
 *
 * @returns The plain backup code.
 */
export function createBackupCode(): string {
  return Array.from({ length: BACKUP_CODE_LENGTH }, () => BACKUP_CODE_ALPHABET[randomInt(0, BACKUP_CODE_ALPHABET.length)]).join('');
}

/**
 * Removes dashes, spaces and capitals, so "K7M2-X9P4" matches "k7m2x9p4".
 *
 * @param typedCode - The backup code as the user typed it.
 * @returns The code in its stored form.
 */
export function normalizeBackupCode(typedCode: string): string {
  return typedCode.toLowerCase().replace(BACKUP_CODE_FORMATTING_CHARACTERS_PATTERN, '');
}

/**
 * Compares two strings in constant time, so the time taken does not hint at how many characters matched.
 *
 * @param first - One string.
 * @param second - The other string.
 * @returns True when both strings are identical.
 */
export function constantTimeEquals(first: string, second: string): boolean {
  const firstBytes = Buffer.from(first);
  const secondBytes = Buffer.from(second);
  return firstBytes.length === secondBytes.length && timingSafeEqual(firstBytes, secondBytes);
}
