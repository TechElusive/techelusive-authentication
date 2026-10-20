# Social sign-in: Google, Apple, Facebook

The app signs the user in with the provider's own SDK, then sends the provider's token here. `:provider` is `google`, `apple` or `facebook`; any other value returns `404 NOT_FOUND`. Which token to send is explained in [Sign-in flows](../sign-in-flows.md#google-apple-and-facebook). Shared formats, the sign-in result and the user object are described in [Endpoints](README.md).

---

## POST /auth/social/:provider

Signs in, or signs up if the email is new.

| | |
|---|---|
| Auth | Public |
| Rate limit | 30 per IP per 15 minutes |
| Settings used | `google` / `apple` / `facebook` (enabled + client ids), `registration.*` |

**Request**

```http
POST /auth/social/google
```

```json
{
  "token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20i...",
  "nonce": "b1f3c0d2e4a5",
  "firstName": "Asha",
  "lastName": "Rao",
  "acceptTerms": true,
  "acceptPrivacyPolicy": true
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | Google/Apple: ID token. Facebook: access token. Up to 8192 characters |
| `nonce` | string | no | The **raw** nonce your app used with the provider; required if the token contains one. Up to 256 characters |
| `firstName`, `lastName`, `acceptTerms`, `acceptPrivacyPolicy` | | only for new accounts | Apple sends the name only once, to your app, so pass it here |

**Response `200`:** the [sign-in result](README.md#sign-in-result).

**Errors**

| Status | `code` | When |
|---|---|---|
| 401 | `INVALID_SOCIAL_TOKEN` | Bad signature, expired, issued to another app, wrong nonce, or Facebook rejected it |
| 409 | `ACCOUNT_EXISTS_WITH_OTHER_METHOD` | The provider didn't verify the email (always the case for Facebook) and an account already has it. Sign in normally, then link |
| 400 | `VALIDATION_ERROR` | New account: `missingSignUpDetails`, which includes `"email"` if Facebook gave no email |
| 400 | `EMAIL_DOMAIN_NOT_ALLOWED` | |
| 403 | `SIGN_IN_METHOD_DISABLED` | Provider turned off |
| 403 | `SIGN_UP_CLOSED` | |
| 501 | `NOT_CONFIGURED` | No client ids (Google/Apple) or app secret (Facebook) on the server |

```json
{
  "success": false,
  "code": "ACCOUNT_EXISTS_WITH_OTHER_METHOD",
  "message": "An account with this email already exists. Sign in your usual way, then link this account from your profile."
}
```

---

## POST /auth/social/:provider/link

Connects a provider account to the signed-in user, e.g. from a "Connected accounts" screen.

| | |
|---|---|
| Auth | User, session checked live |

**Request**

```json
{ "token": "eyJhbGciOiJSUzI1NiIs...", "nonce": "b1f3c0d2e4a5" }
```

**Response `200`**

```json
{ "success": true }
```

Linking an account that is already linked to **this** user also returns success.

**Errors**

| Status | `code` | When |
|---|---|---|
| 409 | `SOCIAL_ACCOUNT_IN_USE` | Linked to another user |
| 401 | `INVALID_SOCIAL_TOKEN` | |

---

## DELETE /auth/social/:provider

Disconnects a provider.

| | |
|---|---|
| Auth | User, session checked live |

**Request:** no body.

**Response `200`**

```json
{ "success": true }
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 404 | `NOT_FOUND` | That provider isn't linked |
| 409 | `LAST_SIGN_IN_METHOD` | It's the user's only way to sign in |
