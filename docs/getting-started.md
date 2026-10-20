# Getting started

This guide adds email + password authentication to an existing NestJS app. Other sign-in methods are switched on with one setting each, see [Configuration](configuration.md).

## 1. Install

```bash
npm install @techelusive/nest-auth
# Peer dependencies (most NestJS + TypeORM apps already have them):
npm install @nestjs/common @nestjs/core @nestjs/platform-express typeorm pg \
  class-validator class-transformer reflect-metadata rxjs
# Optional: shared rate limits across servers
npm install ioredis
```

## 2. Add the auth tables to your database

The library brings its own TypeORM entities and one migration that creates 20 tables, all prefixed `auth_`. They live in your existing database next to your own tables.

```ts
// src/data-source.ts
import { DataSource } from 'typeorm';
import { AUTH_ENTITIES, AUTH_MIGRATIONS } from '@techelusive/nest-auth';

export const appDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [...AUTH_ENTITIES, /* your entities */],
  migrations: [...AUTH_MIGRATIONS, /* your migrations */],
  synchronize: false,
});
```

Run the migration:

```bash
npm run build
npx typeorm migration:run -d dist/data-source.js
```

> Never use `synchronize: true` with these tables. The migration creates constraints and indexes that `synchronize` does not know about.

## 3. Create an encryption key (development)

The library encrypts its token-signing key, 2FA secrets and webhook secrets before storing them. In development, use a local key:

```bash
openssl rand -base64 32
# put the result in .env as LOCAL_ENCRYPTION_KEY
```

In production, use AWS KMS instead (see [Production checklist](production-checklist.md)). A local key is refused when `NODE_ENV=production`.

## 4. Import the module

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { AuthModule, ConsoleEmailSender } from '@techelusive/nest-auth';
import { appDataSource } from './data-source';

@Module({
  imports: [
    AuthModule.forRoot({
      useFactory: async () => ({
        dataSource: appDataSource.isInitialized ? appDataSource : await appDataSource.initialize(),
        issuer: 'http://localhost:3000',          // your API's public URL
        appName: 'MyApp',
        encryption: { localKey: process.env.LOCAL_ENCRYPTION_KEY! },
        emailSender: new ConsoleEmailSender(),     // prints emails to the console in development
        settings: {
          registration: { defaultRoles: ['user'] },
        },
      }),
    }),
  ],
})
export class AppModule {}
```

If your app already uses `@nestjs/typeorm`, inject its `DataSource` instead:

```ts
AuthModule.forRoot({
  imports: [TypeOrmModule],
  inject: [DataSource],
  useFactory: (dataSource: DataSource) => ({ dataSource, /* ... */ }),
})
```

## 5. Trust your proxy

Rate limits, the device list and the audit log use the client's IP address. Behind a load balancer (AWS ALB, Nginx, Cloudflare), tell Express to trust one proxy hop:

```ts
// src/main.ts
const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.set('trust proxy', 1);
await app.listen(3000);
```

## 6. Try it

```bash
# Register
curl -X POST localhost:3000/auth/register -H 'Content-Type: application/json' -d '{
  "email": "asha@example.com", "password": "correct horse battery",
  "firstName": "Asha", "lastName": "Rao", "acceptTerms": true, "acceptPrivacyPolicy": true
}'
# -> { "success": true, "status": "verification_required", "pendingVerifications": ["email"], ... }
```

The console prints the verification email, which contains a `token` (`ev_...`). Your web page would read it from the link:

```bash
curl -X POST localhost:3000/auth/email/verify -H 'Content-Type: application/json' -d '{ "token": "ev_..." }'

# Sign in
curl -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{ "email": "asha@example.com", "password": "correct horse battery" }'
# -> { "success": true, "status": "signed_in", "accessToken": "eyJ...", "refreshToken": "rt_...", "user": {...} }

# Call a protected route
curl localhost:3000/auth/me -H 'Authorization: Bearer eyJ...'
```

## 7. What changed in your app

- **Every route is now protected.** A request without a valid access token gets `401 UNAUTHORIZED`. Open public routes with `@Public()`, see [Protecting routes](protecting-routes.md). To opt in route by route instead, pass `protectAllRoutes: false`.
- **One error format everywhere.** All errors, including your own, look like `{ "success": false, "code": "...", "message": "..." }`.
- **New endpoints:** `/auth/*` and `/.well-known/jwks.json`, see [API reference](api-reference.md).
- **Background webhook worker:** it runs every 5 seconds and does nothing until you add a webhook.

## Next steps

- Turn on more sign-in methods: [Configuration](configuration.md)
- Build your screens: [Sign-in flows](sign-in-flows.md), [Client integration](client-integration.md)
- Send real emails: write an `EmailSender` (see [Configuration → Email](configuration.md#email-sender))
- Before launch: [Production checklist](production-checklist.md)
