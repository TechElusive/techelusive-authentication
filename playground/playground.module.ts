import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ensureDatabaseExists } from './ensure-database';
import { AUTH_ENTITIES, AUTH_MIGRATIONS, AuthModule } from '@/index';
import { DevController, SampleAppController, SwaggerController } from './dev/dev.controller';
import { devInbox } from './dev/dev-inbox';
import { alsoSendEmailsForReal, alsoSendSmsForReal, realSendersFromEnvironment } from './dev/real-delivery';
import {
  DEFAULT_DATABASE_URL,
  ENV_LIST_SEPARATOR,
  PASSKEY_RELYING_PARTY_ID,
  PLAYGROUND_APP_NAME,
  PLAYGROUND_LOCAL_ENCRYPTION_KEY,
  PLAYGROUND_URL,
} from './playground.constants';

/**
 * The library with every feature switched on, for manual testing:
 * - emails and SMS go to the dev inbox (http://localhost:3000/dev), never to real people,
 * - the database tables are created automatically on start,
 * - Google sign-in is on when GOOGLE_CLIENT_ID is set.
 */
@Module({
  imports: [
    AuthModule.forRoot({
      useFactory: async () => {
        const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
        await ensureDatabaseExists(databaseUrl);
        const dataSource = new DataSource({
          type: 'postgres',
          url: databaseUrl,
          entities: AUTH_ENTITIES,
          migrations: AUTH_MIGRATIONS,
          migrationsRun: true,
        });
        await dataSource.initialize();

        const googleClientId = process.env.GOOGLE_CLIENT_ID;
        const realSenders = realSendersFromEnvironment();
        return {
          dataSource,
          issuer: PLAYGROUND_URL,
          appName: PLAYGROUND_APP_NAME,
          encryption: { localKey: process.env.LOCAL_ENCRYPTION_KEY ?? PLAYGROUND_LOCAL_ENCRYPTION_KEY },
          // Always to the dev inbox; also for real when RESEND_API_KEY / MSG91_* are set in playground/.env.
          emailSender: alsoSendEmailsForReal(devInbox.emailSender, realSenders.email),
          smsSender: alsoSendSmsForReal(devInbox.smsSender, realSenders.sms),
          redisUrl: process.env.REDIS_URL,
          // Web-app mode: refresh token in an HttpOnly cookie (comma-separated allowed origins).
          refreshTokenCookie: process.env.REFRESH_TOKEN_COOKIE_ORIGINS
            ? { allowedOrigins: process.env.REFRESH_TOKEN_COOKIE_ORIGINS.split(ENV_LIST_SEPARATOR).map((origin) => origin.trim()) }
            : undefined,
          facebookAppSecret: process.env.FACEBOOK_APP_SECRET,
          passkeys: { relyingPartyId: PASSKEY_RELYING_PARTY_ID, relyingPartyName: PLAYGROUND_APP_NAME, allowedOrigins: [PLAYGROUND_URL] },
          settings: {
            // Off by default here so any password that meets the rules works while testing.
            // Start with CHECK_BREACHED_PASSWORDS=true (or change it in Admin > Change settings) to test it.
            // Apps get the library default, which is on.
            password: { rejectBreachedPasswords: process.env.CHECK_BREACHED_PASSWORDS === String(true) },
            emailOtp: { enabled: true },
            magicLink: { enabled: true },
            phoneOtp: { enabled: true },
            passkeys: { enabled: true },
            organizations: { enabled: true },
            security: { notifyOnNewSignIn: true },
            google: { enabled: Boolean(googleClientId), clientIds: googleClientId ? [googleClientId] : [] },
            facebook: { enabled: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET), appId: process.env.FACEBOOK_APP_ID ?? '' },
            apple: { enabled: Boolean(process.env.APPLE_CLIENT_ID), clientIds: process.env.APPLE_CLIENT_ID ? [process.env.APPLE_CLIENT_ID] : [] },
          },
          onEvent: (event) => devInbox.recordEvent(event),
        };
      },
    }),
  ],
  controllers: [DevController, SampleAppController, SwaggerController],
})
export class PlaygroundModule {}
