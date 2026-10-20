# Code walkthrough

A guided tour of the source code, for anyone who wants to understand how the library works inside, maintain it, or contribute. Each flow is traced from the HTTP request to the database, naming the file and function at every hop, so you can open them side by side.

If you only want to *use* the library, read [Getting started](getting-started.md) instead.

## How to study it

**Watch it run, then read it.** Reading code without seeing it run is slow. The fastest way to learn a flow is to stop the server in the middle of it:

- In VS Code, open the command palette and run **JavaScript Debug Terminal**. In that terminal, run `npm run playground`. Source maps are on, so breakpoints in the `.ts` files under `src/` work.
- Put a breakpoint on the first line of the function named in a flow below (for example `signInWithPassword` in `src/features/passwords/password-auth.service.ts`).
- Send the request from Postman or Swagger. The debugger stops there; step through with **F10** (next line) and **F11** (into a function), and look at the variables panel.
- Keep the dev dashboard (http://localhost:3000/dev) open to see the emails, events and webhooks each step produces, and a database viewer (TablePlus, DBeaver or `psql`) on the `auth_*` tables to see each row appear.

**Suggested order:** the map, then "Every request", then email + password from register to refresh. Those cover most of the shared machinery; every other flow reuses it. Then read the other flows in any order.

**Background you need:** NestJS modules, controllers, providers and decorators (the official NestJS "First steps" and "Guards" pages), and basic TypeORM repositories. Security terms are explained in the code comments and in [Security](security.md).

---

## The map

```
src/
  index.ts                     everything apps can import (start here to see the public API)
  auth.module.ts               AuthModule.forRoot(): wires every controller and service together
  auth-options.ts              what an app must pass in (database, URLs, senders...)
  auth-options.validation.ts   checks those options at startup
  constants.ts                 every fixed value: routes, error codes, limits, default settings
  common/                      small shared helpers (errors, rate limiting, encryption, crypto)
  guards/                      AuthGuard and the decorators (@Public, @Roles, @CurrentUser...)
  database/                    entities (tables) and migrations
  features/                    one folder per feature
    passwords/  passwordless/  social/  passkeys/  two-factor/     ways to sign in
    sign-in/                   what happens after any method proves who the user is
    sessions/                  sessions, access and refresh tokens
    users/                     accounts and their life cycle
    email-links/  one-time-codes/  notifications/                  links, codes, sending them
    account/  email-change/    the signed-in user's own account
    organizations/  api-keys/  webhooks/  events/  admin/  settings/  signing-keys/  maintenance/
  integrations/                ready-made senders (MSG91 SMS, console email)
```

Most feature folders hold the same three kinds of file:

| File | Job |
|---|---|
| `*.controller.ts` | HTTP only: route, request body, calls one service method. No business rules. |
| `*.dto.ts` | The shape of request bodies (types and lengths). Unknown fields are rejected. |
| `*.service.ts` | The rules: what is allowed, what is saved, which events and emails go out. |

So for any endpoint: find its route in `ROUTES` (constants.ts), find the controller method with that route, and follow the one service call it makes.

---

## App startup

**`AuthModule.forRoot()`** in `auth.module.ts`:

- Calls the app's `useFactory` to get the `AuthOptions`, then `assertValidAuthOptions` (`auth-options.validation.ts`) stops the app with a clear list of problems if something is missing (no email sender, local key in production, no Redis in production...).
- Registers every controller and service, plus three app-wide pieces:
  - `AuthGuard` as `APP_GUARD`: runs before **every** route in the app.
  - `AuthExceptionFilter` as `APP_FILTER`: turns every error into `{ success: false, code, message }`.
  - `RefreshTokenCookieInterceptor` as `APP_INTERCEPTOR`: only does anything in cookie mode.
- Background jobs start on `onApplicationBootstrap`: `WebhookDeliveryWorker` (every few seconds) and `DataRetentionService` (every hour).
- On the first request needing a token, `SigningKeysService.getSigningKeys` creates the first signing key if there is none.

What to notice: nothing is global or hidden. Every service gets what it needs through its constructor, and `AUTH_OPTIONS_TOKEN` is how they all reach the app's options (database, senders).

---

## Every request: the guard

**`AuthGuard.canActivate`** in `guards/auth.guard.ts` decides who may call any route, in this order:

- A route marked `@Public()` lets everyone in. If a token is sent anyway, it is read so `@CurrentUser()` works.
- An `x-api-key` header on a route marked `@ApiKeyScopes(...)` → `ApiKeysService.verifyApiKey` (hash lookup) and a scope check.
- Otherwise an `Authorization: Bearer` access token is required → `SessionService.verifyAccessToken` checks the signature (ES256, keys from `SigningKeysService`), issuer, audience, type and expiry. No database query: that is why access tokens are fast.
- `@CheckSession()` / `@AdminOnly()` routes also call `SessionService.isSessionStillAllowed`, which asks the database whether the session is still open and the account still active (cached for a few seconds). This is how "sign out everywhere" and "suspend" take effect before the access token expires.
- `@Roles(...)` / `@AdminOnly()` compare the roles in the token.
- The caller is attached to the request; `@CurrentUser()`, `@CurrentUserId()` and `@CurrentCaller()` (`guards/auth.decorators.ts`) read it back in controllers.

**When something fails**, services throw `new AuthError(AUTH_ERRORS.someError, extraFields?)` (`common/auth-error.ts`). `AuthExceptionFilter` (`common/auth-exception.filter.ts`) turns it into the JSON response with the right HTTP status. Unexpected errors are logged with their stack trace and answered with a generic `INTERNAL_SERVER_ERROR`.

---

## Email + password

### Register: `POST /auth/register`

`PasswordController.register` → **`PasswordAuthService.register`** (`features/passwords/password-auth.service.ts`):

- `RateLimiterService.consume` counts sign-ups per IP (`common/rate-limiter.service.ts`; counters in Redis or memory).
- `normalizeEmail` (`common/identifiers.ts`) lowercases and validates the email.
- `assertRegistrationRules` applies the settings (sign-up open? allowed domains? names and terms required?).
- `PasswordPolicyService.assertPasswordIsAcceptable` checks length and character rules, and asks haveibeenpwned.com (only the first 5 characters of the SHA-1 hash are sent) whether the password was in a breach.
- **If the email already has an account**, the same "verification required" answer is returned as for a new account, so nobody can find out who is registered. If that existing account never verified, it gets a fresh verification email.
- Otherwise, in one database transaction: `UsersService.createUser` (default roles, status `PENDING_VERIFICATION` or `ACTIVE`, event `user.created`) and the Argon2id hash (`hashPassword`) goes into `auth_passwords`.
- If verification is needed, `EmailVerificationService.sendVerificationEmail` → `LinkTokensService.createLinkToken` (random token; only its SHA-256 hash is stored) → `NotificationsService.sendRequiredEmail` → the app's `emailSender`.

### Verify email: `POST /auth/email/verify`

`EmailVerificationService.verifyEmail` (`features/email-links/email-verification.service.ts`):

- `LinkTokensService.useLinkToken` marks the token used **in one UPDATE ... WHERE used_at IS NULL**. If two clicks arrive together, only one gets a row back, so a link can never be used twice.
- `UsersService.markEmailVerified` → `activateIfReady` moves the account to `ACTIVE` once nothing is left to verify (events `user.email_verified`, `user.activated`).

### Login: `POST /auth/login`

`PasswordController.login` → **`PasswordAuthService.signInWithPassword`**:

- Rate limits per IP **and** per account (stops password guessing on one account from many IPs).
- `PasswordPolicyService.verifyPassword` always runs the slow Argon2 check, even when the email has no account (against a dummy hash), so the response time doesn't reveal which emails exist.
- Wrong email or password → `SignInService.recordFailedSignIn` (event `user.sign_in_failed`) and the same `INVALID_CREDENTIALS` either way.
- Right password → the account's counter is reset, an old-style hash is upgraded (`needsRehash`), then **`SignInService.completeSignIn`**.

### The shared ending: `completeSignIn`

Every sign-in method (password, codes, links, Google, passkeys) ends in **`SignInService.completeSignIn`** (`features/sign-in/sign-in.service.ts`). This is the most important function to understand: because every method goes through it, no method can skip a check.

- `assertAccountCanSignIn` looks at the account status:
  - `PENDING_VERIFICATION` → `ACCOUNT_NOT_VERIFIED` with `pendingVerifications`
  - `DEACTIVATED` → `ACCOUNT_DEACTIVATED` with a `reactivationToken`
  - `SUSPENDED` → `ACCOUNT_SUSPENDED`
- 2FA on (and not a passkey)? → `SignInChallengesService.createChallenge` stores a short-lived challenge and the response is `two_factor_required` with a `challengeToken`. No tokens yet.
- Otherwise `startSignedInSession`:
  - `SessionService.startSession` creates the `auth_sessions` row, then `issueTokens` signs the JWT access token (claims: user id `sub`, session id `sid`, roles, sign-in method `amr`...) and creates a refresh token (random, only its hash stored in `auth_refresh_tokens`).
  - `UsersService.recordSignIn`, event `user.signed_in`, and a "new device" email if that setting is on.

### Refresh: `POST /auth/refresh`

`AccountController.refresh` → **`SessionService.refreshSession`** (`features/sessions/session.service.ts`):

- The refresh token is marked used in **one UPDATE**, like link tokens. Exactly one of several parallel refreshes wins.
- No row came back? Either the token is unknown, or it was **already used**: `handleRefreshTokenReuse` treats that as possible theft, ends the whole session and records `session.refresh_token_reused`.
- The session must still be open and the account `ACTIVE`; then `issueTokens` returns a new pair. The old refresh token can never work again (rotation).

### Logout

`AccountController.logout` → `SignInService.signOut` → `SessionService.revokeSession` sets `revoked_at`. The access token still verifies until it expires (a few minutes), except on `@CheckSession()` routes, which see the revoked session immediately.

### Forgot / reset / change password

- `requestPasswordReset`: link token `reset_password`, same answer whether the email exists or not.
- `resetPassword`: `useLinkToken` → save the new hash → `SessionService.revokeAllSessions` (everyone signed out) → event and "password changed" email.
- `changePassword`: needs the current password; other devices are signed out, this one stays.

---

## Two-factor authentication

All in `features/two-factor/two-factor.service.ts`:

- **`startSetup`**: `createTotpSecret` (`common/crypto/totp.ts`), stored encrypted (`EncryptionService.encrypt`: AWS KMS or the local AES-GCM key), not yet active. Returns the `otpauth://` URL for the QR code.
- **`confirmSetup`**: the first code from the app must be right (`checkAuthenticatorCode`). Then 2FA turns on, 10 backup codes are created (only hashes stored), and other devices are signed out.
- **Sign-in**: `completeSignIn` returned a `challengeToken`. `POST /auth/2fa/verify` → **`verifySignInChallenge`**: `findOpenChallenge`, rate limit per user, then the code is checked as an authenticator code **or** a backup code. A code's 30-second time step is remembered (`last_used_time_step`), so the same code can't be replayed. Wrong code → `recordFailedAttempt` (the challenge dies after 5). Right code → `markChallengeUsed` → `SignInService.finishTwoFactorSignIn` → the same `startSignedInSession` as above.

What to notice: the TOTP maths (`common/crypto/totp.ts`) is small and readable. It's a good place to see RFC 6238 implemented in about 100 lines.

---

## Passwordless

All in `features/passwordless/passwordless-auth.service.ts`:

- **Email code**: `sendEmailCode` → `OneTimeCodesService.createCode` (`features/one-time-codes/`; refuses if a code went out less than `resendAfterSeconds` ago; stores a salted hash) → email. `verifyEmailCode`:
  - For a new email, the sign-up details are checked **before** the code is used, so a missing name doesn't waste the code.
  - `OneTimeCodesService.verifyCode` (5 wrong tries kill the code).
  - `UsersService.removeUnprovenPassword`: if someone registered this email long ago with *their* password and never verified it, proving the email now removes that password (account pre-hijacking protection).
  - New user created already verified, or existing user marked verified, then `completeSignIn`.
- **Magic link**: the same shape with a link token (`magic_sign_in`) instead of a code.
- **Phone code**: the same shape with channel `sms`, sent by `NotificationsService.sendSmsCode` through the app's `smsSender` (e.g. `integrations/msg91-sms-sender.ts`).

---

## Social sign-in

`SocialAuthService.signInWithProvider` (`features/social/social-auth.service.ts`):

- `SocialProvidersService.verifyCredential` (`social-providers.service.ts`) checks the token with the provider: Google and Apple ID tokens are verified locally against their public keys (fetched and cached by `common/crypto/remote-public-keys.ts`), checking the audience is one of your client ids; Facebook tokens are checked with the Graph API and your app secret.
- Then the decision described at the top of the file: already linked → sign in; provider proved the email and a user has it → link and sign in; email not proven but taken → refuse; nobody has it → create the user. Every branch ends in `completeSignIn`.

---

## Passkeys

`features/passkeys/passkeys.service.ts`, built on `@simplewebauthn/server`:

- **Adding one**: `startRegistration` creates WebAuthn options and stores the random challenge; the browser or phone creates a key pair and signs it; `finishRegistration` verifies the response and saves the public key (`auth_passkeys`).
- **Signing in**: `startSignIn` → the device signs the challenge with the private key (which never leaves it) → `finishSignIn` checks the signature with the stored public key and the signature counter, then `completeSignIn` with method `passkey`, which skips the 2FA step because the passkey already required a fingerprint, face or PIN.

---

## Email change

`features/email-change/email-change.service.ts`:

- `requestEmailChange`: `confirmOwner` (current password, or a sign-in within the last 10 minutes for accounts without one), then a `change_email` link token is created for the **new** address, unless another account already has that address. The answer is the same in both cases.
- `confirmEmailChange`: `useLinkToken` → update the email (the unique index catches a race with another account) → cancel old links → notice email to the **old** address → event → `activateIfReady`.

---

## Events, audit log and webhooks

Every important action calls **`AuthEventsService.record`** (`features/events/auth-events.service.ts`). One call:

- writes a row to `auth_audit_logs` (who, what, IP, device, details),
- calls the app's `onEvent` handler,
- inserts one `auth_webhook_deliveries` row (status `pending`) per webhook subscribed to that event.

A failure here is logged but never breaks the action that caused it.

**`WebhookDeliveryWorker.sendDueDeliveries`** (`features/webhooks/webhook-delivery.worker.ts`) runs every few seconds on every server:

- Claims due deliveries with `FOR UPDATE SKIP LOCKED`, so two servers never send the same delivery.
- Re-checks the URL is public (`common/network-safety.ts`) before each send, and never follows redirects (protection against requests to internal addresses).
- Signs the body with HMAC (`webhook-signature.ts`; the receiver checks it with `verifyWebhookSignature`).
- 2xx → `delivered`; anything else → retried with growing delays, then `failed`.

---

## Settings

`SettingsService.getSettings` (`features/settings/settings.service.ts`) builds the settings in force from three layers: `DEFAULT_SETTINGS` (constants.ts) ← the app's `settings` in code ← admin changes stored in `auth_settings`. The result is cached for 10 seconds per server, which is how an admin change reaches every server without a restart.

Every change goes through `settings.validation.ts`: field rules (types and ranges, e.g. `magicLink.expiresInMinutes` between 5 and 60) and `findSettingsConflicts` (combinations, e.g. not every sign-in method off).

To add a setting: add it to `AuthSettings` (`settings.types.ts`), give it a default in `DEFAULT_SETTINGS`, add a rule in `settings.validation.ts`, use `settings.yourSection.yourField` in the service, and document it in [Configuration](configuration.md#reference).

---

## Organizations

`features/organizations/organizations.service.ts`: members have a role (`owner`, `admin`, `member`) in `auth_organization_members`. `requireRole` and `assertMayManage` enforce who may do what (an admin can't touch owners; the last owner can't leave). Invitations are link-token-like rows in `auth_organization_invitations`. `switchActiveOrganization` stores the active organization on the session and issues a new access token with `org_id` and `org_role`.

---

## Background cleanup

`DataRetentionService` (`features/maintenance/data-retention.service.ts`) runs every hour. Each step in its `steps` list names a table and a setting; the SQL condition for "old" is in `DATA_RETENTION_OLD_ROW_CONDITION` (constants.ts). Rows are deleted 5,000 at a time so locks stay short.

---

## Where the security decisions are

Good places to slow down and read every comment:

| Topic | Where |
|---|---|
| No account enumeration | `register`, `requestPasswordReset`, `sendEmailCode`, `requestEmailChange` all answer the same either way |
| Timing-safe password check | `PasswordPolicyService.verifyPassword` (dummy hash) |
| Single-use links, codes, refresh tokens | the one-UPDATE pattern in `useLinkToken`, `verifyCode`, `refreshSession` |
| Refresh token theft detection | `SessionService.handleRefreshTokenReuse` |
| Account pre-hijacking | `UsersService.removeUnprovenPassword` |
| 2FA replay | `last_used_time_step` in `two-factor.service.ts` |
| Secrets at rest | `common/encryption.service.ts` (KMS or AES-GCM, with a context per record) |
| Webhook SSRF | `common/network-safety.ts` and the worker |
| Cookie mode CSRF | `common/refresh-token-cookie.ts` (`assertAllowedOrigin`) |

---

## Practice exercises

Small changes that force you through the code. Do them on a branch; the tests tell you if something broke.

- **Trace a refresh token reuse** in the debugger: refresh once, then send the *old* refresh token again. Watch `handleRefreshTokenReuse` end the session, and find the `session.refresh_token_reused` row in `auth_audit_logs`.
- **Add a setting** `security.notifyOnPasswordReset` following the recipe in "Settings" above.
- **Add an event**: record `user.backup_codes_regenerated` in `TwoFactorService.regenerateBackupCodes` (add it to `AUTH_EVENTS` and to [Events](events.md)).
- **Write a test** in `test/` for `buildRefreshCookie` (`common/refresh-token-cookie.ts`) checking every cookie attribute.
- **Read a test**: `scripts/e2e-check.js` and `scripts/http-flow-check.js` are executable descriptions of every flow; reading them next to this page shows what each flow must guarantee.

Before opening a pull request: `npm run typecheck && npm test && npm run build`, and see [Architecture](architecture.md#design-rules-for-contributors) for the house rules.
