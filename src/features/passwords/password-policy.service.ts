import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { AuthError } from '@/common/auth-error';
import {
  ARGON2_HASHING_OPTIONS,
  AUTH_ERRORS,
  BREACHED_PASSWORD_API,
  BREACHED_PASSWORD_API_URL,
  BREACHED_PASSWORD_CHECK_TIMEOUT_MS,
  BREACHED_PASSWORD_HASH_PREFIX_LENGTH,
  DIGIT_PATTERN,
  HASH_ALGORITHM,
  LOG_CONTEXT,
  LOWERCASE_LETTER_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_REQUIREMENT,
  PASSWORD_SYMBOL_PATTERN,
  TEXT_ENCODING,
  UPPERCASE_LETTER_PATTERN,
} from '@/constants';
import { AuthSettings } from '@/features/settings/settings.types';

/**
 * Everything about password strength and storage:
 * - checks a new password against the rules in settings.password,
 * - refuses passwords known from data breaches,
 * - hashes with Argon2id (the current OWASP recommendation) and verifies hashes.
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(LOG_CONTEXT.passwordPolicy);
  /**
   * A hash of a random password, checked when an email has no account. Sign-in then takes the same
   * time whether or not the account exists, so timing can't reveal who has an account.
   */
  private dummyPasswordHash?: Promise<string>;

  /**
   * Checks a new password against the rules in settings, then against known data breaches.
   *
   * @param password - The new password from the request.
   * @param settings - The current settings (length and character rules).
   * @returns The password, now known to be a string.
   * @throws AuthError INVALID_PASSWORD with `requirements` listing every broken rule.
   * @throws AuthError INVALID_PASSWORD (with a breach message) when the password appeared in a data breach.
   */
  async assertPasswordIsAcceptable(password: unknown, settings: AuthSettings): Promise<string> {
    if (typeof password !== 'string') throw new AuthError(AUTH_ERRORS.invalidPassword);
    const rules = settings.password;

    const brokenRules: string[] = [];
    if (password.length < rules.minimumLength) brokenRules.push(PASSWORD_REQUIREMENT.minimumLength(rules.minimumLength));
    if (password.length > PASSWORD_MAX_LENGTH) brokenRules.push(PASSWORD_REQUIREMENT.maximumLength(PASSWORD_MAX_LENGTH));
    if (rules.requireUppercaseLetter && !UPPERCASE_LETTER_PATTERN.test(password)) brokenRules.push(PASSWORD_REQUIREMENT.uppercaseLetter);
    if (rules.requireLowercaseLetter && !LOWERCASE_LETTER_PATTERN.test(password)) brokenRules.push(PASSWORD_REQUIREMENT.lowercaseLetter);
    if (rules.requireNumber && !DIGIT_PATTERN.test(password)) brokenRules.push(PASSWORD_REQUIREMENT.number);
    if (rules.requireSymbol && !PASSWORD_SYMBOL_PATTERN.test(password)) brokenRules.push(PASSWORD_REQUIREMENT.symbol);
    if (brokenRules.length > 0) throw new AuthError(AUTH_ERRORS.invalidPassword, { requirements: brokenRules });

    if (rules.rejectBreachedPasswords && (await this.isKnownBreachedPassword(password))) {
      throw new AuthError(AUTH_ERRORS.breachedPassword);
    }
    return password;
  }

  /**
   * Hashes a password with Argon2id.
   *
   * @param password - The plain password.
   * @returns The hash to store (it includes its own salt and settings).
   */
  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...ARGON2_HASHING_OPTIONS });
  }

  /**
   * Checks a typed password against a stored hash.
   *
   * @param storedHash - The user's hash, or `null` when there is no account. A dummy hash is then
   *   checked anyway, so the response takes the same time either way.
   * @param typedPassword - The password from the request.
   * @returns True only when there is a stored hash and the password matches it.
   */
  async verifyPassword(storedHash: string | null, typedPassword: unknown): Promise<boolean> {
    const password = typeof typedPassword === 'string' ? typedPassword.slice(0, PASSWORD_MAX_LENGTH) : '';
    const hashToCheck = storedHash ?? (await this.getDummyPasswordHash());
    try {
      const matches = await argon2.verify(hashToCheck, password);
      return storedHash !== null && matches;
    } catch {
      return false;
    }
  }

  /**
   * Checks whether an old hash was made with weaker settings and should be replaced on next sign-in.
   *
   * @param storedHash - The user's current hash.
   * @returns True when the hash should be recreated.
   */
  needsRehash(storedHash: string): boolean {
    return argon2.needsRehash(storedHash, { ...ARGON2_HASHING_OPTIONS });
  }

  /**
   * Asks haveibeenpwned.com whether the password appeared in a breach, using "k-anonymity":
   * only the first 5 characters of its SHA-1 hash are sent, never the password.
   * If the service is slow or down, the password is allowed (sign-up should not depend on it).
   *
   * @param password - The new password.
   * @returns True when the password is known from a breach.
   */
  private async isKnownBreachedPassword(password: string): Promise<boolean> {
    const sha1 = createHash(HASH_ALGORITHM.sha1).update(password).digest(TEXT_ENCODING.hex).toUpperCase();
    const hashPrefix = sha1.slice(0, BREACHED_PASSWORD_HASH_PREFIX_LENGTH);
    const hashSuffix = sha1.slice(BREACHED_PASSWORD_HASH_PREFIX_LENGTH);
    try {
      const response = await fetch(`${BREACHED_PASSWORD_API_URL}${hashPrefix}`, {
        headers: { [BREACHED_PASSWORD_API.paddingHeader]: BREACHED_PASSWORD_API.paddingHeaderValue },
        signal: AbortSignal.timeout(BREACHED_PASSWORD_CHECK_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const responseLines = (await response.text()).split(BREACHED_PASSWORD_API.lineSeparator);
      return responseLines.some((line) => {
        const [suffix, timesSeen] = line.trim().split(BREACHED_PASSWORD_API.countSeparator);
        return suffix === hashSuffix && Number(timesSeen) > 0;
      });
    } catch (error) {
      this.logger.warn(`Breached-password check skipped: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Creates (once) the hash of a random password, used by `verifyPassword` when there is no account.
   *
   * @returns The dummy hash.
   */
  private getDummyPasswordHash(): Promise<string> {
    this.dummyPasswordHash ??= this.hashPassword(createHash(HASH_ALGORITHM.sha256).update(String(Math.random())).digest(TEXT_ENCODING.hex));
    return this.dummyPasswordHash;
  }
}
