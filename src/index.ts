/**
 * @techelusive/nest-auth: reusable authentication for NestJS apps.
 * Everything an app needs is exported from here.
 */

// The module and its options
export { AuthModule } from './auth.module';
export type {
  AuthEmail,
  AuthEvent,
  AuthModuleConfig,
  AuthOptions,
  EmailSender,
  EncryptionOptions,
  PasskeyOptions,
  SmsSender,
} from './auth-options';

// Protecting routes
export { AuthGuard } from './guards/auth.guard';
export {
  AdminOnly,
  ApiKeyScopes,
  CheckSession,
  CurrentCaller,
  CurrentUser,
  CurrentUserId,
  Public,
  Roles,
} from './guards/auth.decorators';
export type { AuthenticatedCaller } from './guards/auth.decorators';
export { CurrentRequest, SYSTEM_REQUEST } from './common/request-context';
export type { RequestContext } from './common/request-context';

// Database: add AUTH_ENTITIES to your DataSource and AUTH_MIGRATIONS to its migrations
export * from './database/entities';
export { AUTH_MIGRATIONS, CreateAuthTables1792600000000 } from './database/create-auth-tables.migration';
export { EmailChangeAndRetention1792700000000 } from './database/email-change-and-retention.migration';

// Services your app can use
export { UsersService } from './features/users/users.service';
export { DataRetentionService } from './features/maintenance/data-retention.service';
export type { DataRetentionReport } from './features/maintenance/data-retention.service';
export { SessionService } from './features/sessions/session.service';
export { SignInService } from './features/sign-in/sign-in.service';
export { SettingsService } from './features/settings/settings.service';
export { AuthEventsService } from './features/events/auth-events.service';
export { ApiKeysService } from './features/api-keys/api-keys.service';
export { OrganizationsService } from './features/organizations/organizations.service';
export { TwoFactorService } from './features/two-factor/two-factor.service';
export { SigningKeysService } from './features/signing-keys/signing-keys.service';
export { WebhooksService } from './features/webhooks/webhooks.service';

// Types
export type { AccessTokenClaims, SignInMethod, TokenSet } from './features/sessions/session.types';
export type { SignInResult, SignedInResult, TwoFactorRequiredResult } from './features/sign-in/sign-in.types';
export type { PendingVerification, PublicUserProfile } from './features/users/users.types';
export type { AuthSettings, SettingsChanges } from './features/settings/settings.types';
export { DEFAULT_SETTINGS } from './features/settings/settings.defaults';

// Errors and constants (stable error codes apps can check)
export { AuthError } from './common/auth-error';
export {
  ACCOUNT_STATUS,
  ACCOUNT_STATUSES,
  AUTH_ERRORS,
  AUTH_EVENTS,
  ORGANIZATION_ROLE,
  ORGANIZATION_ROLES,
  PENDING_VERIFICATION,
  ROUTES,
  SIGN_IN_METHOD,
  SIGN_IN_STATUS,
  SOCIAL_PROVIDER,
} from './constants';
export type { AccountStatus, AuthErrorDefinition, AuthErrorName, AuthEventName, OrganizationRole, SocialProvider } from './constants';

// Ready-made senders
export { Msg91SmsSender } from './integrations/msg91-sms-sender';
export type { Msg91Options } from './integrations/msg91-sms-sender';
export { ConsoleEmailSender } from './integrations/console-email-sender';

// For services that RECEIVE webhooks
export { verifyWebhookSignature } from './features/webhooks/webhook-signature';
