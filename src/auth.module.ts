import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModuleConfig, AuthOptions } from './auth-options';
import { assertValidAuthOptions } from './auth-options.validation';
import { AuthExceptionFilter } from './common/auth-exception.filter';
import { EncryptionService } from './common/encryption.service';
import { RateLimiterService } from './common/rate-limiter.service';
import { RefreshTokenCookieInterceptor } from './common/refresh-token-cookie';
import { DataExportService } from './features/account/data-export.service';
import { HealthService } from './features/account/health.service';
import { EmailChangeController } from './features/email-change/email-change.controller';
import { EmailChangeService } from './features/email-change/email-change.service';
import { AUTH_OPTIONS_TOKEN } from './constants';
import { AccountController } from './features/account/account.controller';
import { AdminController } from './features/admin/admin.controller';
import { AdminService } from './features/admin/admin.service';
import { ApiKeysService } from './features/api-keys/api-keys.service';
import { EmailVerificationService } from './features/email-links/email-verification.service';
import { LinkTokensService } from './features/email-links/link-tokens.service';
import { DataRetentionService } from './features/maintenance/data-retention.service';
import { AuthEventsService } from './features/events/auth-events.service';
import { NotificationsService } from './features/notifications/notifications.service';
import { OneTimeCodesService } from './features/one-time-codes/one-time-codes.service';
import { OrganizationsController } from './features/organizations/organizations.controller';
import { OrganizationsService } from './features/organizations/organizations.service';
import { PasskeysController } from './features/passkeys/passkeys.controller';
import { PasskeysService } from './features/passkeys/passkeys.service';
import { PasswordlessController } from './features/passwordless/passwordless.controller';
import { PasswordlessAuthService } from './features/passwordless/passwordless-auth.service';
import { PasswordAuthService } from './features/passwords/password-auth.service';
import { PasswordController } from './features/passwords/password.controller';
import { PasswordPolicyService } from './features/passwords/password-policy.service';
import { SessionService } from './features/sessions/session.service';
import { SettingsService } from './features/settings/settings.service';
import { SignInChallengesService } from './features/sign-in/sign-in-challenges.service';
import { SignInService } from './features/sign-in/sign-in.service';
import { JwksController } from './features/signing-keys/jwks.controller';
import { SigningKeysService } from './features/signing-keys/signing-keys.service';
import { SocialAuthService } from './features/social/social-auth.service';
import { SocialController } from './features/social/social.controller';
import { SocialProvidersService } from './features/social/social-providers.service';
import { TwoFactorController } from './features/two-factor/two-factor.controller';
import { TwoFactorService } from './features/two-factor/two-factor.service';
import { SignInMethodsService } from './features/users/sign-in-methods.service';
import { UsersService } from './features/users/users.service';
import { WebhookDeliveryWorker } from './features/webhooks/webhook-delivery.worker';
import { WebhooksService } from './features/webhooks/webhooks.service';
import { AuthGuard } from './guards/auth.guard';

/** Services your app may inject (e.g. UsersService in a profile module, OrganizationsService in a billing module). */
const PUBLIC_SERVICES = [
  SettingsService,
  UsersService,
  SessionService,
  SignInService,
  AuthEventsService,
  ApiKeysService,
  OrganizationsService,
  TwoFactorService,
  SigningKeysService,
  WebhooksService,
  DataRetentionService,
  AuthGuard,
];

const INTERNAL_SERVICES = [
  EncryptionService,
  RateLimiterService,
  NotificationsService,
  LinkTokensService,
  OneTimeCodesService,
  SignInChallengesService,
  SignInMethodsService,
  PasswordPolicyService,
  PasswordAuthService,
  EmailVerificationService,
  PasswordlessAuthService,
  SocialProvidersService,
  SocialAuthService,
  PasskeysService,
  AdminService,
  WebhookDeliveryWorker,
  EmailChangeService,
  DataExportService,
  HealthService,
];

const CONTROLLERS = [
  PasswordController,
  PasswordlessController,
  AccountController,
  EmailChangeController,
  SocialController,
  PasskeysController,
  TwoFactorController,
  OrganizationsController,
  AdminController,
  JwksController,
];

/**
 * Add authentication to a NestJS app:
 *
 *   @Module({
 *     imports: [
 *       AuthModule.forRoot({
 *         inject: [DataSource, ConfigService],
 *         useFactory: (dataSource: DataSource, config: ConfigService) => ({
 *           dataSource,
 *           issuer: 'https://api.myapp.com',
 *           encryption: { awsKmsKeyId: config.getOrThrow('KMS_KEY_ID'), awsRegion: 'ap-south-1' },
 *           emailSender: myEmailSender,
 *           settings: { emailOtp: { enabled: true } },
 *         }),
 *       }),
 *     ],
 *   })
 *
 * What you get:
 * - every /auth/* endpoint (see each controller for the list),
 * - every route in your app protected by default (open one with @Public()),
 * - errors in the { success: false, code, message } format,
 * - the background worker that delivers webhooks.
 */
@Global()
@Module({})
export class AuthModule {
  /**
   * Registers the library in your app.
   *
   * @param config - `useFactory` returns the AuthOptions (data source, issuer, encryption, senders,
   *   settings); `inject` and `imports` work as in any Nest async module. Set
   *   `protectAllRoutes: false` to opt routes in with @UseGuards(AuthGuard) instead.
   * @returns The configured, global module.
   * @throws At start-up, when the options are invalid (every problem is listed).
   */
  static forRoot(config: AuthModuleConfig): DynamicModule {
    const optionsProvider: Provider = {
      provide: AUTH_OPTIONS_TOKEN,
      inject: config.inject ?? [],
      useFactory: async (...dependencies: unknown[]): Promise<AuthOptions> => {
        const options = await config.useFactory(...dependencies);
        assertValidAuthOptions(options);
        return options;
      },
    };

    const appWideProviders: Provider[] = [
      { provide: APP_FILTER, useClass: AuthExceptionFilter },
      // Inert unless refreshTokenCookie is set, and only ever acts on the library's own routes.
      { provide: APP_INTERCEPTOR, useClass: RefreshTokenCookieInterceptor },
    ];
    // Protect every route by default; apps that prefer opt-in use @UseGuards(AuthGuard) themselves.
    if (config.protectAllRoutes !== false) appWideProviders.push({ provide: APP_GUARD, useExisting: AuthGuard });

    return {
      module: AuthModule,
      global: true,
      imports: config.imports ?? [],
      controllers: CONTROLLERS,
      providers: [optionsProvider, ...PUBLIC_SERVICES, ...INTERNAL_SERVICES, ...appWideProviders],
      exports: [AUTH_OPTIONS_TOKEN, ...PUBLIC_SERVICES],
    };
  }
}
