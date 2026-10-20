import { AuthError } from '@/common/auth-error';
import type { SignUpDetailsInput } from '@/features/passwordless/passwordless.dto';
import { AuthSettings } from '@/features/settings/settings.types';
import { AUTH_ERRORS, SIGN_UP_DETAIL } from '@/constants';

/**
 * Checks the details a new account needs under the current settings (names, consent).
 * Used by every sign-in method that can create an account (codes, links, social, passkeys).
 *
 * @param details - The names and consents from the request.
 * @param settings - The current settings (registration rules).
 * @throws AuthError VALIDATION_ERROR with `missingSignUpDetails` listing exactly what is missing,
 *   so the app can show the right form.
 */
export function assertSignUpDetailsComplete(details: SignUpDetailsInput, settings: AuthSettings): void {
  const rules = settings.registration;
  const missingSignUpDetails: string[] = [];
  if (rules.requireFirstAndLastName && !details.firstName?.trim()) missingSignUpDetails.push(SIGN_UP_DETAIL.firstName);
  if (rules.requireFirstAndLastName && !details.lastName?.trim()) missingSignUpDetails.push(SIGN_UP_DETAIL.lastName);
  if (rules.requireTermsAcceptance && details.acceptTerms !== true) missingSignUpDetails.push(SIGN_UP_DETAIL.acceptTerms);
  if (rules.requirePrivacyPolicyAcceptance && details.acceptPrivacyPolicy !== true) missingSignUpDetails.push(SIGN_UP_DETAIL.acceptPrivacyPolicy);
  if (missingSignUpDetails.length > 0) throw new AuthError(AUTH_ERRORS.validationFailed, { missingSignUpDetails });
}
