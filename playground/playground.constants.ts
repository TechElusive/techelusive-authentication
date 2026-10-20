import { EMAIL_TYPE, LOCAL_ENCRYPTION_KEY_BYTES } from '@/constants';

/**
 * Fixed values of the local playground (manual testing only, never deployed).
 */

export const PLAYGROUND_PORT = 3000;
export const PLAYGROUND_URL = `http://localhost:${PLAYGROUND_PORT}`;
export const PLAYGROUND_APP_NAME = 'Techelusive Playground';
/** Fixed development key so encrypted rows survive restarts (never use outside the playground). */
export const PLAYGROUND_LOCAL_ENCRYPTION_KEY = Buffer.alloc(LOCAL_ENCRYPTION_KEY_BYTES, 1).toString('base64');
/** Separator of list values in playground/.env, e.g. two origins. */
export const ENV_LIST_SEPARATOR = ',';
/** Optional settings file read on start (copy playground/.env.example to create it). */
export const PLAYGROUND_ENV_FILE = 'playground/.env';
export const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/techelusive_playground';
/** Database every PostgreSQL server has; used to create the playground database when it's missing. */
export const MAINTENANCE_DATABASE_NAME = 'postgres';
/** Database names the playground will create (kept simple so the name is safe in CREATE DATABASE). */
export const POSTGRES_DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Passkeys work on localhost in every major browser. */
export const PASSKEY_RELYING_PARTY_ID = 'localhost';

/** Role the playground's "Make admin" button grants (matches the default settings.admin.adminRoles). */
export const PLAYGROUND_ADMIN_ROLE = 'admin';

/** Dev routes (dashboard, inbox, Swagger). Registered only by the playground. */
export const DEV_ROUTES = {
  prefix: 'dev',
  dashboard: '',
  inbox: 'api/inbox',
  latestMessage: 'api/inbox/latest',
  events: 'api/events',
  webhookDeliveries: 'api/webhook-deliveries',
  totp: 'api/totp',
  makeAdmin: 'api/make-admin',
  config: 'api/config',
  clear: 'api/clear',
  webhookReceiver: 'webhook-receiver',
} as const;

/** A sample protected route of "your app", for testing API keys. */
export const SAMPLE_APP_ROUTES = {
  prefix: 'sample',
  partnerExport: 'partner-export',
} as const;
/** The scope the sample route requires (create the API key with it). */
export const SAMPLE_API_KEY_SCOPE = 'rides:read';

export const SWAGGER_ROUTES = {
  prefix: 'docs',
  page: '',
  spec: 'openapi.json',
} as const;

/** Swagger UI is loaded from a CDN, pinned to an exact version. */
export const SWAGGER_UI_VERSION = '5.17.14';
export const SWAGGER_UI_CDN = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

/** Files served by the playground, relative to the repository root. */
export const PLAYGROUND_FILES = {
  dashboard: 'playground/dev/dashboard.html',
  swagger: 'playground/dev/swagger.html',
  openApiSpec: 'api/openapi.json',
} as const;
/** Marker used to find the repository root from the compiled files. */
export const REPOSITORY_MARKER_FILE = 'package.json';

/** How many messages, events and deliveries the dev inbox keeps. */
export const DEV_INBOX_LIMIT = 200;

/** Spaces, dashes and brackets are ignored when looking up an inbox address ("+91 98765-43210"). */
export const ADDRESS_FORMATTING_CHARACTERS_PATTERN = /[\s\-().]/g;

/** The inbox's type for SMS codes (emails use the library's EMAIL_TYPE values). */
export const SMS_MESSAGE_TYPE = 'sms_code';

export const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
export const CONTENT_TYPE_HEADER = 'Content-Type';
export const WEBHOOK_SIGNATURE_HEADER_NAME = 'x-techelusive-signature';
export const WEBHOOK_DELIVERY_HEADER_NAME = 'x-techelusive-delivery';

/** Placeholder replaced with the OpenAPI spec URL in swagger.html. */
export const SWAGGER_SPEC_URL_PLACEHOLDER = '__SPEC_URL__';
export const SWAGGER_CDN_PLACEHOLDER = '__SWAGGER_CDN__';

/** Real email delivery for manual testing (optional, set RESEND_API_KEY). https://resend.com/docs/api-reference/emails/send-email */
export const RESEND_API = {
  url: 'https://api.resend.com/emails',
  /** Resend's shared test sender: works without a domain, but only delivers to your Resend account's own email. */
  defaultFromAddress: 'Techelusive Playground <onboarding@resend.dev>',
  requestTimeoutMs: 10_000,
} as const;

/** Subjects of the plain-text emails the playground sends for real. */
export const REAL_EMAIL_SUBJECT: Record<string, string> = {
  [EMAIL_TYPE.verifyEmail]: 'Verify your email',
  [EMAIL_TYPE.resetPassword]: 'Reset your password',
  [EMAIL_TYPE.magicSignIn]: 'Your sign-in link',
  [EMAIL_TYPE.signInCode]: 'Your sign-in code',
  [EMAIL_TYPE.organizationInvitation]: 'You were invited to an organization',
  [EMAIL_TYPE.passwordChanged]: 'Your password was changed',
  [EMAIL_TYPE.newSignIn]: 'New sign-in to your account',
};
/** Shown in a real email when the sign-in's IP or device isn't known. */
export const UNKNOWN_VALUE_LABEL = 'unknown';
export const REAL_EMAIL_FOOTER = 'Sent by the @techelusive/nest-auth playground (local testing).';
/** "Authorization: Bearer <key>" for outgoing API calls. */
export const BEARER_PREFIX = 'Bearer ';
/** Logger name for playground messages. */
export const PLAYGROUND_LOG_CONTEXT = 'Playground';

/** Where links in real emails point: the dashboard, which shows the token to paste into Postman/Swagger. */
export const REAL_EMAIL_LINK_BASE = `${PLAYGROUND_URL}/dev?token=`;
