# Architecture

For contributors, and for anyone who wants to know what happens inside.

## Layout

```
src/
├── index.ts                   public exports (the only import path apps use)
├── auth.module.ts             AuthModule.forRoot(): wires providers, controllers, guard, filter
├── auth-options.ts            AuthOptions and sender interfaces
├── auth-options.validation.ts startup checks of the options
├── constants.ts               ALL constants: limits, lifetimes, patterns, errors, events
├── common/                    building blocks with no business rules
│   ├── crypto/                jwt (ES256/RS256), totp (RFC 6238), random-secrets, remote-public-keys
│   ├── auth-error.ts          AuthError(AUTH_ERRORS.x) → { status, code, message }
│   ├── auth-exception.filter  one error format for the whole app
│   ├── encryption.service     KMS / local AES-GCM envelope with context binding
│   ├── rate-limiter.service   Redis or memory, fails closed
│   ├── network-safety.ts      SSRF guard for outgoing webhook calls
│   └── identifiers.ts         email / phone normalization
├── database/
│   ├── entities/              one TypeORM entity per table
│   └── create-auth-tables.migration.ts
├── guards/                    AuthGuard + decorators
├── integrations/              ready-made senders (MSG91, console email)
└── features/                  one folder per feature: service (+ controller + dto)
    ├── settings/              defaults → code → admin layering, validation
    ├── signing-keys/          ES256 key creation, rotation, JWKS endpoint
    ├── sessions/              sessions, access and refresh tokens
    ├── users/                 account life cycle, sign-up rules, sign-in method inventory
    ├── sign-in/               completeSignIn pipeline, 2FA / reactivation challenges
    ├── passwords/             register, login, reset, change, password policy
    ├── email-links/           link tokens, email verification
    ├── one-time-codes/        email/SMS codes
    ├── passwordless/          email OTP, magic link, phone OTP
    ├── social/                Google / Apple / Facebook verification and linking
    ├── passkeys/              WebAuthn via @simplewebauthn/server
    ├── two-factor/            TOTP + backup codes
    ├── organizations/         organizations, members, invitations
    ├── api-keys/              machine keys
    ├── webhooks/              admin CRUD, signatures, delivery worker
    ├── events/                audit log → onEvent → webhook queue
    ├── notifications/         wraps the app's email/SMS senders
    ├── account/               /auth/me, sessions, refresh, deactivate
    └── admin/                 admin API
```

## The sign-in pipeline

Every method only **proves identity**, then hands over to `SignInService.completeSignIn()`:

```
 password │ email code │ magic link │ SMS code │ Google/Apple/Facebook │ passkey
          └─────────────────────────────┬──────────────────────────────────────┘
                                        ▼
                         SignInService.completeSignIn(user, method)
                          1. account status check  (NOT_VERIFIED / DEACTIVATED / SUSPENDED)
                          2. 2FA on? → challenge token (except passkeys)
                          3. SessionService.startSession → tokens
                          4. lastSignedInAt, user.signed_in event, new-device email
```

Adding a sign-in method therefore can't skip a security check: it only has to produce a `UserEntity`.

## Data model

```
auth_users ─┬─ auth_passwords (1:1)
            ├─ auth_social_accounts (1:n, unique provider+provider_user_id)
            ├─ auth_passkeys (1:n)
            ├─ auth_two_factor_secrets (1:1) ─ auth_backup_codes (1:n)
            ├─ auth_sessions (1:n) ─ auth_refresh_tokens (1:n)
            ├─ auth_organization_members (n:m) ─ auth_organizations ─ auth_organization_invitations
            └─ auth_audit_logs
auth_link_tokens, auth_one_time_codes, auth_sign_in_challenges   short-lived, single-use
auth_signing_keys        one current key (partial unique index), retired keys kept 2 days
auth_settings            one row (id = 1): the admin's changes
auth_api_keys, auth_webhooks ─ auth_webhook_deliveries
```

The database itself enforces key invariants:
- lowercase emails and E.164 phone numbers
- valid statuses
- every live user has an email or phone
- only one current signing key
- one settings row

## Concurrency

Anything that must happen at most once is a single conditional `UPDATE`:

| What | How |
|---|---|
| Refresh-token use | `UPDATE ... SET used_at = now() WHERE used_at IS NULL ... RETURNING` |
| Link tokens, codes, challenges | Same pattern |
| TOTP replay | `UPDATE ... WHERE last_used_time_step < :step` |
| Status changes | `UPDATE ... WHERE status = :expected` |
| Webhook delivery claims | `FOR UPDATE SKIP LOCKED`, so many servers can run the worker |

## Caches (per server)

| What | Lifetime | Effect |
|---|---|---|
| Settings | 10 s | Admin changes reach every server within 10 s |
| Signing keys | 60 s | Rotation reaches every server within a minute |
| Session checks (`@CheckSession`) | 5 s | Sign-out and suspension take effect within 5 s on those routes |
| Google / Apple public keys | 6 h | Refetched early when an unknown key id appears (at most once a minute) |

## Design rules for contributors

1. **Constants:** every route, status, name, number, pattern, header, message and code goes in `constants.ts`. `test/no-hardcoded-values.test.ts` fails the build otherwise. The only exceptions are code itself (SQL, entity property names), human-readable log text, and released migrations, which must never change.
2. **Names:** use descriptive names, and comments that explain *why*.
3. **Errors:** throw `new AuthError(AUTH_ERRORS.x)`. Never leak internals.
4. **Enumeration:** never reveal whether an account exists before the user proves who they are.
5. **Single use:** anything single-use is consumed with one atomic statement.
6. **Events:** every security-relevant action records an event. Event details never contain secrets.
7. **Settings:** new behavior is controlled by a setting (with validation and a secure default) or a constant. Code does not branch on environment variables.
8. **Tests:** pure logic gets unit tests (`test/`), and SQL changes are run against a real PostgreSQL.
