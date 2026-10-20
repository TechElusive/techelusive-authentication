# Production checklist

Go through this list before launch. Each item says **why**, so you can make an informed exception.

## Configuration

- [ ] **`NODE_ENV=production`.** At startup, this refuses a local encryption key, a non-https issuer, and a missing `redisUrl` (unless `singleServer: true`). `ConsoleEmailSender` throws on its first send.
- [ ] **`issuer` is your real https API URL.** It is written into every token. Changing it later signs everyone out, because existing tokens fail the issuer check.
- [ ] **Encryption uses AWS KMS** (`{ awsKmsKeyId, awsRegion }`).
  - Create a symmetric KMS key and give the API's IAM role only `kms:Encrypt` and `kms:Decrypt` on it.
  - Turn on automatic key rotation in KMS.
  - **Moving an existing database from the local key to KMS:** configure `{ awsKmsKeyId, awsRegion, legacyLocalKey: '<old localKey>' }`. Older values (2FA secrets, webhook secrets, the signing key) still decrypt, and everything new is encrypted with KMS. Then rotate the signing key (`POST /auth/admin/signing-keys/rotate`) so the active key is KMS-protected. Without `legacyLocalKey`, users with 2FA would be locked out.
- [ ] **A real `emailSender`** (SES, Resend, Postmark...) with SPF, DKIM and DMARC set up for your sending domain, so codes don't land in spam.
- [ ] **SMS:** a DLT-registered template on MSG91 (India), and `phoneOtp.allowedCountryCodes` limited to the countries you serve. This limits "SMS pumping" fraud costs.
- [ ] **Secrets come from a secret manager** (AWS Secrets Manager / SSM): database URL, KMS key id, MSG91 key, Facebook app secret.
- [ ] **Settings reviewed:** sign-in methods, `defaultRoles`, `adminRoles`, token lifetimes, `allowedEmailDomains`.

## Infrastructure

- [ ] **`app.set('trust proxy', 1)`**, or the exact number of proxies in front of the app.
  - **Too low:** every user shares the load balancer's IP, so rate limits hit everyone at once.
  - **Too high:** attackers can fake their IP with an `X-Forwarded-For` header and dodge rate limits.
- [ ] **Redis (`redisUrl`)**. Required in production: without it each server counts rate limits separately, which multiplies the allowed attempts. Use a managed Redis (ElastiCache) with TLS (`rediss://`). Only a deployment with exactly one server process may set `singleServer: true` instead.
- [ ] **Health check:** point the load balancer / uptime monitor at `GET /auth/health` (503 when PostgreSQL or Redis don't answer).
- [ ] **TLS everywhere:** HTTPS at the load balancer with HSTS, and TLS to Postgres and Redis.
- [ ] **CORS** allows only your web app origins (with `credentials: true` if you use cookie mode). Mobile apps don't need CORS.
- [ ] **Web apps use cookie mode** (`refreshTokenCookie`), so the refresh token is out of reach of page scripts. See [Client integration](client-integration.md#web-apps-refresh-token-in-a-cookie).
- [ ] **`helmet()`** for security headers on any web pages you serve.
- [ ] **Request body size limit** (Express's default 100 kB is fine; don't raise it for auth routes).

## Database

- [ ] **Migrations run in your deploy pipeline** (`typeorm migration:run`), never `synchronize`.
- [ ] **Backups** are encrypted, with point-in-time recovery turned on, and restores are tested.
- [ ] **Least-privilege database user:** the app needs only read/write on its tables, not superuser.
- [ ] **Data retention reviewed.** Old sessions, codes, links, webhook deliveries and audit entries are deleted every hour automatically. Check that `retention.auditLogDays` (default 365) matches your legal requirements. See [Data retention](configuration.md#data-retention).

## Monitoring and response

- [ ] **Alerts on events** (via `onEvent` or a webhook to your alerting):
  - `session.refresh_token_reused`: possible token theft.
  - Spikes of `user.sign_in_failed`: credential stuffing.
  - Spikes of `TOO_MANY_REQUESTS` responses.
- [ ] **Logs:** forward server logs. Unexpected errors are logged with stack traces, while clients only see `INTERNAL_SERVER_ERROR`.
- [ ] **Failed webhooks:** watch `GET /auth/admin/webhooks/:id/deliveries` for `failed` deliveries.
- [ ] **Dashboard numbers:** `GET /auth/admin/stats` gives accounts by status, active sessions and the last 24 hours of sign-ins, failures and refresh-token reuses.
- [ ] **Incident runbook:**
  - **Leaked signing key:** `POST /auth/admin/signing-keys/rotate`, then rotate again two days later.
  - **Compromised account:** suspend it, then `POST /auth/admin/users/:id/logout-all`.
  - **Leaked API key:** `DELETE /auth/admin/api-keys/:id`.
  - **Leaked webhook secret:** `POST .../rotate-secret`.
- [ ] **First admin** created, using a strong password plus 2FA or a passkey.

## Client apps

- [ ] Refresh tokens are stored securely and **only one refresh runs at a time** ([Client integration](client-integration.md#refreshing-tokens)).
- [ ] Email link pages act on a button press, not on page load (security scanners open links). This includes the `confirm_email_change` page.
- [ ] A "download my data" button calls `GET /auth/me/export` (and adds your app's own data).
- [ ] Google, Apple and Facebook client ids for **every** platform are in the settings.
- [ ] For passkeys, `apple-app-site-association` and `assetlinks.json` are published, and `passkeys.allowedOrigins` lists every web origin and Android app hash.
