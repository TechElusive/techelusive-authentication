import {
  AUTH_ERRORS,
  EMAIL_MASK,
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  PHONE_FORMATTING_CHARACTERS_PATTERN,
  PHONE_MASK,
  PHONE_NUMBER_PATTERN,
} from '@/constants';
import { AuthError } from './auth-error';

/**
 * Turns what the user typed into the one form we store and look up, so "Asha@Mail.com " and
 * "asha@mail.com" are the same account.
 *
 * @param typedEmail - The raw value from the request.
 * @returns The trimmed, lower-case email.
 * @throws AuthError INVALID_EMAIL if it is not an email address.
 */
export function normalizeEmail(typedEmail: unknown): string {
  if (typeof typedEmail !== 'string') throw new AuthError(AUTH_ERRORS.invalidEmail);
  const email = typedEmail.trim().toLowerCase();
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) throw new AuthError(AUTH_ERRORS.invalidEmail);
  return email;
}

/**
 * Turns "+91 98765-43210" into "+919876543210" (E.164). The country code is required,
 * because guessing it would send codes to the wrong country.
 *
 * @param typedPhoneNumber - The raw value from the request.
 * @returns The phone number in E.164 form.
 * @throws AuthError INVALID_PHONE if it is not a valid international number.
 */
export function normalizePhoneNumber(typedPhoneNumber: unknown): string {
  if (typeof typedPhoneNumber !== 'string') throw new AuthError(AUTH_ERRORS.invalidPhone);
  const phoneNumber = typedPhoneNumber.replace(PHONE_FORMATTING_CHARACTERS_PATTERN, '');
  if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) throw new AuthError(AUTH_ERRORS.invalidPhone);
  return phoneNumber;
}

/**
 * Checks the email's domain against an allow-list.
 *
 * @param email - A normalized email.
 * @param allowedDomains - e.g. ["company.com"]; an empty list allows any domain.
 * @returns True when the domain is allowed.
 */
export function isEmailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.slice(email.lastIndexOf(EMAIL_MASK.domainSeparator) + 1);
  return allowedDomains.some((allowedDomain) => allowedDomain.toLowerCase() === domain);
}

/**
 * Checks the phone number's country code against an allow-list.
 *
 * @param phoneNumber - A normalized E.164 phone number.
 * @param allowedCountryCodes - e.g. ["+91", "+1"]; an empty list allows any country.
 * @returns True when the country is allowed.
 */
export function isPhoneCountryAllowed(phoneNumber: string, allowedCountryCodes: string[]): boolean {
  if (allowedCountryCodes.length === 0) return true;
  return allowedCountryCodes.some((countryCode) => phoneNumber.startsWith(countryCode));
}

/**
 * Hides most of an email for messages and logs: "asha@mail.com" -> "a***@mail.com".
 *
 * @param email - A normalized email.
 * @returns The masked email.
 */
export function maskEmail(email: string): string {
  const [localPart, domain] = email.split(EMAIL_MASK.domainSeparator);
  return `${localPart.slice(0, EMAIL_MASK.visibleCharacters)}${EMAIL_MASK.hiddenPart}${EMAIL_MASK.domainSeparator}${domain}`;
}

/**
 * Hides the middle of a phone number for messages and logs: "+919876543210" -> "+91******3210".
 *
 * @param phoneNumber - A normalized E.164 phone number.
 * @returns The masked phone number.
 */
export function maskPhoneNumber(phoneNumber: string): string {
  const visibleEnd = phoneNumber.slice(-PHONE_MASK.visibleEnd);
  const visibleStart = phoneNumber.slice(0, PHONE_MASK.visibleStart);
  return `${visibleStart}${PHONE_MASK.maskCharacter.repeat(Math.max(phoneNumber.length - PHONE_MASK.visibleStart - PHONE_MASK.visibleEnd, 0))}${visibleEnd}`;
}
