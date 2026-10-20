# Passwordless: email code, magic link, phone code

The same endpoints **sign in**, **sign up** (when `allowSignUp` is on) and **verify** the email or phone, because receiving the code proves ownership. Shared formats, the sign-in result and the user object are described in [Endpoints](README.md).

## Sign-up details

The verify endpoints accept these optional fields. They are used **only when the request creates a new account**:

| Field | Type | Rules |
|---|---|---|
| `firstName` | string | up to 100 characters |
| `lastName` | string | up to 100 characters |
| `acceptTerms` | boolean | |
| `acceptPrivacyPolicy` | boolean | |

If your settings require them and they are missing, the response is:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Some fields are missing or invalid.",
  "missingSignUpDetails": ["firstName", "lastName", "acceptTerms"]
}
```

For codes, the code is **not used up** by this error: show a form for the missing details and send the same code again with them.

---

## POST /auth/email/send-otp

Emails a sign-in code. Needs `emailOtp.enabled`.

| | |
|---|---|
| Auth | Public |
| Rate limit | 10 per IP and 5 per email per hour; one code per minute per email |

**Request**

```json
{ "email": "asha@example.com" }
```

**Response `200`** (always the same, whether or not the email has an account):

```json
{ "success": true, "message": "If this destination can receive codes, a code is on its way." }
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_EMAIL` | |
| 403 | `SIGN_IN_METHOD_DISABLED` | `emailOtp.enabled` is off |
| 429 | `TOO_MANY_REQUESTS` | A code was sent less than `emailOtp.resendAfterSeconds` ago (60 by default, returned as `retryAfterSeconds`), or a rate limit was hit |

---

## POST /auth/email/verify-otp

Signs in with the emailed code. Marks the email verified. Creates the account if the email is new and sign-up is allowed.

| | |
|---|---|
| Auth | Public |
| Rate limit | 30 per IP per 15 minutes |

**Request**

```json
{
  "email": "asha@example.com",
  "code": "482913",
  "firstName": "Asha",
  "lastName": "Rao",
  "acceptTerms": true,
  "acceptPrivacyPolicy": true
}
```

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |
| `code` | string | yes |
| sign-up details | | only for new accounts, see above |

**Response `200`:** the [sign-in result](README.md#sign-in-result).

**Errors**

| Status | `code` | When | Extra |
|---|---|---|---|
| 400 | `INVALID_OTP` | Wrong code | `attemptsLeft` |
| 400 | `OTP_EXPIRED` | Expired (10 min), used, 5 wrong tries, or never sent | |
| 400 | `VALIDATION_ERROR` | New account and details missing | `missingSignUpDetails` |
| 400 | `EMAIL_DOMAIN_NOT_ALLOWED` | New account outside `allowedEmailDomains` | |
| 403 | `SIGN_UP_CLOSED` | New email and sign-up is off | |

```json
{ "success": false, "code": "INVALID_OTP", "message": "This code is incorrect.", "attemptsLeft": 3 }
```

---

## POST /auth/magic-link/send

Emails a one-click sign-in link (valid `magicLink.expiresInMinutes`, 15 by default). Needs `magicLink.enabled`.

| | |
|---|---|
| Auth | Public |
| Rate limit | 10 per IP and 3 per email per hour |

**Request**

```json
{ "email": "asha@example.com" }
```

**Response `200`** (always the same):

```json
{ "success": true, "message": "If this email can sign in, a sign-in link is on its way." }
```

---

## POST /auth/magic-link/verify

Signs in with the token from the link. The link works **once**, so for new users collect the sign-up details on the page before calling this.

| | |
|---|---|
| Auth | Public |
| Rate limit | 30 per IP per 15 minutes |

**Request**

```json
{
  "token": "ml_Q2x4bWZkY2V0ZXN0dG9rZW5leGFtcGxlMTIzNDU2Nzg5MDE",
  "firstName": "Asha",
  "lastName": "Rao",
  "acceptTerms": true,
  "acceptPrivacyPolicy": true
}
```

**Response `200`:** the [sign-in result](README.md#sign-in-result).

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_TOKEN` | Unknown, used or expired link |
| 400 | `VALIDATION_ERROR` | New account and `missingSignUpDetails` |
| 403 | `SIGN_UP_CLOSED` / `SIGN_IN_METHOD_DISABLED` | |

---

## POST /auth/phone/send-otp

Sends a sign-in code by SMS. Needs `phoneOtp.enabled` and an `smsSender`.

| | |
|---|---|
| Auth | Public |
| Rate limit | 10 per IP and 5 per number per hour; one code per minute per number |

**Request**

```json
{ "phoneNumber": "+91 98765 43210" }
```

**Response `200`** (always the same):

```json
{ "success": true, "message": "If this destination can receive codes, a code is on its way." }
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_PHONE` | No country code, or not a phone number |
| 400 | `PHONE_COUNTRY_NOT_ALLOWED` | Country not in `phoneOtp.allowedCountryCodes` |
| 403 | `SIGN_IN_METHOD_DISABLED` | Phone sign-in is off |
| 501 | `NOT_CONFIGURED` | No `smsSender` set up on the server |
| 429 | `TOO_MANY_REQUESTS` | Within `phoneOtp.resendAfterSeconds` (60 by default) of the last code, or a rate limit |

---

## POST /auth/phone/verify-otp

Signs in with the SMS code. Marks the phone verified, which is also how an account with `pendingVerifications: ["phone"]` finishes activation.

| | |
|---|---|
| Auth | Public |
| Rate limit | 30 per IP per 15 minutes |

**Request**

```json
{ "phoneNumber": "+919876543210", "code": "482913", "firstName": "Asha", "lastName": "Rao", "acceptTerms": true, "acceptPrivacyPolicy": true }
```

**Response `200`:** the [sign-in result](README.md#sign-in-result).

**Errors:** same as [email verify-otp](#post-authemailverify-otp), plus `INVALID_PHONE`.
