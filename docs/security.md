# Security design

This page explains how the library protects users, so you can review it, explain it to auditors, and avoid undoing a protection by accident. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Secrets at rest

| Secret | How it is stored |
|---|---|
| Passwords | Argon2id (64 MiB, 3 iterations), re-hashed automatically if the parameters are raised |
| Refresh, link, challenge and API-key tokens | SHA-256 hash only (they are 256-bit random, so a fast hash is safe) |
| Email/SMS codes and backup codes | Salted SHA-256, with attempt limits |
| Token-signing private key, 2FA secrets, webhook secrets | Encrypted with AWS KMS (or AES-256-GCM with a local key in development), bound to their row so a value copied elsewhere won't decrypt |

A full database leak therefore exposes no usable password, token, code or key.

## Tokens

- **Access tokens:** ES256 JWTs. Verification **pins the algorithm** (no `alg: none`, no algorithm confusion) and checks the `typ` (`at+jwt`), issuer, audience and expiry, with 30 seconds of clock tolerance.
- **Refresh tokens:** opaque, single use and rotated on every refresh. Marking a token used is a single atomic `UPDATE`, so two parallel refreshes can't both succeed. A reused token **ends the session** and records `session.refresh_token_reused`.
- **Lifetimes:** refresh tokens never outlive their session (`sessionDays`).
- **Web apps (cookie mode):** the refresh token lives in an `HttpOnly; Secure; SameSite=Strict` cookie that page scripts can't read, and a refresh using the cookie must carry an allowed `Origin` header, so other sites can't trigger it (CSRF).
- **Email change:** needs the current password (or a sign-in from the last 10 minutes for accounts without one), is confirmed by a link to the new address, and notifies the old address. A stolen access token alone can't take over the account by changing its email.
- **Data minimization:** old sessions, codes, links and audit entries are deleted on a schedule (`retention` settings), and users can export what is stored about them.
- **Key rotation:** keys rotate without downtime. Old public keys stay published for 2 days.

## Attacks considered

| Attack | Defense |
|---|---|
| Password guessing | Rate limits per IP and per account; Argon2id; breached-password check (k-anonymity, the password never leaves the server) |
| Credential stuffing | The same limits, plus `user.sign_in_failed` events for alerting; 2FA; passkeys |
| Account enumeration | Send/forgot/register answer the same for known and unknown accounts; unknown-email sign-in still runs a full Argon2 check so timing matches; account status errors appear only after the user proved who they are; non-members get `NOT_FOUND` for organizations |
| Code guessing | 5 attempts per code; 1 code per minute and 5 per hour per destination; codes expire in 10 minutes |
| Token replay | Single-use links, codes, challenges and refresh tokens, each consumed atomically |
| TOTP replay | The last accepted time step is stored, so a code can't be used twice |
| Account pre-hijacking | If an account's email is still unverified after 24 hours, the owner proving it later (code, link or verified social email) removes any password set before and ends all sessions |
| Social account takeover | A provider email is trusted only if the provider marks it verified. Facebook emails are never trusted for linking |
| Stolen social token reuse | Tokens must be issued to **your** client ids / app id; optional nonce binding |
| Mass assignment | Unknown body fields are rejected; roles and status can't be set by users |
| SSRF via webhooks | https only; DNS resolved and private, loopback, link-local and metadata ranges blocked when saving and before every send; redirects not followed |
| Webhook spoofing / replay | HMAC-SHA256 signature with timestamp; 5-minute window |
| Clickjacking / XSS | Not applicable to a JSON API. Protect your web pages with CSP and `frame-ancestors` |
| Brute force on admin | Admin routes check the session live; all admin actions are audited |
| Leaked API key | Keys are hashed, scoped, revocable and optionally expiring; `lastUsedAt` shows use |

## Rate limiting

Limits are counted in Redis when `redisUrl` is set (shared by all servers), otherwise in each server's memory. If Redis is configured but unreachable, limited requests are **refused** (fail closed) rather than allowed. Limits are keyed by `request.ip`, so set `trust proxy` correctly ([Production checklist](production-checklist.md)). If you don't, every user shares the load balancer's IP and its limits.

## What the library does not do

- **No CAPTCHA.** Add one in front of sign-up and send-code endpoints if bots target you (e.g. Cloudflare Turnstile, verified in a guard or middleware).
- **No HTTP security headers.** Use `helmet` in your app.
- **No geo-blocking or IP reputation.** Use your edge provider.
- **No forced 2FA.** It is the user's choice. To require it, check `amr` contains `two_factor` on the routes that need it.

## Data protection

- **Deletion:** account deletion wipes personal data and every way to sign in, while keeping the row for referential integrity. The audit log keeps IP addresses and user agents. Prune it to match your retention policy.
- **Consent:** acceptance times of the terms and privacy policy are stored (`termsAcceptedAt`, `privacyPolicyAcceptedAt`).
- **Data export:** for data-access requests, export with `GET /auth/admin/users/:id` plus your own data.
