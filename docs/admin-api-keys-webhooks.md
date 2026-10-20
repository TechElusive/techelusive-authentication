# Admin, API keys and webhooks

Everything under `/auth/admin` needs a user holding one of `settings.admin.adminRoles` (default `["admin"]`). The session is checked live, so a removed admin loses access at once.

## The first admin

No one is an admin after installation. Make the first one from a one-off script or a database console:

```ts
// scripts/make-admin.ts
const users = app.get(UsersService);
const user = await users.findUserByEmail('founder@myapp.com');
await users.setRoles(user!.id, [...user!.roles, 'admin'], user!.id, SYSTEM_REQUEST);
```

```sql
-- or directly in SQL
UPDATE auth_users SET roles = array_append(roles, 'admin') WHERE email = 'founder@myapp.com';
```

The role appears in the user's next access token, so sign in again or wait for a refresh. From then on, admins manage roles through `PUT /auth/admin/users/:id/roles`.

## Managing users

| Task | Request |
|---|---|
| Find users | `GET /auth/admin/users?search=asha&status=ACTIVE&role=seller&page=1&pageSize=50` (search matches email, phone and names; deleted users are hidden unless `status=DELETED`) |
| See one user | `GET /auth/admin/users/:id` returns profile, suspension reason, consent times, sign-in methods and active devices |
| Change roles | `PUT /auth/admin/users/:id/roles { "roles": ["user", "seller"] }` (replaces the list) |
| Suspend | `POST /auth/admin/users/:id/suspend { "reason": "Chargeback fraud, ticket 4411" }` signs them out everywhere |
| Lift suspension | `POST /auth/admin/users/:id/unsuspend` |
| Verify email by hand | `POST /auth/admin/users/:id/verify-email` |
| Reset 2FA | `POST /auth/admin/users/:id/reset-2fa`, only after confirming identity through support |
| Sign out everywhere | `POST /auth/admin/users/:id/logout-all` |
| Delete | `DELETE /auth/admin/users/:id` wipes personal data, permanently |

Every admin action is written to the audit log with `performedBy: "admin:<adminUserId>"`.

## Audit log

```http
GET /auth/admin/audit-log?userId=5f0c...&eventName=user.sign_in_failed&page=1
```

Entries: `eventName`, `userId`, `performedBy`, `ipAddress`, `userAgent`, `details`, `createdAt`. The log never contains passwords, tokens or codes. It records sign-ins, failures (with a reason), password changes, 2FA changes, admin actions, settings changes and refresh-token reuse. See [Events](events.md) for the list.

The table grows forever. Prune it on a schedule that matches your retention policy, for example:

```sql
DELETE FROM auth_audit_logs WHERE created_at < now() - interval '1 year';
```

## Runtime settings

```http
GET    /auth/admin/settings                                     → settings in force
PATCH  /auth/admin/settings  { "emailOtp": { "enabled": true } } → change some
DELETE /auth/admin/settings                                     → back to the code settings
```

See [Configuration](configuration.md#settings) for every setting and its limits.

## Signing keys

Access tokens are signed with an ES256 key that the library creates on first start, encrypts and stores. To rotate (every few months, or immediately if you suspect a leak):

```http
POST /auth/admin/signing-keys/rotate
```

New tokens use the new key right away. The old public key stays in `/.well-known/jwks.json` for 2 days, so tokens it signed keep working until they expire. Every server picks up the change within a minute.

## API keys

API keys let other servers call routes marked `@ApiKeyScopes(...)`.

```http
POST /auth/admin/api-keys
{ "name": "Partner: QuickBooks sync", "scopes": ["orders:read", "invoices:write"], "expiresAt": "2027-06-30T00:00:00Z" }
→ { "apiKey": "ak_3Fx9...", "details": { "id": "...", "keyPreview": "ak_3Fx9Lm", ... } }
```

- **Shown once:** `apiKey` appears only in this response. Store it in the calling server's secret manager. Only its hash is kept.
- **Scopes:** lowercase, like `orders:read`, `invoices:write` or `admin`. Define your own vocabulary.
- **`organizationId`** (optional) ties the key to one organization.
- **Listing and revoking:** `GET /auth/admin/api-keys` lists keys (never the secret). `DELETE /auth/admin/api-keys/:id` revokes immediately.
- **Usage:** `lastUsedAt` shows recent use (updated at most once a minute).

## Webhooks

Webhooks send auth [events](events.md) to other systems as HTTP POSTs: your CRM, analytics, a Slack bot, a separate service.

### Register

```http
POST /auth/admin/webhooks
{ "url": "https://hooks.myapp.com/auth", "eventNames": ["user.created", "user.deleted"], "description": "CRM sync" }
→ { "webhook": { "id": "..." }, "signingSecret": "whsec_..." }
```

- **`eventNames`:** an empty list means every event.
- **`signingSecret`:** shown once. `POST .../rotate-secret` issues a new one, and the old one stops working immediately.
- **URL rules:** the URL must be **public https**. Addresses on private networks, loopback, link-local (including cloud metadata `169.254.169.254`) and similar are refused, both when saving and before every delivery. In development, `http://localhost` is allowed.

### Delivery

```http
POST https://hooks.myapp.com/auth
Content-Type: application/json
X-Techelusive-Event: user.created
X-Techelusive-Delivery: 7d0b...
X-Techelusive-Signature: t=1792600000,v1=5257a869e7ec...

{ "id": "7d0b...", "name": "user.created", "userId": "5f0c...", "data": { "status": "ACTIVE" }, "occurredAt": "2026-10-20T05:00:00.000Z" }
```

- **Success:** reply with any 2xx status within 10 seconds. Redirects are not followed.
- **Retries:** other answers and timeouts are retried after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h. After that the delivery is marked `failed`.
- **Duplicates:** deliveries can arrive more than once (e.g. after a timeout), so use the `id` / `X-Techelusive-Delivery` value to ignore duplicates.
- **Order:** not guaranteed. Use `occurredAt` if order matters.

### Verifying the signature (receiving side)

```ts
import express from 'express';
import { verifyWebhookSignature } from '@techelusive/nest-auth';

app.post('/auth', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');               // the exact bytes received
  const isGenuine = verifyWebhookSignature(process.env.WEBHOOK_SECRET!, rawBody, req.header('X-Techelusive-Signature'));
  if (!isGenuine) return res.status(400).end();
  const event = JSON.parse(rawBody);
  // ... handle event ...
  res.status(204).end();
});
```

The check rejects bodies that were changed, the wrong secret, and deliveries older than 5 minutes (replays). In another language, compute `HMAC-SHA256(secret, "<t>.<rawBody>")` in hex, compare it with `v1` in constant time, and check that `t` is recent.

### Debugging

| Request | Purpose |
|---|---|
| `POST /auth/admin/webhooks/:id/test` | Queue a `webhook.test` delivery |
| `GET /auth/admin/webhooks/:id/deliveries` | Recent deliveries with `status`, `attemptCount`, `lastResponseStatus`, `lastError` |
| `POST /auth/admin/webhooks/:id/deliveries/:deliveryId/retry` | Send again now |
| `PATCH /auth/admin/webhooks/:id { "isEnabled": false }` | Pause |
