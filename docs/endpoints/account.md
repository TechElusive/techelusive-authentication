# Account and sessions

Shared formats, the sign-in result and the user object are described in [Endpoints](README.md).

---

## POST /auth/refresh

Swaps a refresh token for a new access token **and a new refresh token**. Each refresh token works once. Always store the new one, and never run two refreshes at the same time; see [Client integration](../client-integration.md#refreshing-tokens).

| | |
|---|---|
| Auth | Public |
| Rate limit | 120 per IP per minute |

**Request**

```json
{ "refreshToken": "rt_Q2x4bWZkY2V0ZXN0dG9rZW5leGFtcGxlMTIzNDU2Nzg5MDE" }
```

With [cookie mode](../client-integration.md#web-apps-refresh-token-in-a-cookie), web apps send `{}` instead (with `credentials: 'include'`): the token comes from the HttpOnly cookie, the request must come from one of `refreshTokenCookie.allowedOrigins` (otherwise `403 FORBIDDEN`), and the response carries `"refreshTokenInCookie": true` instead of `refreshToken`.

**Response `200`**

```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJFUzI1NiIs...",
  "expiresIn": 900,
  "refreshToken": "rt_TmV3UmVmcmVzaFRva2VuRXhhbXBsZTEyMzQ1Njc4OTAxMjM",
  "refreshTokenExpiresAt": "2026-11-19T06:45:00.000Z",
  "sessionId": "8c1e2f4a-3b6d-4e8f-9a1b-2c3d4e5f6a7b"
}
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 401 | `INVALID_TOKEN` | Unknown, expired or already used (a reused token also ends the session), the session ended, or the account isn't `ACTIVE`. Send the user to sign-in |

---

## POST /auth/logout

Signs out the device that sends the request. Auth: User. No body.

**Response `200`**

```json
{ "success": true, "message": "You have been signed out." }
```

## POST /auth/logout-all

Signs out every device of the user, including this one. Auth: User. No body.

**Response `200`**

```json
{ "success": true, "message": "You have been signed out on all devices.", "endedSessions": 3 }
```

---

## GET /auth/me

| | |
|---|---|
| Auth | User, session checked live |

**Response `200`**

```json
{ "success": true, "user": { "id": "5f0c...", "email": "asha@example.com", "status": "ACTIVE", "...": "see the user object" } }
```

## PATCH /auth/me

Changes the user's own name and app fields. Users can't change their roles, status, email or phone here.

| | |
|---|---|
| Auth | User, session checked live |

**Request** (all fields optional):

```json
{ "firstName": "Asha", "lastName": "Rao-Mehta", "metadata": { "preferredLanguage": "hi" } }
```

| Field | Type | Rules |
|---|---|---|
| `firstName` | string | up to 100 characters |
| `lastName` | string | up to 100 characters |
| `metadata` | object | replaces the whole object |

**Response `200`:** `{ "success": true, "user": { ... } }`

---

## GET /auth/sign-in-methods

How the user can sign in, for a "Sign-in methods" screen. Auth: User.

**Response `200`**

```json
{
  "success": true,
  "signInMethods": {
    "hasPassword": true,
    "canUseEmailCode": true,
    "canUsePhoneCode": false,
    "socialAccounts": [{ "provider": "google", "email": "asha@gmail.com", "linkedAt": "2026-10-02T10:00:00.000Z" }],
    "passkeyCount": 1
  }
}
```

---

## GET /auth/sessions

The user's signed-in devices. Auth: User.

**Response `200`**

```json
{
  "success": true,
  "sessions": [
    {
      "id": "8c1e2f4a-3b6d-4e8f-9a1b-2c3d4e5f6a7b",
      "isCurrentDevice": true,
      "signInMethod": "password",
      "ipAddress": "203.0.113.10",
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ...",
      "createdAt": "2026-10-20T06:30:00.000Z",
      "lastUsedAt": "2026-10-20T07:10:00.000Z"
    }
  ]
}
```

`signInMethod` is one of `password`, `email_otp`, `magic_link`, `phone_otp`, `google`, `apple`, `facebook`, `passkey`.

## DELETE /auth/sessions/:sessionId

Signs out one of the user's devices. Auth: User. No body.

**Response `200`:** `{ "success": true }`. Errors: `404 NOT_FOUND` (not this user's, or already signed out).

---

## POST /auth/deactivate

Switches the account off and signs out everywhere. Signing in later offers reactivation.

| | |
|---|---|
| Auth | User, session checked live |

**Request:** no body.

**Response `200`**

```json
{ "success": true, "message": "Your account has been deactivated. Sign in again at any time to reactivate it." }
```

**Errors:** `403 ACCOUNT_SUSPENDED` (a suspended account can't deactivate itself).

## POST /auth/reactivate

After a sign-in returned `ACCOUNT_DEACTIVATED`, switches the account back on and signs in.

| | |
|---|---|
| Auth | Public |

**Request**

```json
{ "reactivationToken": "ch_cmVhY3RpdmF0aW9uZXhhbXBsZXRva2VuMTIzNDU2Nzg5MA" }
```

**Response `200`:** the [sign-in result](README.md#sign-in-result) (it may be `two_factor_required`).

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_TOKEN` | Unknown, used or expired (10 minutes) |
| 409 | `ACCOUNT_NOT_DEACTIVATED` | The account isn't deactivated |

---

## POST /auth/email/change

Starts changing the account's email: sends a confirmation link to the **new** address. Nothing changes until the link is used.

| | |
|---|---|
| Auth | User, session checked live |
| Rate limit | 5 per user per hour |

**Request**

```json
{ "newEmail": "asha.new@example.com", "currentPassword": "correct horse battery" }
```

| Field | Rules |
|---|---|
| `newEmail` | required; must pass `registration.allowedEmailDomains` |
| `currentPassword` | required when the account has a password. Accounts without one (signed up with a code, link, Google or passkey) leave it out, but must have signed in within the last 10 minutes |

**Response `200`** (the same whether or not the new address already belongs to another account, so it can't be used to find out who has an account; a taken address simply gets no link):

```json
{ "success": true, "message": "If this email can be used, a confirmation link is on its way to it." }
```

The new address receives an email of type `confirm_email_change` with a `token`. A newer request cancels the older link.

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_EMAIL` | Not an email address |
| 400 | `EMAIL_UNCHANGED` | It's already the account's email |
| 400 | `EMAIL_DOMAIN_NOT_ALLOWED` | Outside `registration.allowedEmailDomains` |
| 401 | `INVALID_CREDENTIALS` | Wrong or missing `currentPassword` |
| 403 | `RECENT_SIGN_IN_REQUIRED` | No password, and the sign-in was more than 10 minutes ago: sign in again, then retry |
| 429 | `TOO_MANY_REQUESTS` | Rate limit |

## POST /auth/email/change/confirm

Uses the link from the `confirm_email_change` email. Switches the email, marks it verified, cancels links sent to the old address, and emails the **old** address a `email_changed` notice (with the new address masked) so an unwanted change gets noticed. Devices stay signed in.

| | |
|---|---|
| Auth | Public (the link may be opened on another device) |

**Request**

```json
{ "token": "ec_U2FtcGxlRW1haWxDaGFuZ2VUb2tlbkV4YW1wbGUxMjM0NTY" }
```

**Response `200`**

```json
{
  "success": true,
  "message": "Your email has been changed.",
  "user": { "id": "bb306e8b-ff08-4932-859d-eaa38aa8c77c", "email": "asha.new@example.com", "isEmailVerified": true, "...": "the user object" }
}
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_TOKEN` | Unknown, expired (`emailChange.linkExpiresInMinutes`, 60 by default), cancelled by a newer request, or already used |
| 409 | `EMAIL_IN_USE` | Another account took the address after the link was sent |

Events: `user.email_change_requested`, then `user.email_changed`.

---

## GET /auth/me/export

"Download my data", for privacy laws such as India's DPDP Act and the GDPR: everything this library stores about the user. Never includes password hashes, 2FA secrets, backup codes, tokens or keys. Add your app's own data next to it in your own export.

| | |
|---|---|
| Auth | User, session checked live |
| Rate limit | 5 per user per hour |

**Response `200`** (shortened)

```json
{
  "success": true,
  "exportedAt": "2026-10-20T09:36:59.793Z",
  "profile": {
    "id": "bb306e8b-ff08-4932-859d-eaa38aa8c77c",
    "email": "asha.new@example.com",
    "...": "the user object, plus:",
    "termsAcceptedAt": "2026-10-20T09:36:59.277Z",
    "privacyPolicyAcceptedAt": "2026-10-20T09:36:59.277Z",
    "onboardingCompletedAt": null,
    "updatedAt": "2026-10-20T09:36:59.767Z"
  },
  "signInMethods": { "hasPassword": true, "canUseEmailCode": true, "canUsePhoneCode": false, "socialAccounts": [], "passkeyCount": 0 },
  "linkedAccounts": [{ "provider": "google", "email": "asha@gmail.com", "linkedAt": "2026-10-20T09:40:00.000Z" }],
  "passkeys": [{ "name": "MacBook", "createdAt": "2026-10-20T09:41:00.000Z", "lastUsedAt": null }],
  "devices": [
    { "signInMethod": "password", "ipAddress": "203.0.113.10", "userAgent": "Mozilla/5.0 ...", "signedInAt": "2026-10-20T09:36:59.558Z", "lastUsedAt": "2026-10-20T09:36:59.558Z", "endedAt": null }
  ],
  "organizations": [{ "name": "Acme Travels", "role": "owner", "joinedAt": "2026-10-20T09:42:00.000Z" }],
  "securityHistory": [
    { "event": "user.email_changed", "ipAddress": "203.0.113.10", "userAgent": "Mozilla/5.0 ...", "details": { "newEmail": "a***@example.com", "previousEmail": "a***@example.com" }, "at": "2026-10-20T09:36:59.770Z" }
  ]
}
```

`devices` includes ended sessions until the data-retention cleanup removes them; `securityHistory` is the newest 1,000 audit entries.

## GET /auth/health

For load balancers and uptime monitors. Checks only what the library needs: PostgreSQL, and Redis when `redisUrl` is set. Says nothing about users.

| | |
|---|---|
| Auth | Public |

**Response `200`**

```json
{ "success": true, "status": "ok", "checks": { "database": "ok", "redis": "not_used" } }
```

**Response `503`** when a check fails (each check takes at most 2 seconds):

```json
{ "success": false, "status": "error", "checks": { "database": "ok", "redis": "error" } }
```

---

## DELETE /auth/me

Deletes the account permanently. Personal data and every way to sign in are wiped, and all devices are signed out. Ask the user to confirm in your UI first.

| | |
|---|---|
| Auth | User, session checked live |

**Request:** no body.

**Response `200`**

```json
{ "success": true, "message": "Your account has been deleted." }
```

## GET /.well-known/jwks.json

The public keys that verify access tokens, for your other services. Public; cached 5 minutes.

**Response `200`**

```json
{
  "keys": [
    { "kty": "EC", "crv": "P-256", "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0", "kid": "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs", "alg": "ES256", "use": "sig" }
  ]
}
```
