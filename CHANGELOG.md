# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Until 1.0, minor versions (0.x.0) may contain breaking changes. They will always be listed here with upgrade steps.

## [Unreleased]

## [0.2.0] - 2026-10-20

Production hardening.

### Added
- **Email change:** `POST /auth/email/change` (current password, or a sign-in from the last 10 minutes for accounts without one) sends a link to the new address; `POST /auth/email/change/confirm` switches it and notifies the old address. Events `user.email_change_requested` and `user.email_changed`.
- **Data retention:** an hourly cleanup removes ended sessions, used or expired codes, links, 2FA challenges and invitations, finished webhook deliveries and old audit entries. New `retention` settings, `DataRetentionService.runCleanup()` and `POST /auth/admin/maintenance/cleanup`.
- **Cookie mode for web apps:** `refreshTokenCookie` puts the refresh token in an HttpOnly, Secure, SameSite cookie for requests from the listed origins, with an Origin check on cookie refreshes. Mobile apps on the same API are unaffected.
- **Download my data:** `GET /auth/me/export` (profile, sign-in methods, linked accounts, passkeys, devices, organizations, security history; never secrets).
- **Operations:** `GET /auth/health` (PostgreSQL and Redis, 503 when down) and `GET /auth/admin/stats`.
- **CI:** every flow tested over HTTP against the playground (also in cookie mode), `npm audit`, CodeQL, Dependabot, and a release workflow that publishes to npm with provenance.

### Changed
- **Breaking:** `redisUrl` is required when `NODE_ENV=production`, unless `singleServer: true`.
- **Breaking:** two new email types for your `emailSender`: `confirm_email_change` (`token`) and `email_changed` (`newEmail`, masked).
- **Timings are now settings**, each with a safe range: `emailVerification.linkExpiresInHours`, `passwordReset.linkExpiresInMinutes`, `emailChange.linkExpiresInMinutes`, `magicLink.expiresInMinutes`, `emailOtp/phoneOtp.resendAfterSeconds`, `twoFactor.challengeExpiresInMinutes`, `organizations.invitationExpiresInDays`. Defaults are unchanged. Rate limits stay fixed in code.
- `POST /auth/refresh`: `refreshToken` is optional when it comes from the cookie.
- `rxjs` is now a peer dependency (every NestJS app already has it).
- Removed the error codes `ACCOUNT_DELETED` and `EMAIL_ALREADY_VERIFIED` (and `AUTH_ERRORS.accountDeleted` / `emailAlreadyVerified`): the API never returned them. Deleted accounts get `INVALID_CREDENTIALS` and already-verified emails get the normal answer, so neither reveals whether an account exists.

### Upgrade from 0.1.0
1. Run migrations: the new `EmailChangeAndRetention1792700000000` is included in `AUTH_MIGRATIONS` (adds the `change_email` link type and indexes for the cleanup). On very large tables, see the note in the migration about building the indexes `CONCURRENTLY` first.
2. Handle `confirm_email_change` and `email_changed` in your `emailSender`.
3. In production, set `redisUrl` (or `singleServer: true` for a single process).
4. The first cleanup runs a minute after start. If you must keep audit entries longer than a year, set `retention.auditLogDays` first.

## [0.1.0] - 2026-10-20

First release.

### Added
- **Sign-in methods:** email + password, email OTP, magic link, phone OTP (SMS), Google, Apple, Facebook, passkeys (WebAuthn).
- **Two-factor authentication:** authenticator apps (TOTP) plus backup codes, and an admin reset.
- **Sessions:**
  - one session per device
  - ES256 access tokens and a public JWKS endpoint
  - rotating single-use refresh tokens with reuse detection
  - signing-key rotation
- **Account life cycle:** verification-based activation, suspend, deactivate / reactivate, and deletion with personal data wiped.
- **Roles and admin API:** user search and management, runtime settings, audit log.
- **Organizations:** owner / admin / member roles, email invitations, and the active organization carried in tokens.
- **Server access and integrations:**
  - API keys with scopes
  - signed webhooks with retries and SSRF protection
  - an `onEvent` hook
- **Security:**
  - Argon2id password hashing
  - breached-password check
  - rate limits (Redis or memory, failing closed)
  - AWS KMS envelope encryption
  - protection against account enumeration, account pre-hijacking and social account takeover
- **Ready-made senders:** MSG91 for SMS, and a console email sender for development.
- `@CurrentUserId()` decorator, and exported named constants (`ROUTES`, `SIGN_IN_STATUS`, `ACCOUNT_STATUS`, `SIGN_IN_METHOD`...) so clients never type raw strings.
- `encryption.legacyLocalKey` for moving an existing database from the development key to AWS KMS.
- Full request/response documentation for every endpoint (`docs/endpoints/`).
- A test that fails the build when a hardcoded value appears outside `src/constants.ts`.
