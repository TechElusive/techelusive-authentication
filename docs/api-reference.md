# API reference

A one-page overview of every endpoint. For the **exact request and response JSON** of each one, see [Endpoints](endpoints/README.md).

## Conventions

- **Base path:** all routes are under `/auth`, except `GET /.well-known/jwks.json`.
- **Content type:** request and response bodies are JSON. Unknown body fields are **rejected** (`VALIDATION_ERROR`), which stops clients from sneaking in fields such as `roles`.
- **Success:** every success response has `"success": true`.
- **Errors:** every error looks like `{ "success": false, "code": "...", "message": "..." }`, sometimes with extra fields. See [Error codes](error-codes.md).
- **Auth column:**
  - *Public:* no token needed.
  - *User:* `Authorization: Bearer <accessToken>`.
  - *User + live:* also checks in the database that the session is still active (sensitive actions).
  - *Admin:* a user with a role in `settings.admin.adminRoles`, checked live.
- **Rate limits:** a limited request returns `429 TOO_MANY_REQUESTS` with `retryAfterSeconds` and a `Retry-After` header.
- **Sign-in result:** "→ sign-in result" means the response is `signed_in` or `two_factor_required`, see [Sign-in flows](sign-in-flows.md#every-sign-in-ends-the-same-way).

## Email + password

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | Public | `email`, `password`, `firstName?`, `lastName?`, `phoneNumber?`, `acceptTerms?`, `acceptPrivacyPolicy?` | `201` `{ status: "verification_required", message, pendingVerifications }` or sign-in result |
| POST | `/auth/login` | Public | `email`, `password` | sign-in result |
| POST | `/auth/email/send-verification` | Public | `email` | `{ message }`, always |
| POST | `/auth/email/verify` | Public | `token` | `{ message, status, pendingVerifications }` |
| POST | `/auth/password/forgot` | Public | `email` | `{ message }`, always |
| POST | `/auth/password/reset` | Public | `token`, `newPassword` | `{ message }` |
| POST | `/auth/password/change` | User | `currentPassword?`, `newPassword` | `{ message }` |

## Passwordless

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/email/send-otp` | Public | `email` | `{ message }`, always |
| POST | `/auth/email/verify-otp` | Public | `email`, `code`, sign-up details\* | sign-in result |
| POST | `/auth/magic-link/send` | Public | `email` | `{ message }`, always |
| POST | `/auth/magic-link/verify` | Public | `token`, sign-up details\* | sign-in result |
| POST | `/auth/phone/send-otp` | Public | `phoneNumber` | `{ message }`, always |
| POST | `/auth/phone/verify-otp` | Public | `phoneNumber`, `code`, sign-up details\* | sign-in result |

\* Sign-up details: `firstName?`, `lastName?`, `acceptTerms?`, `acceptPrivacyPolicy?`. They are only used when the request creates a new account.

## Social

`:provider` is `google`, `apple` or `facebook`.

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/social/:provider` | Public | `token`, `nonce?`, sign-up details\* | sign-in result |
| POST | `/auth/social/:provider/link` | User + live | `token`, `nonce?` | `{}` |
| DELETE | `/auth/social/:provider` | User + live | none | `{}` |

## Passkeys

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/passkeys/register/options` | User + live | none | `{ challengeToken, options }` |
| POST | `/auth/passkeys/register/verify` | User + live | `challengeToken`, `response`, `name?` | `{ passkey }` |
| POST | `/auth/passkeys/sign-in/options` | Public | none | `{ challengeToken, options }` |
| POST | `/auth/passkeys/sign-in/verify` | Public | `challengeToken`, `response` | sign-in result |
| GET | `/auth/passkeys` | User | none | `{ passkeys: [{ id, name, isBackedUp, createdAt, lastUsedAt }] }` |
| PATCH | `/auth/passkeys/:id` | User | `name` | `{}` |
| DELETE | `/auth/passkeys/:id` | User + live | none | `{}` |

## Two-factor

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/auth/2fa` | User | none | `{ isEnabled, remainingBackupCodes }` |
| POST | `/auth/2fa/setup` | User + live | none | `{ secret, authenticatorAppUrl }` |
| POST | `/auth/2fa/enable` | User + live | `code` | `{ backupCodes }` |
| POST | `/auth/2fa/disable` | User + live | `code` | `{}` |
| POST | `/auth/2fa/backup-codes` | User + live | `code` | `{ backupCodes }` |
| POST | `/auth/2fa/verify` | Public | `challengeToken`, `code` | `signed_in` result |

## Account and sessions

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/refresh` | Public | `refreshToken` (omit in cookie mode) | `{ accessToken, expiresIn, refreshToken, refreshTokenExpiresAt, sessionId }` |
| POST | `/auth/logout` | User | none | `{ message }` |
| POST | `/auth/logout-all` | User | none | `{ message, endedSessions }` |
| GET | `/auth/me` | User + live | none | `{ user }` |
| PATCH | `/auth/me` | User + live | `firstName?`, `lastName?`, `metadata?` | `{ user }` |
| DELETE | `/auth/me` | User + live | none | `{ message }` |
| GET | `/auth/me/export` | User + live | none | `{ exportedAt, profile, signInMethods, linkedAccounts, passkeys, devices, organizations, securityHistory }` |
| POST | `/auth/email/change` | User + live | `newEmail`, `currentPassword?` | `{ message }` |
| POST | `/auth/email/change/confirm` | Public | `token` | `{ message, user }` |
| GET | `/auth/health` | Public | none | `{ status, checks: { database, redis } }` (503 when unhealthy) |
| GET | `/auth/sign-in-methods` | User | none | `{ signInMethods: { hasPassword, canUseEmailCode, canUsePhoneCode, socialAccounts, passkeyCount } }` |
| GET | `/auth/sessions` | User | none | `{ sessions: [{ id, isCurrentDevice, signInMethod, ipAddress, userAgent, createdAt, lastUsedAt }] }` |
| DELETE | `/auth/sessions/:id` | User | none | `{}` |
| POST | `/auth/deactivate` | User + live | none | `{ message }` |
| POST | `/auth/reactivate` | Public | `reactivationToken` | sign-in result |

### The user object

```jsonc
{
  "id": "5f0c...",
  "email": "asha@example.com",           // null for phone-only users
  "isEmailVerified": true,
  "phoneNumber": "+919876543210",        // null if none
  "isPhoneVerified": false,
  "firstName": "Asha",
  "lastName": "Rao",
  "roles": ["user"],
  "status": "ACTIVE",                    // PENDING_VERIFICATION | ACTIVE | SUSPENDED | DEACTIVATED | DELETED
  "pendingVerifications": [],            // ["email"] / ["phone"] when not yet active
  "onboardingCompleted": false,
  "isTwoFactorEnabled": false,
  "metadata": {},                        // your app's own fields
  "lastSignedInAt": "2026-10-20T05:00:00.000Z",
  "createdAt": "2026-10-01T09:00:00.000Z"
}
```

## Organizations

All need a signed-in user, and roles are checked per organization. See [Organizations](organizations.md).

| Method | Path | Minimum role | Body |
|---|---|---|---|
| GET | `/auth/organizations` | none | none |
| POST | `/auth/organizations` | none | `name`, `slug` |
| POST | `/auth/organizations/switch` | member | `organizationId` (or `null`) → `{ accessToken, expiresIn, organizationId }` |
| POST | `/auth/organizations/invitations/accept` | none | `token` |
| GET | `/auth/organizations/:id` | member | none |
| PATCH | `/auth/organizations/:id` | admin | `name?`, `slug?`, `metadata?` |
| DELETE | `/auth/organizations/:id` | owner | none |
| GET | `/auth/organizations/:id/members` | member | none |
| PATCH | `/auth/organizations/:id/members/:userId` | admin\*\* | `role` |
| DELETE | `/auth/organizations/:id/members/:userId` | admin\*\*, or self | none |
| GET | `/auth/organizations/:id/invitations` | admin | none |
| POST | `/auth/organizations/:id/invitations` | admin\*\* | `email`, `role` |
| DELETE | `/auth/organizations/:id/invitations/:invitationId` | admin | none |

\*\* Anything that makes, changes or removes an **owner** needs an owner.

## Admin

All need an admin. See [Admin, API keys and webhooks](admin-api-keys-webhooks.md).

| Method | Path | Body / query |
|---|---|---|
| GET | `/auth/admin/users` | `?search=&status=&role=&page=&pageSize=` |
| GET | `/auth/admin/users/:id` | none |
| PATCH | `/auth/admin/users/:id` | `firstName?`, `lastName?`, `metadata?` |
| PUT | `/auth/admin/users/:id/roles` | `roles` |
| POST | `/auth/admin/users/:id/suspend` | `reason` |
| POST | `/auth/admin/users/:id/unsuspend` | none |
| POST | `/auth/admin/users/:id/verify-email` | none |
| POST | `/auth/admin/users/:id/reset-2fa` | none |
| POST | `/auth/admin/users/:id/logout-all` | none |
| DELETE | `/auth/admin/users/:id` | none |
| GET / PATCH / DELETE | `/auth/admin/settings` | PATCH: partial settings |
| GET | `/auth/admin/audit-log` | `?userId=&eventName=&page=&pageSize=` |
| GET | `/auth/admin/stats` | none |
| POST | `/auth/admin/maintenance/cleanup` | none |
| POST | `/auth/admin/signing-keys/rotate` | none |
| GET / POST | `/auth/admin/api-keys` | POST: `name`, `scopes`, `organizationId?`, `expiresAt?` |
| DELETE | `/auth/admin/api-keys/:id` | none |
| GET / POST | `/auth/admin/webhooks` | POST: `url`, `eventNames?`, `description?`, `isEnabled?` |
| PATCH / DELETE | `/auth/admin/webhooks/:id` | PATCH: same fields, all optional |
| POST | `/auth/admin/webhooks/:id/rotate-secret` | none |
| POST | `/auth/admin/webhooks/:id/test` | none |
| GET | `/auth/admin/webhooks/:id/deliveries` | `?page=&pageSize=` |
| POST | `/auth/admin/webhooks/:id/deliveries/:deliveryId/retry` | none |

## Public keys

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/.well-known/jwks.json` | Public | `{ keys: [...] }`, the ES256 public keys that verify access tokens. Cached 5 minutes. |
