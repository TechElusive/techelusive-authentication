# Email + password

Turned on by default (`password.enabled`). Every endpoint here returns `403 SIGN_IN_METHOD_DISABLED` when it is off. Shared formats, the sign-in result and the user object are described in [Endpoints](README.md).

---

## POST /auth/register

Creates an account.

| | |
|---|---|
| Auth | Public |
| Rate limit | 10 per IP per hour |
| Settings used | `registration.*`, `activation.*`, `password.*` |

**Request**

```json
{
  "email": "asha@example.com",
  "password": "correct horse battery",
  "firstName": "Asha",
  "lastName": "Rao",
  "phoneNumber": "+919876543210",
  "acceptTerms": true,
  "acceptPrivacyPolicy": true
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | email format |
| `password` | string | yes | password rules from the settings |
| `firstName` | string | when `registration.requireFirstAndLastName` | up to 100 characters |
| `lastName` | string | when `registration.requireFirstAndLastName` | up to 100 characters |
| `phoneNumber` | string | when `registration.requirePhoneNumber` | phone format |
| `acceptTerms` | boolean | must be `true` when `registration.requireTermsAcceptance` | |
| `acceptPrivacyPolicy` | boolean | must be `true` when `registration.requirePrivacyPolicyAcceptance` | |

**Response `201`, verification needed** (default settings):

```json
{
  "success": true,
  "status": "verification_required",
  "message": "Your account has been created. Please verify your details to continue.",
  "pendingVerifications": ["email"]
}
```

A verification email is sent. If the email is **already registered**, the response is exactly the same and no account is created; this protects users' privacy.

**Response `201`, no verification needed** (when the settings require none): the [sign-in result](README.md#sign-in-result).

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_EMAIL` | Not an email address |
| 400 | `INVALID_PHONE` | Phone number not in international form |
| 400 | `INVALID_PASSWORD` | Breaks a rule. `requirements` lists them, e.g. `["at least 10 characters"]`. Same code, different message, when the password is in a data breach |
| 400 | `VALIDATION_ERROR` | Names missing: `problems: ["firstName and lastName are required"]` |
| 400 | `TERMS_NOT_ACCEPTED` / `PRIVACY_POLICY_NOT_ACCEPTED` | Consent missing |
| 400 | `EMAIL_DOMAIN_NOT_ALLOWED` | `registration.allowedEmailDomains` excludes the domain |
| 403 | `SIGN_UP_CLOSED` | `registration.enabled` is `false` |
| 409 | `ACCOUNT_ALREADY_EXISTS` | The phone number belongs to another account |

```json
{
  "success": false,
  "code": "INVALID_PASSWORD",
  "message": "This password does not meet the password rules.",
  "requirements": ["at least 10 characters", "a number"]
}
```

---

## POST /auth/login

Signs in with email and password.

| | |
|---|---|
| Auth | Public |
| Rate limit | 30 per IP and 10 per email per 15 minutes |

**Request**

```json
{ "email": "asha@example.com", "password": "correct horse battery" }
```

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |
| `password` | string | yes |

**Response `200`:** the [sign-in result](README.md#sign-in-result) (`signed_in` or `two_factor_required`).

**Errors**

| Status | `code` | When |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | Wrong email **or** password (deliberately the same) |
| 403 | `ACCOUNT_NOT_VERIFIED` / `ACCOUNT_DEACTIVATED` / `ACCOUNT_SUSPENDED` | See [sign-in result](README.md#sign-in-result) |

```json
{ "success": false, "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." }
```

---

## POST /auth/email/send-verification

Sends (or re-sends) the verification link. Answers the same whether or not the email has an account.

| | |
|---|---|
| Auth | Public |
| Rate limit | 10 per IP and 3 per email per hour |

**Request**

```json
{ "email": "asha@example.com" }
```

**Response `200`**

```json
{ "success": true, "message": "If this email needs verifying, a verification link is on its way." }
```

---

## POST /auth/email/verify

Uses the token from the verification link. If nothing else is pending, the account becomes `ACTIVE`.

| | |
|---|---|
| Auth | Public |

**Request**

```json
{ "token": "ev_Q2x4bWZkY2V0ZXN0dG9rZW5leGFtcGxlMTIzNDU2Nzg5MDE" }
```

**Response `200`**

```json
{
  "success": true,
  "message": "Your email has been verified.",
  "status": "ACTIVE",
  "pendingVerifications": []
}
```

If the settings also require a verified phone, `status` stays `PENDING_VERIFICATION` and `pendingVerifications` is `["phone"]`.

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_TOKEN` | Unknown, used, expired (`emailVerification.linkExpiresInHours`, 24 by default), or the account's email has changed since |

---

## POST /auth/password/forgot

Emails a password reset link. Answers the same whether or not the email has an account.

| | |
|---|---|
| Auth | Public |
| Rate limit | 10 per IP and 3 per email per hour |

**Request**

```json
{ "email": "asha@example.com" }
```

**Response `200`**

```json
{ "success": true, "message": "If an account exists for this email, a password reset link is on its way." }
```

---

## POST /auth/password/reset

Sets a new password using the token from the reset link (valid `passwordReset.linkExpiresInMinutes`, 60 by default). Signs the user out on every device and marks the email verified.

| | |
|---|---|
| Auth | Public |

**Request**

```json
{ "token": "pr_Q2x4bWZkY2V0ZXN0dG9rZW5leGFtcGxlMTIzNDU2Nzg5MDE", "newPassword": "a brand new passphrase" }
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `token` | string | yes | token from the link |
| `newPassword` | string | yes | password rules |

**Response `200`**

```json
{ "success": true, "message": "Your password has been reset. Please sign in with your new password." }
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_PASSWORD` | Breaks a rule (`requirements`) |
| 400 | `INVALID_TOKEN` | Link unknown, used or expired |

---

## POST /auth/password/change

Changes the password of the signed-in user. Other devices are signed out; this one stays signed in. Users without a password (signed up with Google etc.) leave out `currentPassword` to set one.

| | |
|---|---|
| Auth | User (`Authorization: Bearer ...`) |
| Rate limit | 5 per user per 15 minutes |

**Request**

```json
{ "currentPassword": "correct horse battery", "newPassword": "a brand new passphrase" }
```

| Field | Type | Required |
|---|---|---|
| `currentPassword` | string | yes, if the account has a password |
| `newPassword` | string | yes |

**Response `200`**

```json
{ "success": true, "message": "Your password has been changed. Other devices have been signed out." }
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | `currentPassword` is wrong |
| 400 | `INVALID_PASSWORD` | Breaks a rule, or `requirements: ["different from your current password"]` |
