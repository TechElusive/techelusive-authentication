# Documentation

@techelusive/nest-auth is a NestJS module that gives any backend a complete, secure authentication system: sign-up, sign-in (eight methods), two-factor, sessions, roles, organizations, API keys, webhooks and an admin API. It stores everything in **your app's own PostgreSQL database**, and your apps build their own UI on top of its JSON API.

## Start here

| If you want to... | Read |
|---|---|
| Add auth to a NestJS app in 15 minutes | [Getting started](getting-started.md) |
| See every option and setting | [Configuration](configuration.md) |
| Build the sign-up / sign-in screens | [Sign-in flows](sign-in-flows.md) and [Client integration](client-integration.md) |
| See every endpoint's exact request and response JSON | [Endpoints](endpoints/README.md) |
| Look up an endpoint at a glance | [API reference](api-reference.md) |
| Handle an error code | [Error codes](error-codes.md) |
| Protect your own routes | [Protecting routes](protecting-routes.md) |
| Add teams / workspaces | [Organizations](organizations.md) |
| Manage users, API keys and webhooks | [Admin, API keys and webhooks](admin-api-keys-webhooks.md) |
| React to sign-ups and other events | [Events](events.md) |
| Test every flow by hand (Postman, Swagger, dashboard) | [Manual testing](manual-testing.md) |
| Learn how the code works, flow by flow (for contributors) | [Code walkthrough](code-walkthrough.md) |
| Go live | [Production checklist](production-checklist.md) |
| Understand the security design | [Security](security.md) |
| Understand the internals or contribute | [Architecture](architecture.md) |

## Concepts in one minute

- **User.** One row per person. Has an email and/or phone number, roles (e.g. `user`, `admin`) and a status (`PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED`, `DELETED`).
- **Session.** One per signed-in device. Signing out ends the session.
- **Access token.** A short-lived signed JWT (15 minutes by default) sent as `Authorization: Bearer ...` on every request. Any service can verify it with the public keys at `/.well-known/jwks.json`.
- **Refresh token.** A long-lived single-use token (`rt_...`). It gets a new access token when the old one expires. Reusing an old one ends the session, because reuse means it was stolen.
- **Settings.** Which features are on and how they behave. Defaults ship with the library, your code overrides them, and an admin can override both at runtime without a deploy.
- **Events.** Every important action (sign-up, password change...) is written to the audit log. It is also passed to your `onEvent` handler and sent to any webhooks.

## Requirements

- Node.js 22+
- NestJS 11 with the Express platform
- TypeORM 0.3 and PostgreSQL 13+
- Optional: Redis (recommended with more than one server), AWS KMS (recommended in production)
