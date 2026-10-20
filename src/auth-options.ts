import type { DataSource } from 'typeorm';
import type { AuthEventName, CookieSameSite, EMAIL_TYPE } from './constants';
import type { SettingsChanges } from './features/settings/settings.types';
import type { JsonObject } from './database/entities/json-object';

/**
 * Everything AuthModule needs from your app.
 *
 * Secrets (API keys, app secrets) belong here, loaded from environment variables.
 * Behaviour (which sign-in methods are on, lifetimes, roles) belongs in `settings`,
 * which admins can also change at runtime.
 */
export interface AuthOptions {
  /** Your app's TypeORM DataSource. Add AUTH_ENTITIES and AUTH_MIGRATIONS to it. */
  dataSource: DataSource;

  /** Your API's public URL, e.g. https://api.myapp.com. Every token carries it as "iss" and "aud". */
  issuer: string;

  /** Protects the private signing key and other secrets stored in the database. */
  encryption: EncryptionOptions;

  /** Sends the emails the library needs (you write the email; we give you the token or code). */
  emailSender: EmailSender;

  /** Sends SMS codes. Required only when phone sign-in is turned on. */
  smsSender?: SmsSender;

  /** Facebook app secret, needed to verify Facebook sign-ins. Google and Apple need no secret. */
  facebookAppSecret?: string;

  /** Passkeys: your website's domain and origins. Required only when passkeys are turned on. */
  passkeys?: PasskeyOptions;

  /** Name shown in authenticator apps next to the 2FA code, e.g. "MyApp". */
  appName?: string;

  /** Your defaults for behaviour. Admins can change them later with PATCH /auth/admin/settings. */
  settings?: SettingsChanges;

  /**
   * Redis connection URL, so every server shares the same rate-limit counters. Required in
   * production unless `singleServer` is true: without it, each server counts on its own and an
   * attacker gets one full set of attempts per server.
   */
  redisUrl?: string;

  /**
   * Set to true only when production runs exactly one server process, to run without Redis
   * (counters then live in that process's memory and reset on restart).
   */
  singleServer?: boolean;

  /**
   * For web apps: put the refresh token in an HttpOnly cookie instead of the JSON response, so
   * scripts on the page (including injected ones) can never read it. Applies only to requests
   * from `allowedOrigins`; mobile apps and servers on the same API still get it in the body.
   */
  refreshTokenCookie?: RefreshTokenCookieOptions;

  /** Called for every auth event (also sent to webhooks). Handy to create a profile row on "user.created". */
  onEvent?: (event: AuthEvent) => void | Promise<void>;
}

export interface RefreshTokenCookieOptions {
  /**
   * Exact origins of your web app, e.g. ["https://app.myapp.com"]. A refresh that uses the cookie
   * must come from one of these (checked with the Origin header), which blocks cross-site requests.
   */
  allowedOrigins: string[];
  /** Default "__Host-refresh_token" (the browser then enforces Secure, path "/" and no domain). */
  name?: string;
  /** Share the cookie with subdomains, e.g. "myapp.com". Not allowed with a "__Host-" name. */
  domain?: string;
  /** Default "/". */
  path?: string;
  /** Default "Strict". Use "Lax" if your app and API are on different sites; "None" only if you must. */
  sameSite?: CookieSameSite;
}

export type EncryptionOptions =
  /**
   * Production: an AWS KMS symmetric key. The server needs kms:Encrypt and kms:Decrypt on it.
   * `legacyLocalKey`: set it to your old development localKey while moving an existing database to
   * KMS. Values encrypted earlier still decrypt; everything new is encrypted with KMS.
   */
  | { awsKmsKeyId: string; awsRegion: string; legacyLocalKey?: string }
  /** Development only: 32 random bytes in base64. Refused when NODE_ENV=production. */
  | { localKey: string };

/** One message the library asks you to send. Use `type` to pick your template. */
export type AuthEmail =
  | { type: typeof EMAIL_TYPE.verifyEmail; to: string; token: string }
  | { type: typeof EMAIL_TYPE.resetPassword; to: string; token: string }
  | { type: typeof EMAIL_TYPE.magicSignIn; to: string; token: string }
  | { type: typeof EMAIL_TYPE.signInCode; to: string; code: string }
  | { type: typeof EMAIL_TYPE.organizationInvitation; to: string; token: string; organizationName: string; invitedByName: string | null }
  | { type: typeof EMAIL_TYPE.passwordChanged; to: string }
  | { type: typeof EMAIL_TYPE.newSignIn; to: string; ipAddress: string | null; userAgent: string | null }
  /** Sent to the NEW address; the link confirms the change (POST /auth/email/change/confirm). */
  | { type: typeof EMAIL_TYPE.confirmEmailChange; to: string; token: string }
  /** Sent to the OLD address once the change is done. `newEmail` is masked, e.g. "r***@mail.com". */
  | { type: typeof EMAIL_TYPE.emailChanged; to: string; newEmail: string };

export interface EmailSender {
  send(email: AuthEmail): Promise<void>;
}

export interface SmsSender {
  /** Send `code` to `phoneNumber` (E.164, e.g. +919876543210). */
  sendCode(phoneNumber: string, code: string): Promise<void>;
}

export interface PasskeyOptions {
  /** Your domain without protocol, e.g. "myapp.com". Passkeys only work on this domain and its subdomains. */
  relyingPartyId: string;
  /** Name shown in the passkey prompt, e.g. "MyApp". */
  relyingPartyName: string;
  /** Exact origins allowed, e.g. ["https://myapp.com", "android:apk-key-hash:..."]. */
  allowedOrigins: string[];
}

/** What onEvent and webhooks receive. */
export interface AuthEvent {
  name: AuthEventName;
  /** The user the event is about, when there is one. */
  userId: string | null;
  /** Event details. Never contains passwords, tokens or codes. */
  data: JsonObject;
  occurredAt: string;
}

/** Shape of AuthModule.forRoot({ ... }). */
export interface AuthModuleConfig {
  imports?: any[];
  inject?: any[];
  useFactory: (...dependencies: any[]) => AuthOptions | Promise<AuthOptions>;
  /** Protect every route in the app by default (open routes with @Public()). Default: true. */
  protectAllRoutes?: boolean;
}
