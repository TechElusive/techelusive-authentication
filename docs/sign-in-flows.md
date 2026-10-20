# Sign-in flows

Each flow below lists the requests your app makes and how to handle each response. Request and response bodies are JSON. All examples assume the default settings unless noted.

## Every sign-in ends the same way

Whichever method is used, a successful sign-in returns one of two shapes:

```jsonc
// Signed in
{
  "success": true,
  "status": "signed_in",
  "accessToken": "eyJhbGciOiJFUzI1NiIs...",   // send as "Authorization: Bearer ..."
  "expiresIn": 900,                           // seconds
  "refreshToken": "rt_Q2x...",                // store securely, use once
  "refreshTokenExpiresAt": "2026-11-19T10:00:00.000Z",
  "sessionId": "8c1e...",
  "user": { "id": "...", "email": "...", "roles": ["user"], "status": "ACTIVE", "onboardingCompleted": false, ... }
}

// Two-factor authentication is on: ask for the authenticator code
{ "success": true, "status": "two_factor_required", "challengeToken": "ch_...", "expiresIn": 300 }
```

The account checks also happen in one place, so every method fails the same way:

| Error code | Meaning | What to show |
|---|---|---|
| `ACCOUNT_NOT_VERIFIED` | Required verification missing. Body has `pendingVerifications: ["email"]` or `["phone"]`, plus `email` / `phoneNumber`. | Go to the verification screen |
| `ACCOUNT_DEACTIVATED` | The user switched their account off. Body has `reactivationToken` (valid 10 min). | "Welcome back, reactivate?" Then call `POST /auth/reactivate` |
| `ACCOUNT_SUSPENDED` | An admin blocked the account. | "Contact support" |

These codes appear only **after** the user has proven who they are (right password, right code), so they never reveal anything to a stranger.

## Two-factor step

When a sign-in returns `two_factor_required`:

```http
POST /auth/2fa/verify
{ "challengeToken": "ch_...", "code": "123456" }
```

`code` is the 6-digit code from the authenticator app, **or** a backup code such as `k7m2-x9p4`. The response is the normal `signed_in` result. After 5 wrong codes the challenge stops working and the user must sign in again. Passkey sign-ins skip this step, because a passkey already counts as two factors.

---

## Email + password

### Register

```http
POST /auth/register
{
  "email": "asha@example.com",
  "password": "correct horse battery",
  "firstName": "Asha",
  "lastName": "Rao",
  "phoneNumber": "+919876543210",   // optional unless registration.requirePhoneNumber
  "acceptTerms": true,
  "acceptPrivacyPolicy": true
}
```

| Response | Next step |
|---|---|
| `201 { status: "verification_required", pendingVerifications: ["email"] }` | Show "check your email" |
| `201 { status: "signed_in", ... }` | Only when the settings require no verification |
| `400 INVALID_PASSWORD` with `requirements: [...]` | Show which rules failed |
| `400 INVALID_PASSWORD` (breach message) | "This password appeared in a data breach" |
| `400 TERMS_NOT_ACCEPTED` / `PRIVACY_POLICY_NOT_ACCEPTED` / `VALIDATION_ERROR` | Form errors |

If the email is **already registered**, the response is the same `verification_required`, and no account is created. A real owner who never verified gets a fresh verification email. This stops the sign-up form from revealing who has an account.

### Verify the email

The verification email has a token (`ev_...`). Put it in a link to your web page or deep link, and have the page call:

```http
POST /auth/email/verify
{ "token": "ev_..." }
→ { "success": true, "status": "ACTIVE", "pendingVerifications": [] }
```

Resend with `POST /auth/email/send-verification { "email": "..." }` (always answers success). Instead of a link, you can verify with a code: `POST /auth/email/send-otp` and then `POST /auth/email/verify-otp`. That also signs the user in. See [Email code](#email-code).

### Sign in

```http
POST /auth/login
{ "email": "asha@example.com", "password": "..." }
```

A wrong email and a wrong password both give `401 INVALID_CREDENTIALS` and take the same time.

### Forgot / reset password

```http
POST /auth/password/forgot   { "email": "asha@example.com" }     → always success
POST /auth/password/reset    { "token": "pr_...", "newPassword": "..." }
```

A reset signs the user out on every device and marks the email verified (they just proved they read it). The user then signs in with the new password.

### Change password (signed in)

```http
POST /auth/password/change
Authorization: Bearer ...
{ "currentPassword": "...", "newPassword": "..." }
```

Other devices are signed out; this one stays signed in. Users who signed up with Google etc. have no password yet. They can leave out `currentPassword` to set one.

---

## Email code

Good for passwordless apps, and for verifying an email by code instead of a link. Turn on with `emailOtp.enabled`.

```http
POST /auth/email/send-otp     { "email": "asha@example.com" }         → always success
POST /auth/email/verify-otp   { "email": "asha@example.com", "code": "482913" }
```

- **Existing user:** the email is marked verified and the user is signed in.
- **Unknown email (sign-up):** an account is created. If your settings require names or consent, send them with `verify-otp`: `firstName`, `lastName`, `acceptTerms`, `acceptPrivacyPolicy`. If they're missing, you get `VALIDATION_ERROR` with `missingSignUpDetails: ["firstName", ...]`, and **the code is not used up**, so ask for the details and retry with the same code.
- **Wrong code:** `INVALID_OTP` with `attemptsLeft`. After 5 wrong tries, `OTP_EXPIRED`, so request a new code.
- **New code within 60 seconds:** `TOO_MANY_REQUESTS` with `retryAfterSeconds`.

## Magic link

Turn on with `magicLink.enabled`.

```http
POST /auth/magic-link/send     { "email": "asha@example.com" }   → always success
POST /auth/magic-link/verify   { "token": "ml_...", "firstName": "...", ... }
```

Same rules as the email code. A link works once and expires after 15 minutes. For new users, collect the sign-up details on the page **before** calling verify, because the link is used up by the first call.

## Phone code (SMS)

Turn on with `phoneOtp.enabled` and configure `smsSender`.

```http
POST /auth/phone/send-otp     { "phoneNumber": "+91 98765 43210" }   → always success
POST /auth/phone/verify-otp   { "phoneNumber": "+919876543210", "code": "482913" }
```

Numbers must include the country code. Spaces, dashes and brackets are removed. Verifying also marks the phone verified, which is how a user with `pendingVerifications: ["phone"]` finishes activation.

---

## Google, Apple and Facebook

Your app signs the user in with the provider's **own SDK or button** and sends the result to your API. The server never redirects and stores no provider passwords; it verifies the token itself.

| Provider | What to send as `token` | Get it with |
|---|---|---|
| Google | The **ID token** (JWT) | Google Identity Services (web), Credential Manager (Android), Google Sign-In (iOS) |
| Apple | The **identity token** (JWT) | Sign in with Apple JS / `ASAuthorizationAppleIDCredential.identityToken` |
| Facebook | The user **access token** | Facebook Login SDK |

```http
POST /auth/social/google
{ "token": "eyJhbGciOiJSUzI1NiIs...", "nonce": "optional raw nonce" }
```

Apple sends the user's name **only to your app, and only the first time**. Pass it along as `firstName` / `lastName`. Using a `nonce` is strongly recommended with Apple: generate a random string, give its SHA-256 to Apple, and send the raw string here.

How the account is chosen:

1. The provider account was linked before: sign in as that user.
2. The provider **verified** the email and a user has that email: link it and sign in.
3. The email is **not** verified by the provider (Facebook never verifies) and a user has that email: `409 ACCOUNT_EXISTS_WITH_OTHER_METHOD`. Tell the user to sign in their usual way and connect the provider from settings. This blocks account takeover.
4. Nobody has the email: create an account (the same `missingSignUpDetails` rule as codes).

If Facebook returns no email (the user declined), sign-up fails with `missingSignUpDetails: ["email"]`.

Connect or disconnect while signed in:

```http
POST   /auth/social/google/link   { "token": "..." }
DELETE /auth/social/google
```

Disconnecting the last way to sign in is refused with `LAST_SIGN_IN_METHOD`.

---

## Passkeys

Turn on with `passkeys.enabled` and configure the `passkeys` option. The flow uses the WebAuthn browser API, or the platform passkey APIs on iOS and Android. In a browser, [`@simplewebauthn/browser`](https://simplewebauthn.dev) makes it short.

### Add a passkey (signed in)

```ts
import { startRegistration } from '@simplewebauthn/browser';

const { challengeToken, options } = await api.post('/auth/passkeys/register/options');
const response = await startRegistration({ optionsJSON: options });
await api.post('/auth/passkeys/register/verify', { challengeToken, response, name: 'My laptop' });
```

### Sign in with a passkey

```ts
import { startAuthentication } from '@simplewebauthn/browser';

const { challengeToken, options } = await api.post('/auth/passkeys/sign-in/options');
const response = await startAuthentication({ optionsJSON: options });
const result = await api.post('/auth/passkeys/sign-in/verify', { challengeToken, response });
// result.status === "signed_in"
```

No email is needed: the device offers the user's passkeys for your site. Passkeys require a fingerprint, face or PIN, so no 2FA step follows. Manage them with `GET /auth/passkeys`, `PATCH /auth/passkeys/:id { name }` and `DELETE /auth/passkeys/:id`.

---

## Two-factor authentication: turning it on

```http
POST /auth/2fa/setup
→ { "secret": "JBSWY3DPEHPK3PXP", "authenticatorAppUrl": "otpauth://totp/MyApp:asha%40example.com?..." }
```

Show `authenticatorAppUrl` as a QR code, with `secret` underneath for manual entry. Then ask for the first code:

```http
POST /auth/2fa/enable   { "code": "123456" }
→ { "backupCodes": ["k7m2-x9p4", ...10 codes] }
```

Show the backup codes **once** and ask the user to save them. Turning 2FA on signs out other devices.

| Request | Purpose |
|---|---|
| `GET /auth/2fa` | `{ isEnabled, remainingBackupCodes }` |
| `POST /auth/2fa/disable { code }` | Turn off (authenticator or backup code) |
| `POST /auth/2fa/backup-codes { code }` | New set of backup codes |

A user who lost both their phone and backup codes needs an admin: `POST /auth/admin/users/:id/reset-2fa`, after support has confirmed who they are.

---

## Sessions and tokens

### Refreshing

When an access token expires (`401 INVALID_TOKEN`), refresh once and retry the request:

```http
POST /auth/refresh   { "refreshToken": "rt_..." }
→ { "success": true, "accessToken": "...", "refreshToken": "rt_NEW...", ... }
```

**Always replace the stored refresh token with the new one.** Each refresh token works once. If an old one is used again, the server assumes it was stolen and ends that session, and the user must sign in again. If several requests fail at the same moment, make sure only **one** refresh runs. See [Client integration](client-integration.md#refreshing-tokens).

### Signing out

```http
POST /auth/logout       → this device
POST /auth/logout-all   → every device
GET  /auth/sessions     → list devices, with isCurrentDevice
DELETE /auth/sessions/:id
```

After sign-out, the access token keeps working until it expires (at most 15 minutes by default), except on routes marked `@CheckSession()`, which check the session live. Delete both tokens from the client right away.

---

## Account life cycle

```
            register / first sign-in
                       │
                       ▼
          ┌──── PENDING_VERIFICATION ────┐
          │   (verify email / phone)     │
          ▼                              │
        ACTIVE ◄──── reactivate ──── DEACTIVATED
          │  ▲                           ▲
 suspend  │  │ unsuspend (admin)         │ POST /auth/deactivate
 (admin)  ▼  │                           │
       SUSPENDED                       ACTIVE

   any state ── DELETE /auth/me or admin ──► DELETED (personal data wiped, permanent)
```

- **Deactivate:** `POST /auth/deactivate` signs out everywhere. Later, signing in returns `ACCOUNT_DEACTIVATED` with a `reactivationToken`; `POST /auth/reactivate { reactivationToken }` turns the account back on and signs in.
- **Delete:** `DELETE /auth/me` wipes email, phone, names, roles, passwords, linked accounts, passkeys and 2FA, and ends all sessions. The user row stays with status `DELETED`, so your own tables' foreign keys don't break. Delete your app's own data for that user in an `onEvent` handler for `user.deleted`.
- **Onboarding:** after your profile screens, call `UsersService.completeOnboarding(userId, request)` from your own module. `user.onboardingCompleted` then becomes `true`.
