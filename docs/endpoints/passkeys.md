# Passkeys

Needs `passkeys.enabled` and the `passkeys` option on the server; otherwise `403 SIGN_IN_METHOD_DISABLED` / `501 NOT_CONFIGURED`. Each ceremony is two calls: **options** (the server creates a challenge) and **verify** (the device signed it). Browser code is in [Sign-in flows](../sign-in-flows.md#passkeys). Shared formats, the sign-in result and the user object are described in [Endpoints](README.md).

---

## POST /auth/passkeys/register/options

Starts adding a passkey for the signed-in user.

| | |
|---|---|
| Auth | User, session checked live |

**Request:** no body.

**Response `200`**

```json
{
  "success": true,
  "challengeToken": "ch_Zm9vYmFyZXhhbXBsZWNoYWxsZW5nZXRva2VuMTIzNDU2Nzg",
  "options": {
    "challenge": "lB3yW9kQ2x...",
    "rp": { "name": "MyApp", "id": "myapp.com" },
    "user": { "id": "NWYwYzhhMmUt...", "name": "asha@example.com", "displayName": "Asha Rao" },
    "pubKeyCredParams": [{ "alg": -8, "type": "public-key" }, { "alg": -7, "type": "public-key" }, { "alg": -257, "type": "public-key" }],
    "timeout": 60000,
    "attestation": "none",
    "excludeCredentials": [],
    "authenticatorSelection": { "residentKey": "required", "userVerification": "required", "requireResidentKey": true }
  }
}
```

Pass `options` unchanged to `startRegistration({ optionsJSON: options })` (browser) or your platform's passkey API. The challenge expires after 5 minutes.

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `problems: ["too many passkeys"]` (20 per user) |

---

## POST /auth/passkeys/register/verify

Saves the new passkey.

| | |
|---|---|
| Auth | User, session checked live |

**Request**

```json
{
  "challengeToken": "ch_Zm9vYmFyZXhhbXBsZWNoYWxsZW5nZXRva2VuMTIzNDU2Nzg",
  "name": "My laptop",
  "response": {
    "id": "Q2xpZW50Q3JlZGVudGlhbElk",
    "rawId": "Q2xpZW50Q3JlZGVudGlhbElk",
    "type": "public-key",
    "response": {
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIi...",
      "attestationObject": "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YV...",
      "transports": ["internal", "hybrid"]
    },
    "clientExtensionResults": {},
    "authenticatorAttachment": "platform"
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `challengeToken` | string | yes | from `register/options` |
| `response` | object | yes | exactly what the browser / platform API returned, as JSON |
| `name` | string | no | up to 60 characters; default `"Passkey"` |

**Response `200`**

```json
{
  "success": true,
  "passkey": { "id": "a7c1...", "name": "My laptop", "isBackedUp": true, "createdAt": "2026-10-20T06:30:00.000Z", "lastUsedAt": null }
}
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_TOKEN` | Challenge unknown, used or expired |
| 401 | `INVALID_PASSKEY` | Verification failed (wrong origin, no fingerprint/PIN, tampered response) |

---

## POST /auth/passkeys/sign-in/options

Starts a passkey sign-in. No email is needed: the device offers the user's passkeys for your site.

| | |
|---|---|
| Auth | Public |
| Rate limit | 30 per IP per 15 minutes |

**Request:** no body.

**Response `200`**

```json
{
  "success": true,
  "challengeToken": "ch_YW5vdGhlcmV4YW1wbGVjaGFsbGVuZ2V0b2tlbjEyMzQ1Njc",
  "options": { "challenge": "pX9...", "timeout": 60000, "rpId": "myapp.com", "userVerification": "required" }
}
```

---

## POST /auth/passkeys/sign-in/verify

Finishes the sign-in. No 2FA step follows: a passkey counts as two factors.

| | |
|---|---|
| Auth | Public |

**Request**

```json
{
  "challengeToken": "ch_YW5vdGhlcmV4YW1wbGVjaGFsbGVuZ2V0b2tlbjEyMzQ1Njc",
  "response": {
    "id": "Q2xpZW50Q3JlZGVudGlhbElk",
    "rawId": "Q2xpZW50Q3JlZGVudGlhbElk",
    "type": "public-key",
    "response": {
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0Ii...",
      "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAQ",
      "signature": "MEUCIQDf...",
      "userHandle": "NWYwYzhhMmUt..."
    },
    "clientExtensionResults": {}
  }
}
```

**Response `200`:** the [sign-in result](README.md#sign-in-result) (always `signed_in` when successful).

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_TOKEN` | Challenge unknown, used or expired |
| 401 | `INVALID_PASSKEY` | Unknown passkey or bad signature |
| 403 | `ACCOUNT_*` | See [sign-in result](README.md#sign-in-result) |

---

## GET /auth/passkeys

| | |
|---|---|
| Auth | User |

**Response `200`**

```json
{
  "success": true,
  "passkeys": [
    { "id": "a7c1...", "name": "My laptop", "isBackedUp": true, "createdAt": "2026-10-20T06:30:00.000Z", "lastUsedAt": "2026-10-21T08:00:00.000Z" }
  ]
}
```

## PATCH /auth/passkeys/:passkeyId

Renames a passkey. Auth: User.

**Request**

```json
{ "name": "Work phone" }
```

**Response `200`:** `{ "success": true }`. Errors: `404 NOT_FOUND`.

## DELETE /auth/passkeys/:passkeyId

Removes a passkey. Auth: User, session checked live. No body.

**Response `200`:** `{ "success": true }`. Errors: `404 NOT_FOUND`, `409 LAST_SIGN_IN_METHOD`.
