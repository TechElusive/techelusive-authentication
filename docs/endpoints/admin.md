# Admin

Every route needs a signed-in user holding one of `settings.admin.adminRoles` (default `["admin"]`), and the session is checked live. Other users get `403 FORBIDDEN`. Concepts are explained in [Admin, API keys and webhooks](../admin-api-keys-webhooks.md).

## Paged lists

List endpoints accept `?page=1&pageSize=50` (page size 1–200, default 50) and return:

```json
{ "success": true, "users": [], "total": 1234, "page": 1, "pageSize": 50 }
```

---

## Users

### GET /auth/admin/users

| Query | Type | Notes |
|---|---|---|
| `search` | string | matches email, phone, first or last name (partial, case-insensitive) |
| `status` | `PENDING_VERIFICATION` \| `ACTIVE` \| `SUSPENDED` \| `DEACTIVATED` \| `DELETED` | deleted users are hidden unless asked for |
| `role` | string | e.g. `seller` |
| `page`, `pageSize` | number | |

```http
GET /auth/admin/users?search=asha&status=ACTIVE&page=1&pageSize=20
```

**Response `200`**

```json
{ "success": true, "users": [{ "id": "5f0c...", "email": "asha@example.com", "status": "ACTIVE", "...": "user object" }], "total": 1, "page": 1, "pageSize": 20 }
```

### GET /auth/admin/users/:userId

**Response `200`**

```json
{
  "success": true,
  "user": { "id": "5f0c...", "...": "user object" },
  "suspensionReason": null,
  "statusChangedAt": "2026-10-01T09:05:00.000Z",
  "termsAcceptedAt": "2026-10-01T09:00:00.000Z",
  "privacyPolicyAcceptedAt": "2026-10-01T09:00:00.000Z",
  "signInMethods": { "hasPassword": true, "canUseEmailCode": false, "canUsePhoneCode": false, "socialAccounts": [], "passkeyCount": 0 },
  "sessions": [
    { "id": "8c1e...", "signInMethod": "password", "ipAddress": "203.0.113.10", "userAgent": "Mozilla/5.0 ...", "createdAt": "2026-10-20T06:30:00.000Z", "lastUsedAt": "2026-10-20T07:10:00.000Z" }
  ]
}
```

Errors: `404 NOT_FOUND` (also for deleted users).

### PATCH /auth/admin/users/:userId

**Request** (all optional):

```json
{ "firstName": "Asha", "lastName": "Rao", "metadata": { "kycStatus": "approved" } }
```

**Response `200`:** `{ "success": true, "user": { ... } }`

### PUT /auth/admin/users/:userId/roles

Replaces the user's roles. The change appears in the user's next access token.

**Request**

```json
{ "roles": ["user", "seller"] }
```

Each role starts with a letter and uses letters, digits, `_`, `:` or `-`, up to 50 characters, with at most 20 roles.

**Response `200`:** `{ "success": true, "user": { ... } }`

### POST /auth/admin/users/:userId/suspend

Blocks the account and signs it out everywhere. The reason is visible to admins only.

**Request**

```json
{ "reason": "Chargeback fraud, support ticket 4411" }
```

`reason` is required, up to 500 characters.

**Response `200`:** `{ "success": true, "user": { "status": "SUSPENDED", ... } }`

### POST /auth/admin/users/:userId/unsuspend

No body. The account returns to `ACTIVE`, or to `PENDING_VERIFICATION` if verification is still owed. **Response `200`:** `{ "success": true, "user": { ... } }`

### POST /auth/admin/users/:userId/verify-email

No body. Marks the email verified (e.g. after a support check) and activates the account if nothing else is pending. **Response `200`:** `{ "success": true, "user": { ... } }`

### POST /auth/admin/users/:userId/reset-2fa

No body. Turns off two-factor for a user who lost their phone and backup codes. Confirm their identity first. **Response `200`:** `{ "success": true }`

### POST /auth/admin/users/:userId/logout-all

No body. **Response `200`:** `{ "success": true, "endedSessions": 2 }`

### DELETE /auth/admin/users/:userId

No body. Deletes the account permanently (personal data wiped). **Response `200`:** `{ "success": true }`

---

## Settings

### GET /auth/admin/settings

**Response `200`:** the settings in force (every section; see [Configuration](../configuration.md#reference)).

```json
{
  "success": true,
  "settings": {
    "registration": { "enabled": true, "defaultRoles": ["user"], "requireFirstAndLastName": true, "requirePhoneNumber": false, "requireTermsAcceptance": true, "requirePrivacyPolicyAcceptance": true, "allowedEmailDomains": [] },
    "activation": { "requireVerifiedEmail": true, "requireVerifiedPhone": false },
    "password": { "enabled": true, "minimumLength": 10, "requireUppercaseLetter": false, "requireLowercaseLetter": false, "requireNumber": false, "requireSymbol": false, "rejectBreachedPasswords": true, "notifyOnChange": true },
    "emailVerification": { "linkExpiresInHours": 24 },
    "passwordReset": { "linkExpiresInMinutes": 60 },
    "emailChange": { "linkExpiresInMinutes": 60 },
    "emailOtp": { "enabled": false, "codeLength": 6, "expiresInMinutes": 10, "resendAfterSeconds": 60, "allowSignUp": true },
    "magicLink": { "enabled": false, "expiresInMinutes": 15, "allowSignUp": true },
    "phoneOtp": { "enabled": false, "codeLength": 6, "expiresInMinutes": 10, "resendAfterSeconds": 60, "allowSignUp": true, "allowedCountryCodes": [] },
    "google": { "enabled": false, "clientIds": [] },
    "apple": { "enabled": false, "clientIds": [] },
    "facebook": { "enabled": false, "appId": "" },
    "passkeys": { "enabled": false },
    "twoFactor": { "enabled": true, "challengeExpiresInMinutes": 5 },
    "organizations": { "enabled": false, "allowUsersToCreate": true, "invitationExpiresInDays": 7 },
    "tokens": { "accessTokenMinutes": 15, "refreshTokenDays": 30, "sessionDays": 90 },
    "admin": { "adminRoles": ["admin"] },
    "security": { "notifyOnNewSignIn": false },
    "retention": { "enabled": true, "expiredRecordDays": 7, "webhookDeliveryDays": 30, "auditLogDays": 365 }
  }
}
```

### PATCH /auth/admin/settings

Changes only the fields you send. Changes reach every server within 10 seconds.

**Request**

```json
{ "emailOtp": { "enabled": true }, "phoneOtp": { "enabled": true, "allowedCountryCodes": ["+91"] } }
```

**Response `200`:** `{ "success": true, "settings": { ...settings in force } }`

**Errors**

```json
{
  "success": false,
  "code": "INVALID_SETTINGS",
  "message": "Some settings are not valid.",
  "problems": ["tokens.accessTokenMinutes must not be greater than 60", "google.clientIds is required when Google is enabled"]
}
```

### DELETE /auth/admin/settings

No body. Discards all admin changes; the settings from code apply again. **Response `200`:** `{ "success": true, "settings": { ... } }`

---

## Security and operations

### GET /auth/admin/audit-log

| Query | Type |
|---|---|
| `userId` | uuid |
| `eventName` | string, e.g. `user.sign_in_failed` |
| `page`, `pageSize` | number |

**Response `200`**

```json
{
  "success": true,
  "entries": [
    {
      "id": "e1f2...",
      "userId": "5f0c...",
      "performedBy": null,
      "eventName": "user.sign_in_failed",
      "ipAddress": "203.0.113.10",
      "userAgent": "Mozilla/5.0 ...",
      "details": { "signInMethod": "password", "reason": "wrong_email_or_password" },
      "createdAt": "2026-10-20T06:29:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 50
}
```

### GET /auth/admin/stats

Numbers for an admin dashboard or monitoring. The last-24-hours counts come from the audit log, so they cover every server.

**Response `200`**

```json
{
  "success": true,
  "usersByStatus": { "PENDING_VERIFICATION": 0, "ACTIVE": 1, "SUSPENDED": 0, "DEACTIVATED": 0, "DELETED": 0 },
  "activeSessions": 1,
  "last24Hours": { "signIns": 1, "failedSignIns": 0, "newUsers": 1, "refreshTokenReuses": 0, "passwordResetsRequested": 0 },
  "pendingWebhookDeliveries": 0,
  "generatedAt": "2026-10-20T09:36:59.812Z"
}
```

Worth alerting on: a jump in `failedSignIns` (password guessing), any `refreshTokenReuses` (a token may have been stolen), and `pendingWebhookDeliveries` that keeps growing (a receiver is down).

### POST /auth/admin/maintenance/cleanup

No body. Runs the [data-retention cleanup](../configuration.md#data-retention) now (it also runs every hour on each server, even when you never call this). Works even when `retention.enabled` is false, so you can trigger it from your own scheduler instead.

**Response `200`:** rows removed per step.

```json
{
  "success": true,
  "removed": { "endedSessions": 12, "expiredRefreshTokens": 40, "linkTokens": 3, "oneTimeCodes": 25, "signInChallenges": 2, "organizationInvitations": 0, "webhookDeliveries": 130, "auditLog": 0 }
}
```

### POST /auth/admin/signing-keys/rotate

No body. New tokens are signed with a new key; tokens signed by the old key keep working until they expire. **Response `200`:** `{ "success": true }`

---

## API keys

### API key object

```json
{
  "id": "b7c8...",
  "name": "Partner: QuickBooks sync",
  "keyPreview": "ak_3Fx9Lm",
  "scopes": ["orders:read"],
  "organizationId": null,
  "createdByUserId": "5f0c...",
  "createdAt": "2026-10-20T06:30:00.000Z",
  "lastUsedAt": null,
  "expiresAt": "2027-06-30T00:00:00.000Z",
  "revokedAt": null
}
```

### GET /auth/admin/api-keys

**Response `200`:** `{ "success": true, "apiKeys": [ ...API key objects ] }` (the key itself is never returned again).

### POST /auth/admin/api-keys

**Request**

```json
{ "name": "Partner: QuickBooks sync", "scopes": ["orders:read", "invoices:write"], "organizationId": null, "expiresAt": "2027-06-30T00:00:00Z" }
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | up to 100 characters |
| `scopes` | string[] | yes | up to 50, like `orders:read` (lowercase) |
| `organizationId` | uuid | no | ties the key to one organization |
| `expiresAt` | ISO date string | no | |

**Response `201`.** `apiKey` is shown **only here**; store it in the calling server's secret manager:

```json
{
  "success": true,
  "apiKey": "ak_3Fx9LmQ2x4bWZkY2V0ZXN0dG9rZW5leGFtcGxlMTIzNDU",
  "details": { "id": "b7c8...", "name": "Partner: QuickBooks sync", "keyPreview": "ak_3Fx9Lm", "...": "API key object" }
}
```

### DELETE /auth/admin/api-keys/:apiKeyId

No body. Revokes immediately. **Response `200`:** `{ "success": true }`. Errors: `404 NOT_FOUND`.

---

## Webhooks

### Webhook object

```json
{
  "id": "d4e5...",
  "url": "https://hooks.myapp.com/auth",
  "eventNames": ["user.created", "user.deleted"],
  "isEnabled": true,
  "description": "CRM sync",
  "createdAt": "2026-10-20T06:30:00.000Z"
}
```

### GET /auth/admin/webhooks

**Response `200`:** `{ "success": true, "webhooks": [ ...webhook objects ] }`

### POST /auth/admin/webhooks

**Request**

```json
{ "url": "https://hooks.myapp.com/auth", "eventNames": ["user.created", "user.deleted"], "description": "CRM sync", "isEnabled": true }
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `url` | string | yes | public https URL, up to 2048 characters |
| `eventNames` | string[] | no | [event names](../events.md); empty = all events |
| `description` | string | no | up to 200 characters |
| `isEnabled` | boolean | no | default `true` |

**Response `201`.** `signingSecret` is shown **only here**:

```json
{ "success": true, "webhook": { "id": "d4e5...", "...": "webhook object" }, "signingSecret": "whsec_c2VjcmV0ZXhhbXBsZTEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI" }
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `UNSAFE_WEBHOOK_URL` | Not https, has credentials, private/loopback address, or doesn't resolve (`problem` says which) |
| 400 | `VALIDATION_ERROR` | Unknown event names, or more than 50 webhooks |

```json
{ "success": false, "code": "UNSAFE_WEBHOOK_URL", "message": "Webhook URLs must be public https addresses.", "problem": "URL points to a private network address" }
```

### PATCH /auth/admin/webhooks/:webhookId

Same fields as create, all optional. **Response `200`:** `{ "success": true, "webhook": { ... } }`

### DELETE /auth/admin/webhooks/:webhookId

**Response `200`:** `{ "success": true }`

### POST /auth/admin/webhooks/:webhookId/rotate-secret

No body. The old secret stops working at once. **Response `200`:** `{ "success": true, "signingSecret": "whsec_..." }`

### POST /auth/admin/webhooks/:webhookId/test

No body. Queues a `webhook.test` delivery. **Response `200`:** `{ "success": true }`

### GET /auth/admin/webhooks/:webhookId/deliveries

Paged, newest first.

**Response `200`**

```json
{
  "success": true,
  "deliveries": [
    {
      "id": "7d0b...",
      "webhookId": "d4e5...",
      "eventName": "user.created",
      "payload": { "name": "user.created", "userId": "5f0c...", "data": { "status": "ACTIVE" }, "occurredAt": "2026-10-20T06:30:00.000Z" },
      "status": "failed",
      "attemptCount": 8,
      "nextAttemptAt": "2026-10-23T06:30:00.000Z",
      "lastResponseStatus": 500,
      "lastError": "HTTP 500",
      "createdAt": "2026-10-20T06:30:00.000Z",
      "deliveredAt": null
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 50
}
```

`status` is `pending`, `delivered` or `failed`.

### POST /auth/admin/webhooks/:webhookId/deliveries/:deliveryId/retry

No body. Sends again right away. **Response `200`:** `{ "success": true }`

### What your webhook receives

```http
POST https://hooks.myapp.com/auth
Content-Type: application/json
User-Agent: techelusive-nest-auth-webhooks/1.0
X-Techelusive-Event: user.created
X-Techelusive-Delivery: 7d0b...
X-Techelusive-Signature: t=1792600000,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

```json
{ "id": "7d0b...", "name": "user.created", "userId": "5f0c...", "data": { "status": "ACTIVE" }, "occurredAt": "2026-10-20T06:30:00.000Z" }
```

Reply with any `2xx` within 10 seconds. To verify the signature, see [Admin, API keys and webhooks](../admin-api-keys-webhooks.md#verifying-the-signature-receiving-side).
