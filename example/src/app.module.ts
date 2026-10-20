import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AUTH_EVENTS, AuthModule, ConsoleEmailSender, Msg91SmsSender } from '@techelusive/nest-auth';
import {
  ALLOWED_PHONE_COUNTRY_CODES,
  APP_NAME,
  APP_ROLE,
  DEFAULT_AWS_REGION,
  DEVELOPMENT_ISSUER,
  PRODUCTION_ENVIRONMENT,
} from './app.constants';
import { appDataSource } from './data-source';
import { RidesController } from './rides.controller';

/**
 * Example: RideMate using @techelusive/nest-auth.
 * Another product would copy this file and change only the settings below.
 */
@Module({
  imports: [
    AuthModule.forRoot({
      useFactory: async () => {
        const dataSource: DataSource = appDataSource.isInitialized ? appDataSource : await appDataSource.initialize();
        return {
          dataSource,
          appName: APP_NAME,
          issuer: process.env.AUTH_ISSUER ?? DEVELOPMENT_ISSUER,

          encryption:
            process.env.NODE_ENV === PRODUCTION_ENVIRONMENT
              ? { awsKmsKeyId: process.env.AWS_KMS_KEY_ID!, awsRegion: process.env.AWS_REGION ?? DEFAULT_AWS_REGION }
              : { localKey: process.env.LOCAL_ENCRYPTION_KEY! }, // openssl rand -base64 32

          emailSender: new ConsoleEmailSender(), // swap for SES / Resend / SMTP in production
          smsSender: process.env.MSG91_AUTH_KEY
            ? new Msg91SmsSender({ authKey: process.env.MSG91_AUTH_KEY, templateId: process.env.MSG91_TEMPLATE_ID! })
            : undefined,

          redisUrl: process.env.REDIS_URL,

          // RideMate's choices. Admins can change most of these at runtime via PATCH /auth/admin/settings.
          settings: {
            registration: { defaultRoles: [APP_ROLE.traveller] },
            activation: { requireVerifiedEmail: true, requireVerifiedPhone: false },
            emailOtp: { enabled: true },
            phoneOtp: { enabled: !!process.env.MSG91_AUTH_KEY, allowedCountryCodes: ALLOWED_PHONE_COUNTRY_CODES },
            google: { enabled: !!process.env.GOOGLE_CLIENT_ID, clientIds: process.env.GOOGLE_CLIENT_ID ? [process.env.GOOGLE_CLIENT_ID] : [] },
            admin: { adminRoles: [APP_ROLE.admin, APP_ROLE.superAdmin] },
            security: { notifyOnNewSignIn: true },
          },

          // Create the RideMate profile row when someone signs up.
          onEvent: async (event) => {
            if (event.name === AUTH_EVENTS.userCreated) console.log(`New user ${event.userId}: create their profile here`);
          },
        };
      },
    }),
  ],
  controllers: [RidesController],
})
export class AppModule {}
