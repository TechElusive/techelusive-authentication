# @techelusive/nest-auth

Reusable, production-grade authentication for NestJS apps. Write it once, plug it into every product.

- **Headless:** pure JSON API. Each app builds its own screens (web, iOS, Android).
- **Your database:** the auth tables live in each app's own PostgreSQL database, through its TypeORM `DataSource`.
- **Configurable:** every feature can be switched on or off in code, and changed at runtime by an admin through the API.

## Features

| Area | What you get |
|---|---|
| Sign in | Email + password, email OTP, magic link, phone OTP (SMS), Google, Apple, Facebook, passkeys |
| Security | 2FA with authenticator apps + backup codes, breached-password check, rate limits (shared through Redis), refresh-token reuse detection, HttpOnly cookie mode for web apps, new-device emails, audit log |
| Accounts | Verification and activation rules, verified email change, "download my data", suspend / deactivate / reactivate / delete (personal data wiped), onboarding flag, roles |
| Teams | Organizations with owner / admin / member roles, email invitations, active organization in the token |
| Servers | API keys with scopes, signed webhooks with retries, public JWKS so any service can verify tokens |
| Admin and operations | User search and management, runtime settings, audit log, stats, key rotation, health check, automatic data retention |

## Documentation

| Guide | |
|---|---|
| [Getting started](docs/getting-started.md) | Add auth to a NestJS app in 15 minutes |
| [Configuration](docs/configuration.md) | Every option and runtime setting |
| [Sign-in flows](docs/sign-in-flows.md) | Each flow, request by request, for app developers |
| [Client integration](docs/client-integration.md) | Token storage, refresh, email links, social SDKs, passkeys |
| [Endpoints](docs/endpoints/README.md) | Every endpoint with its request and response JSON |
| [API reference](docs/api-reference.md) · [Error codes](docs/error-codes.md) · [Events](docs/events.md) | Look-ups |
| [Protecting routes](docs/protecting-routes.md) | Decorators, token claims, verifying tokens in other services |
| [Organizations](docs/organizations.md) · [Admin, API keys, webhooks](docs/admin-api-keys-webhooks.md) | Teams and operations |
| [Manual testing](docs/manual-testing.md) | Local playground with Swagger, Postman and a dev dashboard |
| [Code walkthrough](docs/code-walkthrough.md) | How each flow runs through the code, with a study plan |
| [Production checklist](docs/production-checklist.md) · [Security](docs/security.md) · [Architecture](docs/architecture.md) | Going live and internals |

## Install

```bash
npm install @techelusive/nest-auth
# peer dependencies your NestJS app already has:
npm install @nestjs/common @nestjs/core typeorm pg class-validator class-transformer reflect-metadata
```

## Set up in 3 steps

**1. Add the tables to your DataSource and run the migration**

```ts
import { AUTH_ENTITIES, AUTH_MIGRATIONS } from '@techelusive/nest-auth';

export const appDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [...AUTH_ENTITIES, ...yourEntities],
  migrations: [...AUTH_MIGRATIONS, ...yourMigrations],
});
```

```bash
npx typeorm migration:run -d dist/data-source.js
```

**2. Import the module**

```ts
AuthModule.forRoot({
  useFactory: async () => ({
    dataSource: await appDataSource.initialize(),
    issuer: 'https://api.myapp.com',
    appName: 'MyApp',
    encryption: { awsKmsKeyId: process.env.KMS_KEY_ID!, awsRegion: 'ap-south-1' },
    emailSender: myEmailSender,                     // { send(email) } - SES, Resend, SMTP...
    smsSender: new Msg91SmsSender({ authKey, templateId }), // only for phone OTP
    redisUrl: process.env.REDIS_URL,                // required in production (or singleServer: true)
    settings: {
      registration: { defaultRoles: ['customer'] },
      emailOtp: { enabled: true },
      google: { enabled: true, clientIds: ['...apps.googleusercontent.com'] },
    },
  }),
})
```

**3. Trust your load balancer** (so rate limits see real client IPs)

```ts
app.set('trust proxy', 1);
```

Every route in your app is now protected. A full working example is in [`example/`](example/).

## Protecting your own routes

```ts
@Get('popular') @Public()                 // anyone
@Get('mine')                              // any signed-in user (the default)
@Post() @Roles('seller', 'admin')         // users with one of these roles
@Post('payout') @CheckSession()           // also re-check the session is still active
@Get('export') @ApiKeyScopes('orders:read') // other servers with an API key ("x-api-key" header)

myRoute(@CurrentUser() user: AccessTokenClaims) { user.sub; user.roles; user.org_id; }
```

Other services (in any language) can verify access tokens with a standard JWT library pointed at `GET /.well-known/jwks.json`. The algorithm is ES256, and `iss` and `aud` are both your issuer URL.

## Endpoints

Every response has `success: true` or `success: false`. Errors look like this:

```json
{ "success": false, "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." }
```

| Method & path | Purpose |
|---|---|
| `POST /auth/register` | Create account (email, password, firstName, lastName, phoneNumber, acceptTerms, acceptPrivacyPolicy) |
| `POST /auth/login` | Email + password |
| `POST /auth/email/send-verification` · `/auth/email/verify` | Verification link |
| `POST /auth/email/send-otp` · `/auth/email/verify-otp` | Email code (signs in and verifies) |
| `POST /auth/magic-link/send` · `/auth/magic-link/verify` | Magic link |
| `POST /auth/phone/send-otp` · `/auth/phone/verify-otp` | SMS code |
| `POST /auth/social/:provider` | `google`, `apple`, `facebook` (send the provider's token) |
| `POST /auth/social/:provider/link` · `DELETE /auth/social/:provider` | Connect or disconnect a provider |
| `POST /auth/passkeys/register/options` · `register/verify` | Add a passkey |
| `POST /auth/passkeys/sign-in/options` · `sign-in/verify` | Sign in with a passkey |
| `GET /auth/passkeys` · `PATCH/DELETE /auth/passkeys/:id` | Manage passkeys |
| `POST /auth/2fa/setup` · `enable` · `disable` · `backup-codes` · `verify` | Two-factor |
| `POST /auth/password/forgot` · `reset` · `change` | Passwords |
| `POST /auth/refresh` · `logout` · `logout-all` | Tokens and sessions |
| `GET/PATCH/DELETE /auth/me` · `GET /auth/me/export` | Profile, delete account, download my data |
| `POST /auth/email/change` · `/auth/email/change/confirm` | Change email (confirmed by a link to the new address) |
| `GET /auth/health` | Database and Redis reachable (for load balancers) |
| `GET /auth/sessions` · `DELETE /auth/sessions/:id` | Devices |
| `GET /auth/sign-in-methods` | How the user can sign in |
| `POST /auth/deactivate` · `/auth/reactivate` | Pause and resume the account |
| `/auth/organizations/...` | Organizations, members, invitations, switch |
| `/auth/admin/...` | Users, settings, audit log, stats, data cleanup, API keys, webhooks, key rotation |

## Sign-in responses

Every sign-in endpoint returns one of these:

```jsonc
{ "success": true, "status": "signed_in", "accessToken": "...", "refreshToken": "rt_...", "expiresIn": 900, "user": { ... } }
{ "success": true, "status": "two_factor_required", "challengeToken": "ch_...", "expiresIn": 300 }  // then POST /auth/2fa/verify
```

Or an error the app can act on:

| Code | What the app should do |
|---|---|
| `ACCOUNT_NOT_VERIFIED` | Send the user to verification. `pendingVerifications` says which: `["email"]`, `["phone"]` |
| `ACCOUNT_DEACTIVATED` | Offer reactivation: `POST /auth/reactivate` with the `reactivationToken` |
| `ACCOUNT_SUSPENDED` | Show "contact support" |
| `VALIDATION_ERROR` with `missingSignUpDetails` | New social / code user: ask for names or consent, then retry |
| `TOO_MANY_REQUESTS` | Wait `retryAfterSeconds` |

## Settings

Defaults are in `src/features/settings/settings.defaults.ts`. They are secure and have only email + password turned on.

The final settings are built in three layers:

1. **Defaults:** shipped with the library.
2. **Your code:** whatever you pass in `settings` overrides the defaults.
3. **Admin changes:** `PATCH /auth/admin/settings` overrides both. Changes reach every server within 10 seconds. `DELETE /auth/admin/settings` goes back to the code settings.

## Webhooks

`POST /auth/admin/webhooks` registers a URL and returns its signing secret **once**. Each delivery is a signed POST. Verify it in the receiving service:

```ts
import { verifyWebhookSignature } from '@techelusive/nest-auth';
verifyWebhookSignature(secret, rawBody, req.headers['x-techelusive-signature']);
```

Failed deliveries are retried for up to about a day. Private and internal addresses are always refused.

## Security notes

- **Hashing and encryption:**
  - Passwords use Argon2id.
  - Tokens, codes and API keys are stored only as hashes.
  - Signing keys, 2FA secrets and webhook secrets are encrypted with AWS KMS (or a local key in development only).
- **No account enumeration:** "send" and "forgot" endpoints answer the same whether or not an account exists, and sign-in takes the same time for unknown emails.
- **Single-use refresh tokens:** a reused refresh token ends that session.
- **Fast revocation:** signing out or suspending takes effect within seconds on routes marked `@CheckSession()`, and within one access-token lifetime (15 minutes by default) everywhere else.
- **Account pre-hijacking protection:** when the real owner first proves an email, any password set earlier by someone else is removed.
- **Social account takeover protection:** an unverified social email is never linked to an existing account.

## Development

```bash
npm install
npm test        # unit tests (crypto, TOTP RFC vectors, SSRF guard, webhook signatures, input rules)
npm run build
```

All tunable numbers, limits, patterns, error codes and messages live in [`src/constants.ts`](src/constants.ts).

## Contributing, security and license

- Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in public issues.
- Released under the [MIT License](LICENSE).
