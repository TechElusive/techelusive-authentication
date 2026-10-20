import type { AuthSettings } from './features/settings/settings.types';

/**
 * Every fixed number, name and limit used by the library lives in this file.
 *
 * Values that an app may want to change at runtime (password length, token lifetimes, which
 * sign-in methods are on) are NOT here: they are settings, see `features/settings/settings.defaults.ts`.
 * What stays here are security limits that should only change with a code review.
 */

// ---------------------------------------------------------------------------------------------
// Time units (in seconds) so lifetimes below read naturally, e.g. 15 * MINUTE_IN_SECONDS.
// ---------------------------------------------------------------------------------------------

export const SECOND_IN_MILLISECONDS = 1000;
export const MINUTE_IN_SECONDS = 60;
export const HOUR_IN_SECONDS = 60 * MINUTE_IN_SECONDS;
export const DAY_IN_SECONDS = 24 * HOUR_IN_SECONDS;

// ---------------------------------------------------------------------------------------------
// Dependency-injection token for the options passed to AuthModule.forRoot().
// ---------------------------------------------------------------------------------------------

/** Postgres error code for "a unique index would be broken", e.g. an email that is already used. */
export const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

/** Size of the development-only local encryption key (AES-256). */
export const LOCAL_ENCRYPTION_KEY_BYTES = 32;
/** AES-GCM: 12-byte random IV per value, 16-byte authentication tag. */
export const AES_GCM_INITIALIZATION_VECTOR_BYTES = 12;
export const AES_GCM_AUTH_TAG_BYTES = 16;

export const AUTH_OPTIONS_TOKEN = 'TECHELUSIVE_AUTH_OPTIONS';

// ---------------------------------------------------------------------------------------------
// Tokens we hand out. We store only a SHA-256 hash of each, never the token itself.
// The prefix makes a leaked token easy to recognise (e.g. by secret scanners) and to route.
// ---------------------------------------------------------------------------------------------

export const TOKEN_PREFIX = {
  refreshToken: 'rt',
  emailVerificationLink: 'ev',
  passwordResetLink: 'pr',
  magicSignInLink: 'ml',
  emailChangeLink: 'ec',
  organizationInvitation: 'oi',
  signInChallenge: 'ch',
  apiKey: 'ak',
} as const;

export type TokenPrefix = (typeof TOKEN_PREFIX)[keyof typeof TOKEN_PREFIX];

/** Random bytes in every token above: 32 bytes = 256 bits, impossible to guess. */
export const RANDOM_TOKEN_BYTES = 32;

/** Access tokens use the JWT "typ" from RFC 9068, so an access token can't be confused with other JWTs. */
export const ACCESS_TOKEN_JWT_TYPE = 'at+jwt';

/** The only algorithm we sign with: ECDSA P-256 + SHA-256. */
/** JWT signature algorithms: ES256 for our own tokens, RS256 for Google and Apple ID tokens. */
export const JWT_ALGORITHM = { es256: 'ES256', rs256: 'RS256' } as const;
export type JwtAlgorithm = (typeof JWT_ALGORITHM)[keyof typeof JWT_ALGORITHM];
export const SIGNING_ALGORITHM = JWT_ALGORITHM.es256;
/** Algorithm Google and Apple sign their ID tokens with. */
export const PROVIDER_ID_TOKEN_ALGORITHM = JWT_ALGORITHM.rs256;

/** Allowed difference between our clock and the token's timestamps. */
export const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

// ---------------------------------------------------------------------------------------------
// Single-use links and short-lived challenges. How long each link works is a setting
// (emailVerification, passwordReset, magicLink, emailChange); see DEFAULT_SETTINGS.
// ---------------------------------------------------------------------------------------------

/** For each kind of emailed link: the prefix of its token. */
export const LINK_TOKEN_KINDS = {
  verify_email: { prefix: TOKEN_PREFIX.emailVerificationLink },
  reset_password: { prefix: TOKEN_PREFIX.passwordResetLink },
  magic_sign_in: { prefix: TOKEN_PREFIX.magicSignInLink },
  change_email: { prefix: TOKEN_PREFIX.emailChangeLink },
} as const;

/**
 * An account whose email is still unverified after this long is treated as possibly created by
 * someone else; if the real owner then proves the email by code, link or Google, any password set
 * on it is removed (see UsersService.removeUnprovenPassword).
 */
export const UNVERIFIED_ACCOUNT_GRACE_SECONDS = 24 * HOUR_IN_SECONDS;

/**
 * Users without a password must have signed in this recently to change their email (proof that
 * the person holding the session is the owner, not someone who found an unlocked device).
 */
export const RECENT_SIGN_IN_SECONDS = 10 * MINUTE_IN_SECONDS;

/** A passkey ceremony (browser prompt) must finish within this time. */
export const PASSKEY_CHALLENGE_LIFETIME_SECONDS = 5 * MINUTE_IN_SECONDS;
/** How long a deactivated user has, after proving who they are, to confirm reactivation. */
export const REACTIVATION_CHALLENGE_LIFETIME_SECONDS = 10 * MINUTE_IN_SECONDS;

// ---------------------------------------------------------------------------------------------
// One-time codes sent by email or SMS.
// ---------------------------------------------------------------------------------------------

/** Wrong guesses allowed per code before it stops working. 5 guesses of a 6-digit code = 1 in 200,000 chance. */
export const ONE_TIME_CODE_MAX_ATTEMPTS = 5;
/** Wrong 2FA codes allowed per sign-in attempt before the user must start again. */
export const TWO_FACTOR_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------------------------
// Passwords.
// ---------------------------------------------------------------------------------------------

/** Longer passwords are refused so nobody can make the server hash megabytes of text. */
export const PASSWORD_MAX_LENGTH = 128;
/** The lowest minimum length an app may configure (NIST SP 800-63B). */
export const PASSWORD_MIN_LENGTH_FLOOR = 8;

/** Argon2id settings recommended by OWASP: 64 MB of memory, 3 passes, 1 thread. */
export const ARGON2_HASHING_OPTIONS = { memoryCost: 64 * 1024, timeCost: 3, parallelism: 1 } as const;

/** Have I Been Pwned range API. Only the first 5 characters of the password's SHA-1 are sent. */
export const BREACHED_PASSWORD_API_URL = 'https://api.pwnedpasswords.com/range/';
/** If the breach check is slower than this, skip it rather than block the user. */
export const BREACHED_PASSWORD_CHECK_TIMEOUT_MS = 2000;
/** Characters of the password's SHA-1 hash sent to the breach service (its "k-anonymity" range). */
export const BREACHED_PASSWORD_HASH_PREFIX_LENGTH = 5;
/** What counts as a "symbol" when settings.password.requireSymbol is on: anything not a letter, digit or space. */
export const PASSWORD_SYMBOL_PATTERN = /[^\p{L}\p{N}\s]/u;

// ---------------------------------------------------------------------------------------------
// Two-factor authentication (authenticator apps, RFC 6238).
// ---------------------------------------------------------------------------------------------

/** RFC 4648 base32 alphabet, used for authenticator-app secrets. */
export const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Accept codes from one 30-second step before or after now, for phones with slightly wrong clocks. */
export const TOTP_ALLOWED_DRIFT_STEPS = 1;
/** 20 random bytes = 160 bits, the size RFC 4226 recommends. */
export const TOTP_SECRET_BYTES = 20;
/** Name shown in the user's authenticator app next to the code. Apps can override it. */
export const TOTP_DEFAULT_ISSUER_NAME = 'Techelusive';

export const BACKUP_CODE_COUNT = 10;
/** Backup codes look like "k7m2-x9p4": 8 characters from an alphabet without look-alikes (no 0/o, 1/l/i). */
export const BACKUP_CODE_LENGTH = 8;
/** Backup codes are shown split in two for readability: "k7m2-x9p4". */
export const BACKUP_CODE_DISPLAY_GROUP_LENGTH = BACKUP_CODE_LENGTH / 2;
export const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// ---------------------------------------------------------------------------------------------
// Rate limits: { maximum attempts, within this many seconds }.
// Counted per IP address and per account so neither a botnet nor a single attacker gets far.
// ---------------------------------------------------------------------------------------------

export interface RateLimitRule {
  maximumAttempts: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  signUpPerIp: { maximumAttempts: 10, windowSeconds: HOUR_IN_SECONDS },
  signInPerIp: { maximumAttempts: 30, windowSeconds: 15 * MINUTE_IN_SECONDS },
  signInPerAccount: { maximumAttempts: 10, windowSeconds: 15 * MINUTE_IN_SECONDS },
  sendCodePerIp: { maximumAttempts: 10, windowSeconds: HOUR_IN_SECONDS },
  sendCodePerDestination: { maximumAttempts: 5, windowSeconds: HOUR_IN_SECONDS },
  sendEmailLinkPerIp: { maximumAttempts: 10, windowSeconds: HOUR_IN_SECONDS },
  sendEmailLinkPerEmail: { maximumAttempts: 3, windowSeconds: HOUR_IN_SECONDS },
  refreshPerIp: { maximumAttempts: 120, windowSeconds: MINUTE_IN_SECONDS },
  twoFactorPerUser: { maximumAttempts: 10, windowSeconds: 15 * MINUTE_IN_SECONDS },
  changePasswordPerUser: { maximumAttempts: 5, windowSeconds: 15 * MINUTE_IN_SECONDS },
  changeEmailPerUser: { maximumAttempts: 5, windowSeconds: HOUR_IN_SECONDS },
  exportDataPerUser: { maximumAttempts: 5, windowSeconds: HOUR_IN_SECONDS },
} as const satisfies Record<string, RateLimitRule>;

/** Passkeys: no attestation (privacy), discoverable credentials, and fingerprint/face/PIN always required. */
export const PASSKEY_ATTESTATION_TYPE = 'none';
export const PASSKEY_RESIDENT_KEY = 'required';
export const PASSKEY_USER_VERIFICATION = 'required';
/** Name given to a passkey when the user doesn't type one. */
export const DEFAULT_PASSKEY_NAME = 'Passkey';
/** Most passkeys one user may register. */
export const MAXIMUM_PASSKEYS_PER_USER = 20;
/** Longest passkey name. */
export const PASSKEY_NAME_MAX_LENGTH = 60;

/** Prefix for rate-limit counters in Redis, so they never clash with the app's own keys. */
export const RATE_LIMIT_REDIS_KEY_PREFIX = 'auth:rate-limit:';

// ---------------------------------------------------------------------------------------------
// Caching inside one server process.
// ---------------------------------------------------------------------------------------------

/** The settings table holds exactly one row, with this id. */
export const SETTINGS_ROW_ID = 1;
/** Signing keys are re-read this often, so a key rotation reaches every server quickly. */
export const SIGNING_KEYS_CACHE_SECONDS = 60;
/** Settings are re-read this often, so an admin's change reaches every server quickly. */
export const SETTINGS_CACHE_SECONDS = 10;
/**
 * How long the guard trusts its last "session still active and user still ACTIVE" check.
 * Signing out a device or suspending a user takes effect within this time.
 */
export const SESSION_CHECK_CACHE_SECONDS = 5;
/** Retired signing keys stay published this long, so tokens they signed keep verifying until they expire. */
export const RETIRED_SIGNING_KEY_PUBLISH_SECONDS = 2 * DAY_IN_SECONDS;

// ---------------------------------------------------------------------------------------------
// Sign in with Google / Apple / Facebook: where their public keys and APIs live.
// ---------------------------------------------------------------------------------------------

/** Social providers this library supports (Instagram has no consumer sign-in API since Dec 2024). */
export const SOCIAL_PROVIDER = { google: 'google', apple: 'apple', facebook: 'facebook' } as const;
export type SocialProvider = (typeof SOCIAL_PROVIDER)[keyof typeof SOCIAL_PROVIDER];
export const SOCIAL_PROVIDERS = Object.values(SOCIAL_PROVIDER) as SocialProvider[];

export const GOOGLE_PUBLIC_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_TOKEN_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export const APPLE_PUBLIC_KEYS_URL = 'https://appleid.apple.com/auth/keys';
export const APPLE_TOKEN_ISSUER = 'https://appleid.apple.com';

/** Graph API version 26 (July 2026). Meta retires versions about two years after release; bump when needed. */
export const FACEBOOK_GRAPH_API_URL = 'https://graph.facebook.com/v26.0';

/** Provider public keys are cached this long (providers rotate them rarely and announce them early). */
export const SOCIAL_PUBLIC_KEYS_CACHE_SECONDS = 6 * HOUR_IN_SECONDS;
/** Give up on a provider API call after this long. */
export const SOCIAL_PROVIDER_TIMEOUT_MS = 5000;
/** A token signed by a key we don't know triggers a fresh key download at most this often. */
export const UNKNOWN_KEY_REFETCH_WAIT_SECONDS = 60;
/** Longest ID / access token accepted from a social provider. */
export const SOCIAL_TOKEN_INPUT_MAX_LENGTH = 8192;
/** Longest nonce accepted with an Apple / Google ID token. */
export const NONCE_INPUT_MAX_LENGTH = 256;
/** Facebook profile fields requested after sign-in. */
export const FACEBOOK_PROFILE_FIELDS = 'id,email,first_name,last_name';

// ---------------------------------------------------------------------------------------------
// Ready-made senders (src/integrations).
// ---------------------------------------------------------------------------------------------

/** MSG91 v5 Flow API: sends an SMS from a DLT-approved template. */
export const MSG91_FLOW_API_URL = 'https://control.msg91.com/api/v5/flow';
export const MSG91_REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------------------------
// Webhooks.
// ---------------------------------------------------------------------------------------------

/** Header carrying the signature: "t=<unix time>,v1=<hex HMAC-SHA256 of '<t>.<body>'>". */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Techelusive-Signature';
export const WEBHOOK_EVENT_HEADER = 'X-Techelusive-Event';
export const WEBHOOK_DELIVERY_ID_HEADER = 'X-Techelusive-Delivery';
/** Receivers should reject signatures older than this (stops replays). */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * MINUTE_IN_SECONDS;
export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
/** Failed deliveries are retried with growing waits: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h. */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600, 43200, 86400];
/** How often the delivery worker looks for webhooks to send. */
export const WEBHOOK_WORKER_INTERVAL_MS = 5000;
/** Deliveries handled per worker run. */
export const WEBHOOK_WORKER_BATCH_SIZE = 20;
export const WEBHOOK_SECRET_BYTES = 32;
/** Prefix of webhook signing secrets, so they are easy to recognise (e.g. in secret scanners). */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';
/** A delivery claimed by a worker is retried after this long if that worker crashes mid-send. */
export const WEBHOOK_CLAIM_TIMEOUT_SECONDS = 60;
/** Longest error text / response kept for a failed delivery. */
export const WEBHOOK_ERROR_MAX_LENGTH = 500;
/** Most webhooks one app may register. */
export const MAXIMUM_WEBHOOKS = 50;
export const WEBHOOK_URL_MAX_LENGTH = 2048;
export const WEBHOOK_DESCRIPTION_MAX_LENGTH = 200;
/** Webhook delivery requests carry this User-Agent. */
export const WEBHOOK_USER_AGENT = 'techelusive-nest-auth-webhooks/1.0';

/**
 * Addresses webhooks may never be sent to (blocks SSRF: tricking the server into calling its own
 * private network or the cloud metadata service at 169.254.169.254).
 */
export const BLOCKED_IPV4_RANGES: ReadonlyArray<[network: string, prefixLength: number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
];
export const BLOCKED_IPV6_RANGES: ReadonlyArray<[network: string, prefixLength: number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // IPv4/IPv6 translation
  ['fc00::', 7], // unique local (private)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  // IPv4-mapped addresses (::ffff:a.b.c.d) are checked against the IPv4 list in network-safety.ts.
];

// ---------------------------------------------------------------------------------------------
// Account status. The backend alone moves an account between these; the app never sets them.
//
//   pending_verification -> active            when the required verifications are done
//   active -> suspended                       an admin blocks the account (reason recorded)
//   active -> deactivated -> active           the user pauses and later reactivates
//   any -> deleted                            personal data is removed; the row stays as a tombstone
// ---------------------------------------------------------------------------------------------

export const ACCOUNT_STATUS = {
  pendingVerification: 'PENDING_VERIFICATION',
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  deactivated: 'DEACTIVATED',
  deleted: 'DELETED',
} as const;
export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];
export const ACCOUNT_STATUSES = Object.values(ACCOUNT_STATUS) as AccountStatus[];

// ---------------------------------------------------------------------------------------------
// Organizations and roles.
// ---------------------------------------------------------------------------------------------

/** Roles inside an organization, from most to least powerful. */
export const ORGANIZATION_ROLE = { owner: 'owner', admin: 'admin', member: 'member' } as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLE)[keyof typeof ORGANIZATION_ROLE];
export const ORGANIZATION_ROLES = Object.values(ORGANIZATION_ROLE) as OrganizationRole[];
/** Higher number = more power. An admin can manage members and admins; only owners can manage owners. */
export const ORGANIZATION_ROLE_RANK: Record<OrganizationRole, number> = {
  [ORGANIZATION_ROLE.owner]: 3,
  [ORGANIZATION_ROLE.admin]: 2,
  [ORGANIZATION_ROLE.member]: 1,
};
/** Most organizations one user may belong to. */
export const MAXIMUM_ORGANIZATIONS_PER_USER = 100;

/** Role names: letters, digits, "_", "-", ":" (e.g. "user", "seller", "orders:read"). */
export const ROLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_:-]{0,49}$/;
/** Role every new user gets unless the app's settings say otherwise. */
export const DEFAULT_USER_ROLE = 'user';
/** Role allowed to use the /auth/admin endpoints unless the app's settings say otherwise. */
export const DEFAULT_ADMIN_ROLE = 'admin';
export const MAXIMUM_ROLES_PER_USER = 20;
/** Longest suspension reason an admin may record. */
export const SUSPENSION_REASON_MAX_LENGTH = 500;

// ---------------------------------------------------------------------------------------------
// Input formats.
// ---------------------------------------------------------------------------------------------

/** Phone numbers must be in international E.164 form, e.g. +919876543210. */
export const PHONE_NUMBER_PATTERN = /^\+[1-9]\d{7,14}$/;
export const EMAIL_MAX_LENGTH = 254;
/**
 * A practical email check: something@domain.tld with no spaces. Real proof that an address works
 * is the verification email, not a regular expression.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const DISPLAY_NAME_MAX_LENGTH = 100;
/** Longest phone number accepted as typed (spaces and dashes are removed afterwards). */
export const PHONE_NUMBER_INPUT_MAX_LENGTH = 32;
/** Longest token accepted in a request body; real tokens are much shorter, this just blocks junk. */
export const RANDOM_TOKEN_INPUT_MAX_LENGTH = 128;
/** Longest one-time or 2FA code accepted in a request body. */
export const CODE_INPUT_MAX_LENGTH = 16;
export const ORGANIZATION_NAME_MAX_LENGTH = 100;
/** Organization handles such as "acme-india". */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
/** User agent strings are cut to this length before saving. */
export const USER_AGENT_MAX_LENGTH = 300;

// ---------------------------------------------------------------------------------------------
// Pagination for admin lists.
// ---------------------------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 50;
export const MAXIMUM_PAGE_SIZE = 200;

// ---------------------------------------------------------------------------------------------
// Limits for settings changed by admins at runtime (so a typo can't, say, make tokens last a year).
// ---------------------------------------------------------------------------------------------

export const SETTINGS_LIMITS = {
  maximumRolesInList: 10,
  maximumAllowedEmailDomains: 100,
  maximumCountryCodes: 250,
  maximumClientIds: 10,
  facebookAppIdMaxLength: 50,
  codeLength: { minimum: 6, maximum: 8 },
  codeExpiresInMinutes: { minimum: 1, maximum: 15 },
  accessTokenMinutes: { minimum: 5, maximum: 60 },
  refreshTokenDays: { minimum: 1, maximum: 90 },
  sessionDays: { minimum: 1, maximum: 365 },
  resendAfterSeconds: { minimum: 30, maximum: 300 },
  emailVerificationLinkHours: { minimum: 1, maximum: 72 },
  passwordResetLinkMinutes: { minimum: 10, maximum: 180 },
  magicLinkMinutes: { minimum: 5, maximum: 60 },
  emailChangeLinkMinutes: { minimum: 10, maximum: 240 },
  invitationDays: { minimum: 1, maximum: 30 },
  twoFactorChallengeMinutes: { minimum: 2, maximum: 15 },
  expiredRecordDays: { minimum: 1, maximum: 90 },
  webhookDeliveryDays: { minimum: 1, maximum: 365 },
  /** 0 keeps the audit log forever. */
  auditLogDays: { minimum: 0, maximum: 3650 },
} as const;

/** An email domain such as "myapp.com". */
export const EMAIL_DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
/** A country calling code such as "+91". */
export const COUNTRY_CALLING_CODE_PATTERN = /^\+[1-9]\d{0,3}$/;
/** An OAuth client id (Google client id, Apple bundle / services id). */
export const OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._:\/-]{3,255}$/;

// ---------------------------------------------------------------------------------------------
// Named values. Every fixed value the code compares against or sends lives here, and the
// TypeScript types are derived from these objects, so a typo cannot compile.
// ---------------------------------------------------------------------------------------------

/** How a user proved who they are. Stored on the session and in the token's "amr" claim. */
export const SIGN_IN_METHOD = {
  password: 'password',
  emailOtp: 'email_otp',
  magicLink: 'magic_link',
  phoneOtp: 'phone_otp',
  google: 'google',
  apple: 'apple',
  facebook: 'facebook',
  passkey: 'passkey',
} as const;
export type SignInMethod = (typeof SIGN_IN_METHOD)[keyof typeof SIGN_IN_METHOD];
/** Added to "amr" when the user also passed two-factor authentication. */
export const TWO_FACTOR_AMR_VALUE = 'two_factor';

/** The "status" field of sign-in and register responses. */
export const SIGN_IN_STATUS = {
  signedIn: 'signed_in',
  twoFactorRequired: 'two_factor_required',
  verificationRequired: 'verification_required',
} as const;

/** Details a new account may need, listed in VALIDATION_ERROR's `missingSignUpDetails`. */
export const SIGN_UP_DETAIL = {
  firstName: 'firstName',
  lastName: 'lastName',
  acceptTerms: 'acceptTerms',
  acceptPrivacyPolicy: 'acceptPrivacyPolicy',
  email: 'email',
} as const;

/** What a user may still have to verify before the account becomes ACTIVE. */
export const PENDING_VERIFICATION = { email: 'email', phone: 'phone' } as const;
export type PendingVerification = (typeof PENDING_VERIFICATION)[keyof typeof PENDING_VERIFICATION];

/** Half-finished sign-ins (auth_sign_in_challenges.purpose). */
export const CHALLENGE_PURPOSE = {
  twoFactor: 'two_factor',
  passkeyRegistration: 'passkey_registration',
  passkeySignIn: 'passkey_sign_in',
  reactivateAccount: 'reactivate_account',
} as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSE)[keyof typeof CHALLENGE_PURPOSE];

/** Emailed single-use links (auth_link_tokens.purpose). */
export const LINK_PURPOSE = {
  verifyEmail: 'verify_email',
  resetPassword: 'reset_password',
  magicSignIn: 'magic_sign_in',
  changeEmail: 'change_email',
} as const;
export type LinkTokenPurpose = (typeof LINK_PURPOSE)[keyof typeof LINK_PURPOSE];

/** Where a one-time code is sent (auth_one_time_codes.channel). */
export const CODE_CHANNEL = { email: 'email', sms: 'sms' } as const;
export type CodeChannel = (typeof CODE_CHANNEL)[keyof typeof CODE_CHANNEL];

/** State of one webhook delivery. */
export const WEBHOOK_DELIVERY_STATUS = { pending: 'pending', delivered: 'delivered', failed: 'failed' } as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUS)[keyof typeof WEBHOOK_DELIVERY_STATUS];
/** Event name of the delivery sent by "test webhook". */
export const WEBHOOK_TEST_EVENT_NAME = 'webhook.test';

/** The `type` of each email the library asks the app to send. */
export const EMAIL_TYPE = {
  verifyEmail: 'verify_email',
  resetPassword: 'reset_password',
  magicSignIn: 'magic_sign_in',
  signInCode: 'sign_in_code',
  organizationInvitation: 'organization_invitation',
  passwordChanged: 'password_changed',
  newSignIn: 'new_sign_in',
  /** To the NEW address: a link that confirms the change. */
  confirmEmailChange: 'confirm_email_change',
  /** To the OLD address after the change, so the owner notices an unwanted change. */
  emailChanged: 'email_changed',
} as const;

/** Why a session ended (auth_sessions.revoked_reason, "session.revoked" event). */
export const SESSION_END_REASON = {
  signedOut: 'signed_out',
  signedOutEverywhere: 'signed_out_everywhere',
  signedOutByUser: 'signed_out_by_user',
  signedOutByAdmin: 'signed_out_by_admin',
  refreshTokenReused: 'refresh_token_reused',
  accountNotActive: 'account_not_active',
  accountSuspended: 'account_suspended',
  accountDeactivated: 'account_deactivated',
  accountDeleted: 'account_deleted',
  passwordReset: 'password_reset',
  passwordChanged: 'password_changed',
  twoFactorEnabled: 'two_factor_enabled',
  emailProvenByOwner: 'email_proven_by_owner',
} as const;
export type SessionEndReason = (typeof SESSION_END_REASON)[keyof typeof SESSION_END_REASON];

/** Why a sign-in failed ("user.sign_in_failed" event). */
export const SIGN_IN_FAILURE_REASON = {
  wrongEmailOrPassword: 'wrong_email_or_password',
  wrongTwoFactorCode: 'wrong_two_factor_code',
  passkeySignatureInvalid: 'passkey_signature_invalid',
  accountNotVerified: 'account_not_verified',
  accountSuspended: 'account_suspended',
} as const;
export type SignInFailureReason = (typeof SIGN_IN_FAILURE_REASON)[keyof typeof SIGN_IN_FAILURE_REASON];

/** How a password changed ("user.password_changed" event, `how`). */
export const PASSWORD_CHANGE_KIND = {
  reset: 'reset',
  changed: 'changed',
  firstSet: 'set',
  removedUnverified: 'removed_unverified_password',
} as const;
export type PasswordChangeKind = (typeof PASSWORD_CHANGE_KIND)[keyof typeof PASSWORD_CHANGE_KIND];

/** A sign-in method a user may remove (checked so they always keep at least one). */
export const REMOVABLE_SIGN_IN_METHOD = { password: 'password', social: 'social', passkey: 'passkey' } as const;
export type RemovableSignInMethod = (typeof REMOVABLE_SIGN_IN_METHOD)[keyof typeof REMOVABLE_SIGN_IN_METHOD];

/** Who did something, in the audit log's performedBy: "admin:<id>", "user:<id>". */
export const PERFORMED_BY_PREFIX = { admin: 'admin:', user: 'user:' } as const;

/** Encryption context "purpose" values: an encrypted value only decrypts for the same purpose and row. */
export const ENCRYPTION_PURPOSE = {
  signingKey: 'signing_key',
  totpSecret: 'totp_secret',
  webhookSigningSecret: 'webhook_signing_secret',
} as const;
/** Stored encrypted values start with "<method>:", telling which method encrypted them. */
export const ENCRYPTED_VALUE_METHOD = { kms: 'kms', local: 'local' } as const;

/** Sort orders used in queries. */
export const SORT_ORDER = { newestFirst: 'DESC', oldestFirst: 'ASC' } as const;

/** Smallest page number in paged lists. */
export const FIRST_PAGE = 1;

/** Value of NODE_ENV in production. */
export const PRODUCTION_ENVIRONMENT = 'production';

// ---------------------------------------------------------------------------------------------
// Cryptography names (Node crypto / JOSE identifiers).
// ---------------------------------------------------------------------------------------------

/** Text encodings used with Buffer. */
export const TEXT_ENCODING = { utf8: 'utf8', base64: 'base64', base64Url: 'base64url', hex: 'hex' } as const;
/** Hash functions. SHA-1 appears only where a standard requires it (TOTP, breached-password API). */
export const HASH_ALGORITHM = { sha256: 'sha256', sha1: 'sha1' } as const;
/** Cipher for the development-only local encryption key. */
export const LOCAL_ENCRYPTION_CIPHER = 'aes-256-gcm';
/** JWT ECDSA signatures use the raw r||s form, not DER. */
export const ECDSA_SIGNATURE_ENCODING = 'ieee-p1363';
/** Token-signing key pair: an elliptic-curve key on P-256 (what ES256 means). */
export const SIGNING_KEY_PAIR_TYPE = 'ec';
export const SIGNING_KEY_CURVE = 'P-256';
/** JSON Web Key fields and values. */
export const JWK_EXPORT_FORMAT = 'jwk';
export const JWK_KEY_TYPE = { ellipticCurve: 'EC', rsa: 'RSA' } as const;
export const JWK_USE_SIGNATURE = 'sig';
/** Separator between an encrypted value's method prefix and its data ("kms:..."). */
export const ENCRYPTED_VALUE_SEPARATOR = ':';
/** Random salt size for hashed short codes. */
export const SHORT_CODE_SALT_BYTES = 16;
/** Authenticator apps read QR codes holding "otpauth://totp/<label>?<parameters>". */
export const AUTHENTICATOR_APP_URL_PREFIX = 'otpauth://totp/';
export const URL_QUERY_SEPARATOR = '?';
/** Name of the TOTP hash in authenticator-app URLs (otpauth://...&algorithm=SHA1). */
export const TOTP_URL_ALGORITHM_NAME = 'SHA1';

// ---------------------------------------------------------------------------------------------
// HTTP routes. Every path the library serves is defined here (and documented in docs/endpoints).
// Paths with ":name" use the parameter names in ROUTE_PARAM.
// ---------------------------------------------------------------------------------------------

export const ROUTE_PARAM = {
  provider: 'provider',
  sessionId: 'sessionId',
  passkeyId: 'passkeyId',
  organizationId: 'organizationId',
  memberUserId: 'memberUserId',
  invitationId: 'invitationId',
  userId: 'userId',
  apiKeyId: 'apiKeyId',
  webhookId: 'webhookId',
  deliveryId: 'deliveryId',
} as const;

export const ROUTES = {
  /** Email + password, email verification, passwordless and account routes share this prefix. */
  auth: {
    prefix: 'auth',
    register: 'register',
    login: 'login',
    emailSendVerification: 'email/send-verification',
    emailVerify: 'email/verify',
    emailSendOtp: 'email/send-otp',
    emailVerifyOtp: 'email/verify-otp',
    magicLinkSend: 'magic-link/send',
    magicLinkVerify: 'magic-link/verify',
    phoneSendOtp: 'phone/send-otp',
    phoneVerifyOtp: 'phone/verify-otp',
    passwordForgot: 'password/forgot',
    passwordReset: 'password/reset',
    passwordChange: 'password/change',
    refresh: 'refresh',
    logout: 'logout',
    logoutAll: 'logout-all',
    me: 'me',
    signInMethods: 'sign-in-methods',
    sessions: 'sessions',
    session: 'sessions/:sessionId',
    deactivate: 'deactivate',
    reactivate: 'reactivate',
    emailChange: 'email/change',
    emailChangeConfirm: 'email/change/confirm',
    exportMyData: 'me/export',
    health: 'health',
  },
  social: {
    prefix: 'auth/social',
    signIn: ':provider',
    link: ':provider/link',
    unlink: ':provider',
  },
  passkeys: {
    prefix: 'auth/passkeys',
    registerOptions: 'register/options',
    registerVerify: 'register/verify',
    signInOptions: 'sign-in/options',
    signInVerify: 'sign-in/verify',
    passkey: ':passkeyId',
  },
  twoFactor: {
    prefix: 'auth/2fa',
    setup: 'setup',
    enable: 'enable',
    disable: 'disable',
    backupCodes: 'backup-codes',
    verify: 'verify',
  },
  organizations: {
    prefix: 'auth/organizations',
    switch: 'switch',
    acceptInvitation: 'invitations/accept',
    organization: ':organizationId',
    members: ':organizationId/members',
    member: ':organizationId/members/:memberUserId',
    invitations: ':organizationId/invitations',
    invitation: ':organizationId/invitations/:invitationId',
  },
  admin: {
    prefix: 'auth/admin',
    users: 'users',
    user: 'users/:userId',
    userRoles: 'users/:userId/roles',
    userSuspend: 'users/:userId/suspend',
    userUnsuspend: 'users/:userId/unsuspend',
    userVerifyEmail: 'users/:userId/verify-email',
    userResetTwoFactor: 'users/:userId/reset-2fa',
    userLogoutAll: 'users/:userId/logout-all',
    settings: 'settings',
    auditLog: 'audit-log',
    rotateSigningKey: 'signing-keys/rotate',
    apiKeys: 'api-keys',
    apiKey: 'api-keys/:apiKeyId',
    webhooks: 'webhooks',
    webhook: 'webhooks/:webhookId',
    webhookRotateSecret: 'webhooks/:webhookId/rotate-secret',
    webhookTest: 'webhooks/:webhookId/test',
    webhookDeliveries: 'webhooks/:webhookId/deliveries',
    webhookRetryDelivery: 'webhooks/:webhookId/deliveries/:deliveryId/retry',
    stats: 'stats',
    runCleanup: 'maintenance/cleanup',
  },
  wellKnown: {
    prefix: '.well-known',
    jwks: 'jwks.json',
  },
} as const;

/** HTTP header names and values the library reads or sends. */
export const HTTP_HEADER = {
  authorization: 'authorization',
  userAgent: 'user-agent',
  contentType: 'Content-Type',
  accept: 'accept',
  cacheControl: 'Cache-Control',
  retryAfter: 'Retry-After',
  outgoingUserAgent: 'User-Agent',
  cookie: 'cookie',
  setCookie: 'Set-Cookie',
  origin: 'origin',
} as const;
export const JSON_CONTENT_TYPE = 'application/json';
/** Requests of other kinds (WebSockets, microservices) are not checked by AuthGuard. */
export const HTTP_CONTEXT_TYPE = 'http';
/** The JWKS document may be cached by clients for 5 minutes. */
export const JWKS_CACHE_CONTROL = 'public, max-age=300';

// ---------------------------------------------------------------------------------------------
// Rate-limit counter keys. One builder per counter so the same limit always uses the same key.
// ---------------------------------------------------------------------------------------------

export const RATE_LIMIT_KEY = {
  signUpPerIp: (ipAddress: string | null) => `sign-up:ip:${ipAddress}`,
  signInPerIp: (ipAddress: string | null) => `sign-in:ip:${ipAddress}`,
  signInPerAccount: (email: string) => `sign-in:account:${email}`,
  sendCodePerIp: (ipAddress: string | null) => `send-code:ip:${ipAddress}`,
  sendCodePerDestination: (destination: string) => `send-code:destination:${destination}`,
  sendEmailLinkPerIp: (ipAddress: string | null) => `email-link:ip:${ipAddress}`,
  sendEmailLinkPerEmail: (email: string) => `email-link:email:${email}`,
  refreshPerIp: (ipAddress: string | null) => `refresh:ip:${ipAddress}`,
  twoFactorPerUser: (userId: string) => `two-factor:user:${userId}`,
  changePasswordPerUser: (userId: string) => `change-password:user:${userId}`,
  changeEmailPerUser: (userId: string) => `change-email:user:${userId}`,
  exportDataPerUser: (userId: string) => `export-data:user:${userId}`,
} as const;

/** Builds the audit log's performedBy value. */
export const PERFORMED_BY = {
  admin: (adminUserId: string) => `${PERFORMED_BY_PREFIX.admin}${adminUserId}`,
  user: (userId: string) => `${PERFORMED_BY_PREFIX.user}${userId}`,
} as const;

/** User agent recorded for actions taken by scripts and jobs (SYSTEM_REQUEST). */
export const SYSTEM_USER_AGENT = 'system';

/** Names shown in log lines, one per component. */
export const LOG_CONTEXT = {
  exceptionFilter: 'AuthExceptionFilter',
  rateLimiter: 'RateLimiter',
  apiKeys: 'ApiKeys',
  events: 'AuthEvents',
  notifications: 'Notifications',
  passwordPolicy: 'PasswordPolicy',
  sessions: 'Sessions',
  signingKeys: 'SigningKeys',
  socialProviders: 'SocialProviders',
  webhookDelivery: 'WebhookDelivery',
  consoleEmailSender: 'ConsoleEmailSender',
  dataRetention: 'DataRetention',
} as const;

/** In-process caches are emptied when they grow past these sizes (protects memory under attack). */
export const SESSION_CHECK_CACHE_MAX_ENTRIES = 100_000;
export const IN_MEMORY_RATE_LIMIT_MAX_ENTRIES = 50_000;

// ---------------------------------------------------------------------------------------------
// Problem texts returned to API clients in `problems` / `requirements` lists.
// ---------------------------------------------------------------------------------------------

export const PASSWORD_REQUIREMENT = {
  minimumLength: (minimumLength: number) => `at least ${minimumLength} characters`,
  maximumLength: (maximumLength: number) => `at most ${maximumLength} characters`,
  uppercaseLetter: 'an uppercase letter',
  lowercaseLetter: 'a lowercase letter',
  number: 'a number',
  symbol: 'a symbol',
  differentFromCurrent: 'different from your current password',
} as const;

/** Trailing slashes removed from the issuer URL ("https://api.myapp.com/" -> "https://api.myapp.com"). */
export const TRAILING_SLASHES_PATTERN = /\/+$/;

/** Characters removed from typed input before it is checked. */
export const PHONE_FORMATTING_CHARACTERS_PATTERN = /[\s\-().]/g;
export const BACKUP_CODE_FORMATTING_CHARACTERS_PATTERN = /[\s-]/g;
export const WHITESPACE_PATTERN = /\s/g;
export const BASE32_PADDING_PATTERN = /=+$/;
export const LEADING_PLUS_PATTERN = /^\+/;
/** Only base64url characters (the body of a random token). */
export const BASE64URL_TEXT_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Only digits (a typed TOTP code). */
export const DIGITS_ONLY_PATTERN = /^\d+$/;
/** Characters with special meaning in SQL LIKE patterns, escaped in admin user search. */
export const SQL_LIKE_SPECIAL_CHARACTERS_PATTERN = /[\\%_]/g;
export const SQL_LIKE_ESCAPE_CHARACTER = '\\';
export const SQL_LIKE_ANY_TEXT = '%';

/** Joins nested settings field names: "password.minimumLength". */
export const SETTINGS_PATH_SEPARATOR = '.';

/** Patterns for the character rules above. */
export const UPPERCASE_LETTER_PATTERN = /\p{Lu}/u;
export const LOWERCASE_LETTER_PATTERN = /\p{Ll}/u;
export const DIGIT_PATTERN = /\d/;

export const VALIDATION_PROBLEM = {
  namesRequired: 'firstName and lastName are required',
  tooManyOrganizations: 'too many organizations',
  tooManyPasskeys: 'too many passkeys',
  tooManyWebhooks: 'too many webhooks',
  unknownEventNames: (unknownNames: string[]) => `unknown event names: ${unknownNames.join(', ')}`,
  settingsNotAnObject: 'settings must be an object',
  refreshLongerThanSession: 'tokens.refreshTokenDays cannot be more than tokens.sessionDays',
  noSignInMethodEnabled: 'at least one sign-in method must stay enabled',
  googleClientIdsRequired: 'google.clientIds is required when Google is enabled',
  appleClientIdsRequired: 'apple.clientIds is required when Apple is enabled',
  facebookAppIdRequired: 'facebook.appId is required when Facebook is enabled',
  adminRolesRequired: 'admin.adminRoles must name at least one role',
  /** "password.minimumLength must not be less than 8" */
  atPath: (path: string, message: string) => `${path}: ${message}`,
  emailDomainFormat: 'each domain must look like example.com',
  countryCodeFormat: 'each code must look like +91',
} as const;

/** Problems found in AuthModule options at startup (the app refuses to start and lists them). */
export const OPTIONS_PROBLEM = {
  dataSourceRequired: 'dataSource is required (your TypeORM DataSource)',
  emailSenderRequired: 'emailSender with a send() method is required',
  issuerMustBeHttps: 'issuer must be an https URL in production',
  issuerMustBeUrl: 'issuer must be a full URL, e.g. https://api.myapp.com',
  encryptionRequired: 'encryption is required: { awsKmsKeyId, awsRegion } or, for development, { localKey }',
  localKeyNotForProduction: 'encryption.localKey is for development only; use AWS KMS in production',
  localKeyWrongSize: `encryption.localKey must be ${LOCAL_ENCRYPTION_KEY_BYTES} random bytes in base64 (openssl rand -base64 32)`,
  kmsDetailsRequired: 'encryption needs both awsKmsKeyId and awsRegion',
  legacyLocalKeyWrongSize: `encryption.legacyLocalKey must be the old ${LOCAL_ENCRYPTION_KEY_BYTES}-byte base64 local key`,
  relyingPartyIdMustBeDomain: 'passkeys.relyingPartyId must be a bare domain such as "myapp.com"',
  relyingPartyNameRequired: 'passkeys.relyingPartyName is required',
  allowedOriginsRequired: 'passkeys.allowedOrigins needs at least one origin',
  cookieAllowedOriginsRequired: 'refreshTokenCookie.allowedOrigins needs at least one origin, e.g. ["https://app.myapp.com"]',
  hostCookieRules: 'refreshTokenCookie: a name starting with "__Host-" requires path "/" and no domain',
  redisRequiredInProduction:
    'redisUrl is required in production so rate limits are shared by every server (set singleServer: true if you really run one process)',
} as const;

/** Why a webhook URL was refused (UNSAFE_WEBHOOK_URL `problem`). */
export const URL_SAFETY_PROBLEM = {
  invalidUrl: 'not a valid URL',
  hasCredentials: 'URL must not contain a username or password',
  notHttps: 'URL must use https',
  doesNotResolve: 'host name does not resolve',
  privateAddress: 'URL points to a private network address',
} as const;

/** lastError of a webhook delivery that could not be sent. */
export const WEBHOOK_DELIVERY_ERROR = {
  webhookUnavailable: 'webhook removed or disabled',
  unsafeUrl: (problem: string) => `unsafe URL: ${problem}`,
  httpStatus: (status: number) => `HTTP ${status}`,
} as const;
/** Message inside the "webhook.test" delivery. */
export const WEBHOOK_TEST_MESSAGE = 'This is a test delivery.';

// ---------------------------------------------------------------------------------------------
// HTTP details for outgoing calls and the network-safety check.
// ---------------------------------------------------------------------------------------------

export const HTTP_METHOD = { post: 'POST' } as const;
/** Outgoing webhook calls never follow redirects (a redirect could point at a private address). */
export const FETCH_REDIRECT_MODE_MANUAL = 'manual';
/** Responses in this range count as success. */
export const SUCCESS_STATUS_RANGE = { from: 200, toExclusive: 300 } as const;
export const URL_PROTOCOL = { https: 'https:', http: 'http:' } as const;
/** Hosts allowed over plain http outside production, for local webhook testing. */
export const LOCAL_DEVELOPMENT_HOSTS = ['localhost', '127.0.0.1'];
/** Node's names and numbers for IP versions. */
export const IP_FAMILY = { ipv4: 'ipv4', ipv6: 'ipv6' } as const;
export const IP_VERSION_6 = 6;
/** "::ffff:10.0.0.1" style IPv4-mapped IPv6 address; group 1 is the IPv4 part. */
export const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
/** Square brackets around IPv6 hosts in URLs ("[::1]"). */
export const URL_IPV6_BRACKETS_PATTERN = /^\[|\]$/g;

// ---------------------------------------------------------------------------------------------
// Third-party APIs.
// ---------------------------------------------------------------------------------------------

/** haveibeenpwned.com range API: padded responses hide which prefix was asked about. */
export const BREACHED_PASSWORD_API = {
  paddingHeader: 'Add-Padding',
  paddingHeaderValue: 'true',
  lineSeparator: '\n',
  countSeparator: ':',
} as const;

/** Facebook Graph API paths and query parameters. */
export const FACEBOOK_API = {
  debugTokenPath: '/debug_token',
  profilePath: '/me',
  inputTokenParameter: 'input_token',
  accessTokenParameter: 'access_token',
  fieldsParameter: 'fields',
  appSecretProofParameter: 'appsecret_proof',
  appAccessToken: (appId: string, appSecret: string) => `${appId}|${appSecret}`,
} as const;

/** Apple sends email_verified either as a boolean or as this string. */
export const APPLE_TRUE_STRING = 'true';

/** MSG91 request details. */
export const MSG91_API = {
  authKeyHeader: 'authkey',
  defaultCodeVariableName: 'otp',
  errorResponseType: 'error',
} as const;

// ---------------------------------------------------------------------------------------------
// Formats.
// ---------------------------------------------------------------------------------------------

/** JWT: header.payload.signature */
export const JWT_PART_SEPARATOR = '.';
export const JWT_PART_COUNT = 3;
/** Random tokens look like "<prefix>_<43 base64url characters>". */
export const TOKEN_PREFIX_SEPARATOR = '_';
/** Length of 32 random bytes written in base64url. */
export const RANDOM_TOKEN_BASE64URL_LENGTH = 43;
/** Short codes are hashed as "<salt>:<code>". */
export const SALTED_CODE_SEPARATOR = ':';
/** Digits of a numeric code are chosen from 0 to 9. */
export const DECIMAL_BASE = 10;
/** TOTP: an 8-byte big-endian counter; codes are left-padded with zeros. */
export const TOTP_COUNTER_BYTES = 8;
export const TOTP_CODE_PAD_CHARACTER = '0';
/** Authenticator-app label "Issuer:account". */
export const TOTP_LABEL_SEPARATOR = ':';
/** Base32 packs 5 bits per character; bytes have 8 bits. */
export const BASE32_BITS_PER_CHARACTER = 5;
export const BITS_PER_BYTE = 8;
export const BASE32_CHARACTER_MASK = 0b11111;
export const BYTE_MASK = 0xff;
/** Backup codes are shown as "k7m2-x9p4". */
export const BACKUP_CODE_DISPLAY_SEPARATOR = '-';
/** First and last name are joined with a space for display. */
export const DISPLAY_NAME_SEPARATOR = ' ';
/** Email masking keeps the first character: "a***@mail.com". */
export const EMAIL_MASK = { visibleCharacters: 1, hiddenPart: '***', domainSeparator: '@' } as const;
/** Phone masking keeps the country code and the last 4 digits: "+91******3210". */
export const PHONE_MASK = { visibleStart: 3, visibleEnd: 4, maskCharacter: '*' } as const;
/** A bare passkey relying-party id is a domain, so it contains neither of these. */
export const RELYING_PARTY_ID_FORBIDDEN_CHARACTERS = ['/', ':'];

/** Webhook signature header: "t=<unix time>,v1=<hex HMAC>" over "<t>.<raw body>". */
export const WEBHOOK_SIGNATURE_FORMAT = {
  timestampKey: 't',
  signatureKey: 'v1',
  partSeparator: ',',
  keyValueSeparator: '=',
  signedContentSeparator: '.',
} as const;

// ---------------------------------------------------------------------------------------------
// Request metadata keys used by the guard and decorators.
// ---------------------------------------------------------------------------------------------

export const METADATA_KEY = {
  publicRoute: 'techelusive-auth:public-route',
  requiredRoles: 'techelusive-auth:required-roles',
  checkSessionInDatabase: 'techelusive-auth:check-session',
  apiKeyScopes: 'techelusive-auth:api-key-scopes',
  adminOnly: 'techelusive-auth:admin-only',
  clearsRefreshTokenCookie: 'techelusive-auth:clears-refresh-token-cookie',
  libraryController: 'techelusive-auth:library-controller',
} as const;

/** Name of the property the guard puts on the Express request (read by @CurrentUser). */
export const CALLER_REQUEST_PROPERTY = 'techelusiveAuthCaller';

/** "Authorization: Bearer <token>" */
export const BEARER_TOKEN_PATTERN = /^Bearer\s+(\S+)$/i;

/** Longest API key name. */
export const API_KEY_NAME_MAX_LENGTH = 100;
/** Most scopes on one API key. */
export const MAXIMUM_API_KEY_SCOPES = 50;
/** API key scopes look like "rides:read" or "admin". */
export const API_KEY_SCOPE_PATTERN = /^[a-z][a-z0-9_.-]{0,49}(:[a-z0-9_.*-]{1,50})?$/;
/** Characters of an API key (after "ak_") shown in lists so people can tell keys apart. */
export const API_KEY_PREVIEW_LENGTH = 6;
/** "Last used" on an API key is updated at most this often, to avoid a write on every request. */
export const API_KEY_LAST_USED_UPDATE_SECONDS = 60;
/** Header used by servers calling your API with an API key. */
export const API_KEY_HEADER = 'x-api-key';

// ---------------------------------------------------------------------------------------------
// Events. Emitted inside your app (AuthEvents) and sent to webhooks.
// ---------------------------------------------------------------------------------------------

export const AUTH_EVENTS = {
  userCreated: 'user.created',
  userUpdated: 'user.updated',
  userDeleted: 'user.deleted',
  userSignedIn: 'user.signed_in',
  userSignInFailed: 'user.sign_in_failed',
  userSignedOut: 'user.signed_out',
  userActivated: 'user.activated',
  userSuspended: 'user.suspended',
  userDeactivated: 'user.deactivated',
  userReactivated: 'user.reactivated',
  userRolesChanged: 'user.roles_changed',
  phoneVerified: 'user.phone_verified',
  onboardingCompleted: 'user.onboarding_completed',
  emailVerified: 'user.email_verified',
  emailChangeRequested: 'user.email_change_requested',
  emailChanged: 'user.email_changed',
  passwordChanged: 'user.password_changed',
  passwordResetRequested: 'user.password_reset_requested',
  twoFactorEnabled: 'user.two_factor_enabled',
  twoFactorDisabled: 'user.two_factor_disabled',
  passkeyAdded: 'user.passkey_added',
  passkeyRemoved: 'user.passkey_removed',
  socialAccountLinked: 'user.social_account_linked',
  socialAccountUnlinked: 'user.social_account_unlinked',
  sessionRevoked: 'session.revoked',
  refreshTokenReused: 'session.refresh_token_reused',
  organizationCreated: 'organization.created',
  organizationDeleted: 'organization.deleted',
  organizationMemberAdded: 'organization.member_added',
  organizationMemberRemoved: 'organization.member_removed',
  organizationMemberRoleChanged: 'organization.member_role_changed',
  organizationUpdated: 'organization.updated',
  organizationInvitationSent: 'organization.invitation_sent',
  apiKeyCreated: 'api_key.created',
  apiKeyRevoked: 'api_key.revoked',
  settingsChanged: 'settings.changed',
} as const;

export type AuthEventName = (typeof AUTH_EVENTS)[keyof typeof AUTH_EVENTS];

// ---------------------------------------------------------------------------------------------
// Success messages. Several are deliberately the same whether or not an account exists, so the
// API never tells a stranger which emails or phone numbers are registered.
// ---------------------------------------------------------------------------------------------

export const SUCCESS_MESSAGES = {
  registered: 'Your account has been created. Please verify your details to continue.',
  verificationEmailSent: 'If this email needs verifying, a verification link is on its way.',
  emailVerified: 'Your email has been verified.',
  passwordResetEmailSent: 'If an account exists for this email, a password reset link is on its way.',
  passwordReset: 'Your password has been reset. Please sign in with your new password.',
  passwordChanged: 'Your password has been changed. Other devices have been signed out.',
  codeSent: 'If this destination can receive codes, a code is on its way.',
  magicLinkSent: 'If this email can sign in, a sign-in link is on its way.',
  signedOut: 'You have been signed out.',
  signedOutEverywhere: 'You have been signed out on all devices.',
  accountDeactivated: 'Your account has been deactivated. Sign in again at any time to reactivate it.',
  accountDeleted: 'Your account has been deleted.',
  emailChangeRequested: 'If this email can be used, a confirmation link is on its way to it.',
  emailChanged: 'Your email has been changed.',
} as const;

// ---------------------------------------------------------------------------------------------
// Errors. Every error has an HTTP status, a stable `code` apps can check, and a message safe to
// show users. Codes are stable, so apps can switch on them. Messages never reveal whether an email or phone
// number has an account.
//
// Response shape: { "success": false, "code": "INVALID_CREDENTIALS", "message": "..." }
// ---------------------------------------------------------------------------------------------

export const AUTH_ERRORS = {
  validationFailed: { status: 400, code: 'VALIDATION_ERROR', message: 'Some fields are missing or invalid.' },
  invalidEmail: { status: 400, code: 'INVALID_EMAIL', message: 'Enter a valid email address.' },
  invalidPhone: { status: 400, code: 'INVALID_PHONE', message: 'Enter a valid phone number with country code, e.g. +919876543210.' },
  invalidPassword: { status: 400, code: 'INVALID_PASSWORD', message: 'This password does not meet the password rules.' },
  breachedPassword: {
    status: 400,
    code: 'INVALID_PASSWORD',
    message: 'This password has appeared in a data breach. Please choose a different one.',
  },
  termsNotAccepted: { status: 400, code: 'TERMS_NOT_ACCEPTED', message: 'Please accept the terms of service.' },
  privacyPolicyNotAccepted: { status: 400, code: 'PRIVACY_POLICY_NOT_ACCEPTED', message: 'Please accept the privacy policy.' },
  emailDomainNotAllowed: { status: 400, code: 'EMAIL_DOMAIN_NOT_ALLOWED', message: 'Sign up is limited to approved email domains.' },
  phoneCountryNotAllowed: { status: 400, code: 'PHONE_COUNTRY_NOT_ALLOWED', message: 'Phone numbers from this country are not supported.' },

  invalidCredentials: { status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
  invalidOtp: { status: 400, code: 'INVALID_OTP', message: 'This code is incorrect.' },
  otpExpired: { status: 400, code: 'OTP_EXPIRED', message: 'This code has expired or was used too many times. Please request a new one.' },
  invalidOrExpiredLink: { status: 400, code: 'INVALID_TOKEN', message: 'This link is invalid, expired or already used.' },
  unauthorized: { status: 401, code: 'UNAUTHORIZED', message: 'Please sign in to continue.' },
  invalidAccessToken: { status: 401, code: 'INVALID_TOKEN', message: 'Your session has expired. Please sign in again.' },
  invalidRefreshToken: { status: 401, code: 'INVALID_TOKEN', message: 'Your session has expired. Please sign in again.' },
  invalidApiKey: { status: 401, code: 'INVALID_API_KEY', message: 'The API key is missing, invalid or revoked.' },
  invalidSocialToken: { status: 401, code: 'INVALID_SOCIAL_TOKEN', message: 'We could not confirm your sign-in with this provider.' },
  invalidPasskey: { status: 401, code: 'INVALID_PASSKEY', message: 'We could not confirm this passkey.' },
  invalidTwoFactorCode: { status: 401, code: 'INVALID_OTP', message: 'This code is incorrect.' },

  accountNotVerified: { status: 403, code: 'ACCOUNT_NOT_VERIFIED', message: 'Please finish verifying your account.' },
  accountSuspended: { status: 403, code: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended. Please contact support.' },
  accountDeactivated: { status: 403, code: 'ACCOUNT_DEACTIVATED', message: 'This account is deactivated. Reactivate it to continue.' },
  forbidden: { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to do this.' },
  missingApiKeyScope: { status: 403, code: 'FORBIDDEN', message: 'This API key is not allowed to do this.' },
  signUpClosed: { status: 403, code: 'SIGN_UP_CLOSED', message: 'Sign up is currently closed.' },
  signInMethodDisabled: { status: 403, code: 'SIGN_IN_METHOD_DISABLED', message: 'This sign-in method is not available.' },
  featureDisabled: { status: 403, code: 'FEATURE_DISABLED', message: 'This feature is not turned on.' },

  notFound: { status: 404, code: 'NOT_FOUND', message: 'Not found.' },

  accountAlreadyExists: { status: 409, code: 'ACCOUNT_ALREADY_EXISTS', message: 'An account with these details already exists.' },
  accountExistsWithOtherMethod: {
    status: 409,
    code: 'ACCOUNT_EXISTS_WITH_OTHER_METHOD',
    message: 'An account with this email already exists. Sign in your usual way, then link this account from your profile.',
  },
  socialAccountAlreadyLinked: { status: 409, code: 'SOCIAL_ACCOUNT_IN_USE', message: 'This account is already linked to another user.' },
  cannotRemoveLastSignInMethod: { status: 409, code: 'LAST_SIGN_IN_METHOD', message: 'Add another way to sign in before removing this one.' },
  twoFactorAlreadyEnabled: { status: 409, code: 'TWO_FACTOR_ALREADY_ENABLED', message: 'Two-factor authentication is already on.' },
  twoFactorNotEnabled: { status: 409, code: 'TWO_FACTOR_NOT_ENABLED', message: 'Two-factor authentication is not on.' },
  twoFactorSetupNotStarted: { status: 409, code: 'TWO_FACTOR_SETUP_NOT_STARTED', message: 'Start two-factor setup first.' },
  organizationSlugTaken: { status: 409, code: 'ORGANIZATION_SLUG_TAKEN', message: 'This organization handle is already taken.' },
  alreadyOrganizationMember: { status: 409, code: 'ALREADY_MEMBER', message: 'This person is already a member.' },
  lastOrganizationOwner: { status: 409, code: 'LAST_OWNER', message: 'An organization needs at least one owner.' },
  accountNotDeactivated: { status: 409, code: 'ACCOUNT_NOT_DEACTIVATED', message: 'This account is not deactivated.' },
  emailInUse: { status: 409, code: 'EMAIL_IN_USE', message: 'This email is already used by another account.' },
  emailUnchanged: { status: 400, code: 'EMAIL_UNCHANGED', message: 'This is already your email.' },
  recentSignInRequired: {
    status: 403,
    code: 'RECENT_SIGN_IN_REQUIRED',
    message: 'For your security, please sign in again and then retry.',
  },
  originNotAllowed: { status: 403, code: 'FORBIDDEN', message: 'This request did not come from an allowed website.' },

  tooManyRequests: { status: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' },
  resendTooSoon: { status: 429, code: 'TOO_MANY_REQUESTS', message: 'Please wait a minute before requesting another code.' },

  invalidSettings: { status: 400, code: 'INVALID_SETTINGS', message: 'Some settings are not valid.' },
  unsafeWebhookUrl: { status: 400, code: 'UNSAFE_WEBHOOK_URL', message: 'Webhook URLs must be public https addresses.' },
  notConfigured: { status: 501, code: 'NOT_CONFIGURED', message: 'This feature is not set up on the server.' },
  internalError: { status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again.' },
} as const;

export type AuthErrorName = keyof typeof AUTH_ERRORS;
/** Codes for Nest HTTP errors that are not AuthErrors (e.g. thrown by your own code or by Nest itself). */
export const ERROR_CODE_BY_HTTP_STATUS: Record<number, string> = {
  400: AUTH_ERRORS.validationFailed.code,
  401: AUTH_ERRORS.unauthorized.code,
  403: AUTH_ERRORS.forbidden.code,
  404: AUTH_ERRORS.notFound.code,
  409: 'CONFLICT',
  429: AUTH_ERRORS.tooManyRequests.code,
};

/** One entry of AUTH_ERRORS. */
export interface AuthErrorDefinition {
  status: number;
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------------------------
// Default settings.
// ---------------------------------------------------------------------------------------------

/**
 * The settings used when neither your code nor an admin has changed them.
 * Secure by default: only email + password is on, verification is required, short-lived tokens.
 */
export const DEFAULT_SETTINGS: AuthSettings = {
  registration: {
    enabled: true,
    defaultRoles: [DEFAULT_USER_ROLE],
    requireFirstAndLastName: true,
    requirePhoneNumber: false,
    requireTermsAcceptance: true,
    requirePrivacyPolicyAcceptance: true,
    allowedEmailDomains: [],
  },
  activation: {
    requireVerifiedEmail: true,
    requireVerifiedPhone: false,
  },
  password: {
    enabled: true,
    minimumLength: 10,
    requireUppercaseLetter: false,
    requireLowercaseLetter: false,
    requireNumber: false,
    requireSymbol: false,
    rejectBreachedPasswords: true,
    notifyOnChange: true,
  },
  emailVerification: { linkExpiresInHours: 24 },
  passwordReset: { linkExpiresInMinutes: 60 },
  emailChange: { linkExpiresInMinutes: 60 },
  emailOtp: { enabled: false, codeLength: 6, expiresInMinutes: 10, resendAfterSeconds: 60, allowSignUp: true },
  magicLink: { enabled: false, expiresInMinutes: 15, allowSignUp: true },
  phoneOtp: { enabled: false, codeLength: 6, expiresInMinutes: 10, resendAfterSeconds: 60, allowSignUp: true, allowedCountryCodes: [] },
  google: { enabled: false, clientIds: [] },
  apple: { enabled: false, clientIds: [] },
  facebook: { enabled: false, appId: '' },
  passkeys: { enabled: false },
  twoFactor: { enabled: true, challengeExpiresInMinutes: 5 },
  organizations: { enabled: false, allowUsersToCreate: true, invitationExpiresInDays: 7 },
  tokens: { accessTokenMinutes: 15, refreshTokenDays: 30, sessionDays: 90 },
  admin: { adminRoles: [DEFAULT_ADMIN_ROLE] },
  security: { notifyOnNewSignIn: false },
  retention: { enabled: true, expiredRecordDays: 7, webhookDeliveryDays: 30, auditLogDays: 365 },
};

// ---------------------------------------------------------------------------------------------
// Data retention (DataRetentionService).
// ---------------------------------------------------------------------------------------------

/** How often each server runs the cleanup, and how long after start the first run waits. */
export const DATA_RETENTION_INTERVAL_MS = HOUR_IN_SECONDS * SECOND_IN_MILLISECONDS;
export const DATA_RETENTION_FIRST_RUN_DELAY_MS = MINUTE_IN_SECONDS * SECOND_IN_MILLISECONDS;
/** Rows deleted per statement, so a cleanup never holds locks for long. */
export const DATA_RETENTION_BATCH_SIZE = 5000;
/** Most batches per table per run; the rest waits for the next run. */
export const DATA_RETENTION_MAX_BATCHES_PER_TABLE = 100;
/** Names of the cleanup steps, used as keys in the cleanup report. */
export const DATA_RETENTION_STEP = {
  endedSessions: 'endedSessions',
  expiredRefreshTokens: 'expiredRefreshTokens',
  linkTokens: 'linkTokens',
  oneTimeCodes: 'oneTimeCodes',
  signInChallenges: 'signInChallenges',
  organizationInvitations: 'organizationInvitations',
  webhookDeliveries: 'webhookDeliveries',
  auditLog: 'auditLog',
} as const;
export type DataRetentionStep = (typeof DATA_RETENTION_STEP)[keyof typeof DATA_RETENTION_STEP];
/** SQL condition marking a row of each step as old (`:cutoff` = now minus the days to keep). */
export const DATA_RETENTION_OLD_ROW_CONDITION: Record<DataRetentionStep, string> = {
  endedSessions: '(revoked_at IS NOT NULL AND revoked_at < :cutoff) OR expires_at < :cutoff',
  expiredRefreshTokens: 'expires_at < :cutoff',
  linkTokens: 'expires_at < :cutoff OR used_at < :cutoff',
  oneTimeCodes: 'expires_at < :cutoff OR used_at < :cutoff',
  signInChallenges: 'expires_at < :cutoff OR used_at < :cutoff',
  organizationInvitations: 'expires_at < :cutoff OR accepted_at < :cutoff OR revoked_at < :cutoff',
  // Pending deliveries are never removed: they still have to be sent.
  webhookDeliveries: `status <> '${WEBHOOK_DELIVERY_STATUS.pending}' AND created_at < :cutoff`,
  auditLog: 'created_at < :cutoff',
};
/**
 * One batch of old rows (by primary key), so each DELETE statement stays short.
 *
 * @param tableName - The table to clean (from TypeORM metadata, never user input).
 * @param oldRowCondition - Which rows count as old, from DATA_RETENTION_OLD_ROW_CONDITION.
 * @returns A WHERE clause using the :cutoff and :batchSize parameters.
 */
export const DATA_RETENTION_BATCH_CONDITION = (tableName: string, oldRowCondition: string) =>
  `id IN (SELECT id FROM ${tableName} WHERE ${oldRowCondition} LIMIT :batchSize)`;

// ---------------------------------------------------------------------------------------------
// Refresh token cookie (AuthOptions.refreshTokenCookie).
// ---------------------------------------------------------------------------------------------

/** Cookies named "__Host-..." are locked by the browser to Secure, path "/" and no domain. */
export const HOST_COOKIE_PREFIX = '__Host-';
export const COOKIE_SAME_SITE = { strict: 'Strict', lax: 'Lax', none: 'None' } as const;
export type CookieSameSite = (typeof COOKIE_SAME_SITE)[keyof typeof COOKIE_SAME_SITE];
export const REFRESH_TOKEN_COOKIE_DEFAULTS = {
  name: `${HOST_COOKIE_PREFIX}refresh_token`,
  /** "__Host-" cookies must use path "/" and no domain; with a custom name you may narrow it. */
  path: '/',
  sameSite: COOKIE_SAME_SITE.strict,
} as const;
/** Cookie attribute names, written by serializeCookie(). */
export const COOKIE_ATTRIBUTE = {
  maxAge: 'Max-Age',
  path: 'Path',
  domain: 'Domain',
  sameSite: 'SameSite',
  httpOnly: 'HttpOnly',
  secure: 'Secure',
} as const;
export const COOKIE_PAIR_SEPARATOR = ';';
/** Between a cookie's attributes in a Set-Cookie header. */
export const COOKIE_ATTRIBUTE_SEPARATOR = '; ';
export const COOKIE_NAME_VALUE_SEPARATOR = '=';
/** Response fields holding the refresh token; moved into the cookie when cookie mode is on. */
export const REFRESH_TOKEN_RESPONSE_FIELD = 'refreshToken';
/** Response field saying the refresh token is in the cookie instead of the body. */
export const REFRESH_TOKEN_IN_COOKIE_FIELD = 'refreshTokenInCookie';
/** Response field with the refresh token's expiry time (sets the cookie's lifetime). */
export const REFRESH_TOKEN_EXPIRES_AT_RESPONSE_FIELD = 'refreshTokenExpiresAt';

// ---------------------------------------------------------------------------------------------
// Health check and data export.
// ---------------------------------------------------------------------------------------------

export const HEALTH_STATUS = { ok: 'ok', error: 'error', notUsed: 'not_used' } as const;
export type HealthStatus = (typeof HEALTH_STATUS)[keyof typeof HEALTH_STATUS];
/** A health check that takes longer than this counts as failed. */
export const HEALTH_CHECK_TIMEOUT_MS = 2000;
/** The cheapest query that proves PostgreSQL answers. */
export const HEALTH_CHECK_QUERY = 'SELECT 1';
export const HEALTH_SERVICE_UNAVAILABLE_STATUS = 503;
/** Most audit-log entries included in "download my data" (newest first). */
export const DATA_EXPORT_AUDIT_LOG_LIMIT = 1000;
/** Window of the admin stats endpoint ("sign-ins in the last 24 hours"). */
export const ADMIN_STATS_WINDOW_SECONDS = DAY_IN_SECONDS;
