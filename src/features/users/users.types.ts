import type { AccountStatus, PendingVerification } from '@/constants';
import type { JsonObject } from '@/database/entities/json-object';

/** A verification still owed before the account becomes ACTIVE (see PENDING_VERIFICATION). */
export type { PendingVerification };

/** The user as returned by GET /auth/me and the admin API. Never contains secrets. */
export interface PublicUserProfile {
  id: string;
  email: string | null;
  isEmailVerified: boolean;
  phoneNumber: string | null;
  isPhoneVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  status: AccountStatus;
  /** What the user still has to verify. The app can send them straight to that screen. */
  pendingVerifications: PendingVerification[];
  /** Set by your app's profile module through UsersService.completeOnboarding(). */
  onboardingCompleted: boolean;
  isTwoFactorEnabled: boolean;
  metadata: JsonObject;
  lastSignedInAt: string | null;
  createdAt: string;
}
