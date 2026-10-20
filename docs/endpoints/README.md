# Endpoints: requests and responses

Every endpoint, with its exact request body, response body and errors, for the backend and frontend developers who integrate with it.

| Page | Endpoints |
|---|---|
| [Email + password](email-password.md) | register, login, email verification, forgot / reset / change password |
| [Passwordless](passwordless.md) | email code, magic link, phone code |
| [Social sign-in](social.md) | Google, Apple, Facebook, link / unlink |
| [Passkeys](passkeys.md) | add, sign in, list, rename, remove |
| [Two-factor](two-factor.md) | setup, enable, verify, disable, backup codes |
| [Account and sessions](account.md) | refresh, logout, me, devices, email change, download my data, health, deactivate / reactivate, delete |
| [Organizations](organizations.md) | organizations, members, invitations, switch |
| [Admin](admin.md) | users, settings, audit log, API keys, webhooks, signing keys |

## How to call the API

```http
POST /auth/login HTTP/1.1
Host: api.myapp.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJFUzI1NiIs...      ← only on routes that need a signed-in user

{ "email": "asha@example.com", "password": "correct horse battery" }
```

- **Body:** request bodies are JSON. **Unknown fields are rejected** with `VALIDATION_ERROR`, so only send the fields listed.
- **Success:** every success response contains `"success": true`. Every error contains `"success": false`, `code` and `message`.
- **Server-to-server:** routes your app marks with `@ApiKeyScopes()` accept an `x-api-key: ak_...` header instead of a bearer token.
- **Paths:** the paths are defined in `ROUTES` in `src/constants.ts`, and exported, so TypeScript clients can import them instead of typing paths.

```ts
import { ROUTES } from '@techelusive/nest-auth';
const loginUrl = `${API_URL}/${ROUTES.auth.prefix}/${ROUTES.auth.login}`;   // https://api.myapp.com/auth/login
```

## Errors every endpoint can return

| Status | `code` | When | Extra fields |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing, wrongly typed, too long or unknown field | `problems: string[]` |
| 401 | `UNAUTHORIZED` | Route needs a signed-in user and no token was sent | |
| 401 | `INVALID_TOKEN` | Access token expired or invalid: refresh and retry once | |
| 429 | `TOO_MANY_REQUESTS` | Rate limit hit (also a `Retry-After` header) | `retryAfterSeconds: number` |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected failure, or an email/SMS could not be sent | |

Example:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Some fields are missing or invalid.",
  "problems": ["email must be a string", "property role should not exist"]
}
```

Each endpoint page lists only its **own** errors in addition to these. All codes are explained in [Error codes](../error-codes.md).

## Shared objects

### Sign-in result

Every endpoint that signs a user in returns **one of these two**.

**Signed in:**

```json
{
  "success": true,
  "status": "signed_in",
  "accessToken": "eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCIsImtpZCI6Ii4uLiJ9.eyJzdWIiOiI1ZjBj...",
  "expiresIn": 900,
  "refreshToken": "rt_Q2x4bWZkY2V0ZXN0dG9rZW5leGFtcGxlMTIzNDU2Nzg5MDE",
  "refreshTokenExpiresAt": "2026-11-19T06:30:00.000Z",
  "sessionId": "8c1e2f4a-3b6d-4e8f-9a1b-2c3d4e5f6a7b",
  "user": { "...": "the user object below" }
}
```

**Two-factor code needed** (then call `POST /auth/2fa/verify`):

```json
{
  "success": true,
  "status": "two_factor_required",
  "challengeToken": "ch_Zm9vYmFyZXhhbXBsZWNoYWxsZW5nZXRva2VuMTIzNDU2Nzg",
  "expiresIn": 300
}
```

Any sign-in can also fail with these errors, but only **after** the user has proven who they are:

| Status | `code` | Extra fields | What the app should do |
|---|---|---|---|
| 403 | `ACCOUNT_NOT_VERIFIED` | `pendingVerifications: ("email"\|"phone")[]`, `email?`, `phoneNumber?` | Open the verification screen |
| 403 | `ACCOUNT_DEACTIVATED` | `reactivationToken: string`, `expiresIn: number` | Offer `POST /auth/reactivate` |
| 403 | `ACCOUNT_SUSPENDED` | | Show "contact support" |

```json
{
  "success": false,
  "code": "ACCOUNT_NOT_VERIFIED",
  "message": "Please finish verifying your account.",
  "pendingVerifications": ["email"],
  "email": "asha@example.com"
}
```

### User object

```json
{
  "id": "5f0c8a2e-1d3b-4c5a-9e7f-0a1b2c3d4e5f",
  "email": "asha@example.com",
  "isEmailVerified": true,
  "phoneNumber": "+919876543210",
  "isPhoneVerified": false,
  "firstName": "Asha",
  "lastName": "Rao",
  "roles": ["user"],
  "status": "ACTIVE",
  "pendingVerifications": [],
  "onboardingCompleted": false,
  "isTwoFactorEnabled": false,
  "metadata": {},
  "lastSignedInAt": "2026-10-20T06:30:00.000Z",
  "createdAt": "2026-10-01T09:00:00.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `email`, `phoneNumber` | `string \| null` | At least one is set. Phone numbers are E.164 (`+919876543210`). |
| `roles` | `string[]` | App-wide roles. Users never set their own. |
| `status` | `"PENDING_VERIFICATION" \| "ACTIVE" \| "SUSPENDED" \| "DEACTIVATED" \| "DELETED"` | |
| `pendingVerifications` | `("email" \| "phone")[]` | What is still needed before `ACTIVE`. |
| `onboardingCompleted` | `boolean` | Set by your app via `UsersService.completeOnboarding`. |
| `metadata` | `object` | Your app's own fields. |
| `lastSignedInAt` | `string \| null` | ISO 8601 |

### Field formats used on these pages

| Format | Meaning |
|---|---|
| email | Up to 254 characters; trimmed and lowercased by the server |
| phone | International number with country code, up to 32 characters typed; spaces, dashes and brackets are removed (`+91 98765-43210` → `+919876543210`) |
| password | Up to 128 characters; the minimum length and rules come from the settings (default: at least 10 characters, not found in data breaches) |
| token | The token from an email link or a previous response, up to 128 characters |
| code | The 6-digit code (or backup code), up to 16 characters |
| uuid | An id such as `5f0c8a2e-1d3b-4c5a-9e7f-0a1b2c3d4e5f`. A path parameter that isn't a uuid returns `400` |
