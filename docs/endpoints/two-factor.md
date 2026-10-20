# Two-factor authentication

Authenticator-app codes (TOTP) plus 10 single-use backup codes. Needs `twoFactor.enabled` (on by default); otherwise `403 FEATURE_DISABLED`. All code-checking endpoints share a limit of 10 attempts per user per 15 minutes. Shared formats, the sign-in result and the user object are described in [Endpoints](README.md).

---

## GET /auth/2fa

| | |
|---|---|
| Auth | User |

**Response `200`**

```json
{ "success": true, "isEnabled": true, "remainingBackupCodes": 8 }
```

---

## POST /auth/2fa/setup

Step 1: creates a secret. Nothing changes for the user until step 2.

| | |
|---|---|
| Auth | User, session checked live |

**Request:** no body.

**Response `200`**

```json
{
  "success": true,
  "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "authenticatorAppUrl": "otpauth://totp/MyApp%3Aasha%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=MyApp&algorithm=SHA1&digits=6&period=30"
}
```

Show `authenticatorAppUrl` as a QR code, with `secret` underneath for typing by hand.

**Errors:** `409 TWO_FACTOR_ALREADY_ENABLED`.

---

## POST /auth/2fa/enable

Step 2: confirms with the first code from the app. Turns 2FA on, signs out other devices, and returns backup codes. **Show the backup codes once** and ask the user to save them.

| | |
|---|---|
| Auth | User, session checked live |

**Request**

```json
{ "code": "123456" }
```

**Response `200`**

```json
{
  "success": true,
  "backupCodes": ["k7m2-x9p4", "h3nq-8v2w", "p5tz-r6c9", "b2wx-m7k3", "s9qf-4h8n", "z3vc-t5p2", "m8kr-q2x6", "w4nh-c9t7", "f6pb-y3m5", "r2xs-k8w4"]
}
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 401 | `INVALID_OTP` | Wrong code |
| 409 | `TWO_FACTOR_SETUP_NOT_STARTED` | Call `/auth/2fa/setup` first |
| 409 | `TWO_FACTOR_ALREADY_ENABLED` | |

---

## POST /auth/2fa/verify

The second step of sign-in, after a sign-in returned `two_factor_required`. Accepts an authenticator code **or** a backup code (each backup code works once).

| | |
|---|---|
| Auth | Public |

**Request**

```json
{ "challengeToken": "ch_Zm9vYmFyZXhhbXBsZWNoYWxsZW5nZXRva2VuMTIzNDU2Nzg", "code": "123456" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `challengeToken` | string | yes | from the sign-in response; valid 5 minutes |
| `code` | string | yes | `"123456"` or a backup code such as `"k7m2-x9p4"` (dash, spaces and capitals are ignored) |

**Response `200`:** the [sign-in result](README.md#sign-in-result) with `status: "signed_in"`.

**Errors**

| Status | `code` | When |
|---|---|---|
| 401 | `INVALID_OTP` | Wrong code (the challenge allows 5 wrong tries) |
| 400 | `INVALID_TOKEN` | Challenge unknown, used, expired, or too many wrong tries: sign in again |

---

## POST /auth/2fa/disable

Turns 2FA off. Needs a current authenticator code or a backup code.

| | |
|---|---|
| Auth | User, session checked live |

**Request**

```json
{ "code": "123456" }
```

**Response `200`:** `{ "success": true }`

**Errors:** `401 INVALID_OTP`, `409 TWO_FACTOR_NOT_ENABLED`.

---

## POST /auth/2fa/backup-codes

Replaces all backup codes with 10 new ones. Needs a current code.

| | |
|---|---|
| Auth | User, session checked live |

**Request**

```json
{ "code": "123456" }
```

**Response `200`:** `{ "success": true, "backupCodes": ["...10 codes..."] }`

**Errors:** `401 INVALID_OTP`, `409 TWO_FACTOR_NOT_ENABLED`.
