# Error codes

Every error has this shape:

```json
{ "success": false, "code": "INVALID_OTP", "message": "This code is incorrect.", "attemptsLeft": 3 }
```

- **`code`** is stable. Write your app logic against it.
- **`message`** is safe to show to users, but may be reworded between versions. Translate by `code` if your app is multilingual.
- **Extra fields** appear on some errors, as listed below.

The error list is defined in `AUTH_ERRORS` in [`src/constants.ts`](../src/constants.ts) and exported, so TypeScript clients can import it.

## 400: the request is wrong

| Code | Meaning | Extra fields |
|---|---|---|
| `VALIDATION_ERROR` | Missing, wrong-type or unknown fields. | `problems` (from the body checks) or `missingSignUpDetails` (a new account needs these: `firstName`, `lastName`, `acceptTerms`, `acceptPrivacyPolicy`, `email`) |
| `INVALID_EMAIL` | Not an email address. | |
| `INVALID_PHONE` | Not an international number (`+` and country code). | |
| `INVALID_PASSWORD` | Breaks the password rules, or appeared in a data breach (different message). | `requirements` (e.g. `["at least 10 characters"]`) |
| `TERMS_NOT_ACCEPTED` | `acceptTerms` must be `true`. | |
| `PRIVACY_POLICY_NOT_ACCEPTED` | `acceptPrivacyPolicy` must be `true`. | |
| `EMAIL_DOMAIN_NOT_ALLOWED` | `registration.allowedEmailDomains` excludes this email. | |
| `PHONE_COUNTRY_NOT_ALLOWED` | `phoneOtp.allowedCountryCodes` excludes this number. | |
| `INVALID_OTP` | Wrong email/SMS code. | `attemptsLeft` |
| `OTP_EXPIRED` | No usable code: expired, used, too many wrong tries, or never sent. Ask for a new one. | |
| `INVALID_TOKEN` | A link token (verify email, reset password, magic link, email change, invitation) or challenge token is invalid, expired or used. | |
| `EMAIL_UNCHANGED` | `POST /auth/email/change` with the account's current email. | |
| `INVALID_SETTINGS` | Admin settings change rejected. | `problems` |
| `UNSAFE_WEBHOOK_URL` | Webhook URL is not public https. | `problem` |

## 401: who are you?

| Code | Meaning | What the client should do |
|---|---|---|
| `UNAUTHORIZED` | No access token on a protected route. | Go to sign-in |
| `INVALID_TOKEN` | Access token expired or invalid, **or** refresh token invalid. | On an API call: refresh once and retry. On `/auth/refresh`: go to sign-in |
| `INVALID_CREDENTIALS` | Wrong email or password (always the same for both). | Show the message |
| `INVALID_OTP` | Wrong 2FA code at `/auth/2fa/verify`. | Let the user retry |
| `INVALID_API_KEY` | Missing, wrong, revoked or expired API key. | Fix the server's configuration |
| `INVALID_SOCIAL_TOKEN` | Google/Apple/Facebook token could not be verified (expired, wrong app, wrong nonce). | Sign in with the provider again |
| `INVALID_PASSKEY` | Passkey signature could not be verified, or the passkey is unknown. | Try again or use another method |

## 403: not allowed

| Code | Meaning | Extra fields |
|---|---|---|
| `ACCOUNT_NOT_VERIFIED` | Verification still owed. | `pendingVerifications`, `email?`, `phoneNumber?` |
| `ACCOUNT_DEACTIVATED` | The user deactivated the account. | `reactivationToken`, `expiresIn` |
| `ACCOUNT_SUSPENDED` | An admin suspended the account. | |
| `FORBIDDEN` | Missing role, organization role or API-key scope; or a cookie refresh from a website not in `refreshTokenCookie.allowedOrigins`. | |
| `RECENT_SIGN_IN_REQUIRED` | Changing the email of an account without a password needs a sign-in from the last 10 minutes. Sign in again, then retry. | |
| `SIGN_UP_CLOSED` | Sign-up is off (`registration.enabled`, or that method's `allowSignUp`). | |
| `SIGN_IN_METHOD_DISABLED` | That sign-in method is turned off. | |
| `FEATURE_DISABLED` | Organizations or 2FA are turned off. | |

## 404

| Code | Meaning |
|---|---|
| `NOT_FOUND` | Unknown id, or an organization you are not a member of (deliberately the same, so outsiders can't probe). |

## 409: conflicts with current state

| Code | Meaning |
|---|---|
| `ACCOUNT_ALREADY_EXISTS` | Phone number already used by another account, or a sign-up race. |
| `ACCOUNT_EXISTS_WITH_OTHER_METHOD` | Social sign-in with an unverified email that belongs to an existing account. Sign in normally and link from settings. |
| `SOCIAL_ACCOUNT_IN_USE` | This Google/Apple/Facebook account is linked to another user. |
| `LAST_SIGN_IN_METHOD` | Removing this would leave no way to sign in. |
| `TWO_FACTOR_ALREADY_ENABLED` / `TWO_FACTOR_NOT_ENABLED` / `TWO_FACTOR_SETUP_NOT_STARTED` | 2FA state does not allow this step. |
| `ORGANIZATION_SLUG_TAKEN` | |
| `ALREADY_MEMBER` | |
| `LAST_OWNER` | An organization must keep at least one owner. |
| `ACCOUNT_NOT_DEACTIVATED` | Reactivation of an account that isn't deactivated. |
| `EMAIL_IN_USE` | Confirming an email change, but another account took the address in the meantime. |
| `CONFLICT` | Any other conflict raised by your own code. |

## 429, 5xx

| Code | Meaning | Extra fields |
|---|---|---|
| `TOO_MANY_REQUESTS` | Rate limit, or a new code asked for within `resendAfterSeconds` (60 by default). Also sent as a `Retry-After` header. | `retryAfterSeconds` |
| `NOT_CONFIGURED` (501) | Feature turned on in settings but not set up in code (no `smsSender`, no Google client id, no `passkeys` option...). | |
| `INTERNAL_SERVER_ERROR` (500) | Unexpected failure (details only in the server log), or an email/SMS could not be sent. | |

## Using errors in your own code

`AuthModule` installs its error formatter app-wide, so your controllers get the same format. Throw library errors by their definition:

```ts
import { AUTH_ERRORS, AuthError } from '@techelusive/nest-auth';

throw new AuthError(AUTH_ERRORS.forbidden);
throw new AuthError(AUTH_ERRORS.validationFailed, { problems: [PICKUP_TIME_MUST_BE_IN_FUTURE] }); // your own constant
```

Any NestJS `HttpException` you throw is formatted too, with a code based on its status (`NOT_FOUND`, `CONFLICT`...).
