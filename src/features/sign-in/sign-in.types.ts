import type { TokenSet } from '@/features/sessions/session.types';
import type { PublicUserProfile } from '@/features/users/users.types';
import { type SIGN_IN_STATUS } from '@/constants';

/** The user is signed in. */
export interface SignedInResult extends TokenSet {
  success: true;
  status: typeof SIGN_IN_STATUS.signedIn;
  user: PublicUserProfile;
}

/**
 * The first step passed but the user has two-factor authentication on.
 * Send POST /auth/2fa/verify with this challengeToken and the code from their authenticator app.
 */
export interface TwoFactorRequiredResult {
  success: true;
  status: typeof SIGN_IN_STATUS.twoFactorRequired;
  challengeToken: string;
  /** Seconds the user has to enter the code. */
  expiresIn: number;
}

/** What every sign-in endpoint returns. */
export type SignInResult = SignedInResult | TwoFactorRequiredResult;
