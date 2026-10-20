/**
 * Everything an app (or an admin at runtime) can switch on, off or adjust.
 * Defaults are in settings.defaults.ts; validation rules in settings.validation.ts.
 */
export interface AuthSettings {
  registration: {
    /** Allow new accounts at all (with any method). */
    enabled: boolean;
    /** Roles every new user gets, e.g. ["user"]. Users can never choose their own role. */
    defaultRoles: string[];
    requireFirstAndLastName: boolean;
    /** Registration with email + password must also include a phone number. */
    requirePhoneNumber: boolean;
    requireTermsAcceptance: boolean;
    requirePrivacyPolicyAcceptance: boolean;
    /** Only these email domains may register, e.g. ["myapp.com"]. Empty = anyone. */
    allowedEmailDomains: string[];
  };

  /** Which verifications move an account from PENDING_VERIFICATION to ACTIVE. */
  activation: {
    requireVerifiedEmail: boolean;
    requireVerifiedPhone: boolean;
  };

  password: {
    enabled: boolean;
    minimumLength: number;
    requireUppercaseLetter: boolean;
    requireLowercaseLetter: boolean;
    requireNumber: boolean;
    requireSymbol: boolean;
    /** Refuse passwords found in public data breaches (haveibeenpwned.com; the password never leaves your server). */
    rejectBreachedPasswords: boolean;
    /** Email the user when their password changes. */
    notifyOnChange: boolean;
  };

  emailVerification: {
    /** How long the "verify your email" link works. */
    linkExpiresInHours: number;
  };

  passwordReset: {
    /** How long the "reset your password" link works. */
    linkExpiresInMinutes: number;
  };

  emailChange: {
    /** How long the link that confirms a new email address works. */
    linkExpiresInMinutes: number;
  };

  emailOtp: {
    enabled: boolean;
    codeLength: number;
    expiresInMinutes: number;
    /** Wait before another code can be sent to the same email. */
    resendAfterSeconds: number;
    /** Create an account when an unknown email signs in with a code. */
    allowSignUp: boolean;
  };

  magicLink: {
    enabled: boolean;
    /** How long the sign-in link works. */
    expiresInMinutes: number;
    allowSignUp: boolean;
  };

  phoneOtp: {
    enabled: boolean;
    codeLength: number;
    expiresInMinutes: number;
    /** Wait before another code can be sent to the same number. */
    resendAfterSeconds: number;
    allowSignUp: boolean;
    /** Country calling codes allowed, e.g. ["+91"]. Empty = any country. */
    allowedCountryCodes: string[];
  };

  google: {
    enabled: boolean;
    /** OAuth client IDs of your apps (web, Android, iOS) from Google Cloud Console. */
    clientIds: string[];
  };

  apple: {
    enabled: boolean;
    /** Your iOS bundle ID and/or web Services ID, e.g. ["com.myapp.ios"]. */
    clientIds: string[];
  };

  facebook: {
    enabled: boolean;
    /** Your Facebook App ID (the secret goes in AuthOptions.facebookAppSecret). */
    appId: string;
  };

  passkeys: {
    enabled: boolean;
  };

  twoFactor: {
    /** Users may turn on two-factor authentication with an authenticator app. */
    enabled: boolean;
    /** After the password (or code) is right, how long the user has to enter their 2FA code. */
    challengeExpiresInMinutes: number;
  };

  organizations: {
    enabled: boolean;
    /** Any user may create an organization (otherwise only admins). */
    allowUsersToCreate: boolean;
    /** How long an emailed invitation can be accepted. */
    invitationExpiresInDays: number;
  };

  tokens: {
    accessTokenMinutes: number;
    refreshTokenDays: number;
    /** Hard limit: after this many days the user must sign in again. */
    sessionDays: number;
  };

  admin: {
    /** Users with any of these roles may use the /auth/admin endpoints. */
    adminRoles: string[];
  };

  security: {
    /** Email the user when their account is signed in from a new device. */
    notifyOnNewSignIn: boolean;
  };

  /** How long old rows are kept. A cleanup runs every hour on each server (DataRetentionService). */
  retention: {
    /** Turn the automatic hourly cleanup off (e.g. to run it from your own job instead). */
    enabled: boolean;
    /** Ended sessions and used or expired codes, links, 2FA challenges and invitations. */
    expiredRecordDays: number;
    /** Delivered or failed webhook deliveries (pending ones are never removed). */
    webhookDeliveryDays: number;
    /** Audit log entries. 0 = keep forever. */
    auditLogDays: number;
  };
}

/** A partial set of settings: only the values you want to change. */
export type SettingsChanges = {
  [Section in keyof AuthSettings]?: Partial<AuthSettings[Section]>;
};
