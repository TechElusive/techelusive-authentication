# Manual testing (before publishing)

The **playground** runs the library on your machine with every feature switched on. Emails and SMS never leave your computer: they land in a dev inbox you can see. Three ways to drive it:

| Tool | Best for | Where |
|---|---|---|
| **Dev dashboard** | Watching what happens: emails, SMS codes, live auth events, received webhooks. Also passkeys and Google sign-in, which need a browser | http://localhost:3000/dev |
| **Postman** | Running every flow step by step: tokens, codes and links are captured automatically | import `api/techelusive-authentication.postman_collection.json` |
| **Swagger UI** | Browsing and trying every endpoint in the browser | http://localhost:3000/docs |

## 1. Start the playground

You need Node.js 22+ and Docker Desktop.

```bash
cd techelusive-authentication
npm install                 # once
npm run playground:db       # starts PostgreSQL (and Redis) in Docker
npm run playground          # builds and starts the API on http://localhost:3000
```

You should see:

```
[Playground] Dev dashboard:  http://localhost:3000/dev
[Playground] Swagger UI:     http://localhost:3000/docs
[Playground] Postman:        import api/techelusive-authentication.postman_collection.json
```

The database and its tables are created automatically on start. If a PostgreSQL already installed on your Mac (Homebrew, Postgres.app) is using port 5432, the playground uses that one instead of Docker's, which is fine. To use Docker's anyway, stop the local one first (`brew services stop postgresql@16`).

To start from an empty database:

```bash
docker compose -f playground/docker-compose.yml down -v && npm run playground:db
```

Optional settings: copy `playground/.env.example` to `playground/.env` and uncomment what you need (or set them in the shell). Restart the playground after changing it.

| Variable | Effect |
|---|---|
| `GOOGLE_CLIENT_ID` | Turns on Google sign-in and shows the Google button on the dashboard. Create a "Web application" OAuth client in Google Cloud Console with `http://localhost:3000` as an authorized JavaScript origin |
| `APPLE_CLIENT_ID`, `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` | Turn on Apple / Facebook (tokens must then be pasted into Postman's `socialToken`) |
| `CHECK_BREACHED_PASSWORDS=true` | Turns on the data-breach password check, which is off in the playground so any password meeting the rules works. Apps using the library have it on by default |
| `REDIS_URL=redis://localhost:6379` | Rate limits counted in Redis instead of memory |
| `DATABASE_URL` | A different database (default `postgres://postgres:postgres@localhost:5432/techelusive_playground`) |

### Real emails, real SMS and Google sign-in (optional)

Every message always appears on the dashboard. To also receive them for real, add these to `playground/.env` and restart:

**Email (Resend, free):** sign up at resend.com → API Keys → create one → `RESEND_API_KEY=re_...`. Until you verify your own domain, Resend only delivers to the email address you signed up with, so test with that address. Links in the emails open the dashboard and show the token to paste into Postman.

**SMS (MSG91):** `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` and `MSG91_CODE_VARIABLE` (the variable in your template, e.g. `otp`). Indian numbers need a DLT-approved template, so SMS is usually the last thing to set up; until then, use the codes on the dashboard.

If a real send fails, the terminal shows a warning and the flow carries on: the code is still on the dashboard.

**Google with the OAuth 2.0 Playground** (developers.google.com/oauthplayground):

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → **Web application**.
   - Authorized JavaScript origins: `http://localhost:3000` (for the dashboard button)
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
2. Put the client ID in `playground/.env` as `GOOGLE_CLIENT_ID=...` and restart the playground.
3. In the OAuth Playground, click the gear icon → tick **Use your own OAuth credentials** → paste your client ID and secret. Without this the token is issued for Google's own client and the library rejects it (`INVALID_SOCIAL_TOKEN`), which is correct.
4. Step 1: in "Input your own scopes" enter `openid email profile` → **Authorize APIs** → sign in.
5. Step 2: **Exchange authorization code for tokens** → copy the `id_token` value (not the access token).
6. Postman → folder 5 → **Sign in with provider**, with `provider` = `google` (`POST /auth/social/google`): set `socialToken` to the id_token and send. A new user is created and signed in, or an existing user with the same verified email is linked.

ID tokens expire after an hour; repeat step 5 for a fresh one. The **Sign in with Google** button on the dashboard does the same thing in one click.

## 2. Use Postman

1. Postman → **Import** → choose `api/techelusive-authentication.postman_collection.json`.
2. Open the collection's **Variables** tab to see `email`, `password`, `secondEmail` and `phoneNumber`. Change them if you like.
3. Run requests **top to bottom within a folder**. The scripts do the copying for you:
   - sign-in responses save `accessToken`, `refreshToken`, `sessionId`, `userId`, and `challengeToken` when 2FA is on,
   - "(from inbox)" requests read the latest code or link token from the dev inbox before sending,
   - 2FA requests compute the current authenticator code from the saved `totpSecret`,
   - ids (`organizationId`, `webhookId`, `apiKeyId`...) are saved when created.
4. Open **View → Show Postman Console** to see what was saved and the `code` of any error.

Protected requests use the collection's Bearer token `{{accessToken}}`. Public ones are set to "No auth".

## 3. Use Swagger

Open http://localhost:3000/docs → pick an endpoint → **Try it out** → **Execute**. After any sign-in (Login, verify code, refresh...) Swagger authorizes itself with the returned access token, so protected endpoints work right away. Codes and link tokens are on the dev dashboard.

## 4. Test checklist

Work through these in order; each line says what you should see. Folder names refer to Postman.

### Email + password (folder 1)

| # | Do | Expect |
|---|---|---|
| 1 | Register | `201`, `status: "verification_required"`, `pendingVerifications: ["email"]`; a `verify_email` message in the inbox; event `user.created` |
| 2 | Register again with the same email | Exactly the same response; no second account (no enumeration) |
| 3 | Login before verifying | `403 ACCOUNT_NOT_VERIFIED` with `pendingVerifications: ["email"]` |
| 4 | Login with a wrong password, then with an unknown email | `401 INVALID_CREDENTIALS` both times, same message |
| 5 | Verify email (token from inbox) | `status: "ACTIVE"`; event `user.email_verified`, `user.activated` |
| 6 | Verify email again with the same token | `400 INVALID_TOKEN` (links work once) |
| 7 | Login | `status: "signed_in"`; tokens saved; event `user.signed_in`. On the dashboard, the claims show `roles: ["user"]`, `amr: ["password"]` |
| 8 | Register with a short password (edit the body: `"password": "short"`) | `400 INVALID_PASSWORD`, `requirements: ["at least 10 characters"]` |
| 9 | Admin > Change settings `{ "password": { "rejectBreachedPasswords": true } }` (or start with `CHECK_BREACHED_PASSWORDS=true`), then Register with `"password": "password1234"` | `400 INVALID_PASSWORD` with the data-breach message (needs internet) |
| 10 | Register with an extra field such as `"roles": ["admin"]` | `400 VALIDATION_ERROR`, "property roles should not exist" |
| 11 | Forgot password, then Reset password (token from inbox) | Success; you are signed out everywhere; `user.password_changed`. Then Login with `{{newPassword}}`, and set `password` = `newPassword` in the variables |
| 12 | Change password | Success; other devices signed out, this one still works; a `password_changed` notice in the inbox |
| 13 | Login with a wrong password 11 times | Eventually `429 TOO_MANY_REQUESTS` with `retryAfterSeconds` |

### Passwordless (folder 2)

| # | Do | Expect |
|---|---|---|
| 14 | Send email code → Send it again immediately | Second time `429 TOO_MANY_REQUESTS` (`retryAfterSeconds: 60`) |
| 15 | Verify email code but remove `firstName` from the body | `400 VALIDATION_ERROR` with `missingSignUpDetails`; then send with the names, using the **same** code → signed in (the code was not used up) |
| 16 | Verify email code with a wrong code | `400 INVALID_OTP` with `attemptsLeft` |
| 17 | Send magic link → Verify magic link | Signed in; the link fails on a second use |
| 18 | Send phone code → Verify phone code | The SMS appears in the inbox (`sms_code`); signed in as a new phone-only user |
| 19 | Send phone code to `+15555550100` after setting `phoneOtp.allowedCountryCodes: ["+91"]` via Admin > Change settings | `400 PHONE_COUNTRY_NOT_ALLOWED` |

### Account and sessions (folder 3)

| # | Do | Expect |
|---|---|---|
| 20 | Get my profile, Update my profile | Profile shows the new name and `metadata` |
| 21 | My devices | Several sessions; the current one has `isCurrentDevice: true` |
| 22 | Refresh tokens → run it **again** with the old refresh token (Postman saved the new one, so paste the old value) | First succeeds; second `401 INVALID_TOKEN`, the session is ended, and event `session.refresh_token_reused` |
| 23 | Logout, then Get my profile | `401 INVALID_TOKEN` on `/auth/me` (it checks the session live) |
| 24 | Deactivate → Login → Reactivate | Login gives `403 ACCOUNT_DEACTIVATED` (reactivationToken saved automatically); Reactivate signs you in |
| 25 | Delete my account → Login | Login `401 INVALID_CREDENTIALS`; event `user.deleted`. (Do this last, or use a second user) |

### Two-factor (folder 4)

| # | Do | Expect |
|---|---|---|
| 26 | Start 2FA setup | `secret` and `authenticatorAppUrl` (scan the URL as a QR code in Google/Microsoft Authenticator to try a real app) |
| 27 | Enable 2FA | 10 backup codes; other devices signed out |
| 28 | Login | `status: "two_factor_required"` with `challengeToken` |
| 29 | Verify 2FA sign-in | `signed_in`; claims show `amr: ["password", "two_factor"]` |
| 30 | Verify 2FA sign-in again with the same code in the same 30 seconds | `401 INVALID_OTP` (codes can't be replayed) |
| 31 | Login, then Verify 2FA sign-in with `{{backupCode}}` as the code | Signed in; the same backup code fails next time |
| 32 | Disable 2FA | Login no longer asks for a code |

### Passkeys (dashboard)

| # | Do | Expect |
|---|---|---|
| 33 | Sign in on the dashboard → **Add a passkey** | The browser asks for Touch ID / Windows Hello / phone; "Passkey added"; event `user.passkey_added` |
| 34 | Logout → **Sign in with a passkey** | Signed in without email or password; no 2FA step even if 2FA is on |
| 35 | Postman: List my passkeys → Remove passkey | Removed. If it's the only sign-in method left: `409 LAST_SIGN_IN_METHOD` |

### Social (dashboard / folder 5)

| # | Do | Expect |
|---|---|---|
| 36 | With `GOOGLE_CLIENT_ID` set: the Google button on the dashboard | Signed in; a new user is created, or an existing user with the same verified email is linked (`user.social_account_linked`) |
| 37 | Send `{"token": "garbage"}` to Sign in with provider | `401 INVALID_SOCIAL_TOKEN` |

### Organizations (folder 7)

| # | Do | Expect |
|---|---|---|
| 38 | Create organization → create it again | Second time `409 ORGANIZATION_SLUG_TAKEN` |
| 39 | Invite member | An `organization_invitation` message for `{{secondEmail}}` |
| 40 | Sign in as `{{secondEmail}}` (folder 2, email code) → Accept invitation | Joined as `member` |
| 41 | Switch active organization | The new access token has `org_id` and `org_role: "member"` (see the claims on the dashboard, or decode at jwt.io) |
| 42 | As the member: Update organization | `403 FORBIDDEN` |
| 43 | As the owner (Login as `{{email}}`): Remove member with your own id while you are the only owner | `409 LAST_OWNER` |

### Admin, API keys and webhooks (folder 8)

| # | Do | Expect |
|---|---|---|
| 44 | Search users before being admin | `403 FORBIDDEN` |
| 45 | Folder 10: Make me admin (or the dashboard button) → folder 3: Refresh tokens | Claims now include `admin`; Search users works |
| 46 | Search users → copy the second user's `id` into the `userId` variable → Suspend user → that user signs in (folder 2) | `403 ACCOUNT_SUSPENDED`; their sessions are ended. Unsuspend user afterwards, and set `userId` back to yours |
| 47 | Change settings `{ "magicLink": { "enabled": false } }` → Send magic link | `403 SIGN_IN_METHOD_DISABLED`, no restart needed |
| 48 | Change settings `{ "tokens": { "accessTokenMinutes": 999 } }` | `400 INVALID_SETTINGS` with a `problems` list |
| 49 | Create webhook (to the playground receiver) → Login | The dashboard's "Webhooks received" shows `user.signed_in` with **signature valid** |
| 50 | Create webhook with `"url": "https://169.254.169.254/x"` | `400 UNSAFE_WEBHOOK_URL` |
| 51 | Create API key → folder 10: Call an app route with the API key → Revoke API key → call it again | Key returned once; the call succeeds (`calledBy` shows the key); after revoking `401 INVALID_API_KEY` |
| 52 | Audit log | Every action above, newest first, with IP and user agent |
| 53 | Rotate signing key → Get my profile with the old access token | Still works; JWKS now lists two keys |
| 54 | Stats | Users by status, active sessions, last-24-hours sign-ins and failures |
| 55 | Run data cleanup now | `removed` counts per step (mostly 0 on a fresh database: rows must be older than the `retention` settings) |

### Email change, data export, health (folder 3)

| # | Do | Expect |
|---|---|---|
| 56 | Change my email with a wrong `currentPassword` | `401 INVALID_CREDENTIALS` |
| 57 | Change my email (to `{{changedEmail}}`) | Same success message whatever the address; a `confirm_email_change` message to the new address |
| 58 | Change my email to `{{secondEmail}}` (an existing account) | The same success message, but no message arrives (no enumeration) |
| 59 | Confirm email change (token from inbox) → run it again | First: `user.email` is the new address, verified; the old address gets `email_changed`. Second: `400 INVALID_TOKEN`. Then set the `email` variable to `{{changedEmail}}` |
| 60 | Sign in with a phone code (folder 2) → Change my email without `currentPassword` | Works right after signing in; more than 10 minutes later `403 RECENT_SIGN_IN_REQUIRED` |
| 61 | Download my data | Profile, devices, organizations, security history; no hashes, secrets or tokens |
| 62 | Health check | `200`, `"database": "ok"` (stop PostgreSQL to see `503`) |

### Web cookie mode

Start with `REFRESH_TOKEN_COOKIE_ORIGINS=http://localhost:3000 npm run playground`, then run `npm run check:cookies` in another terminal. It checks the cookie flags, refresh with the cookie, cross-site refusal, rotation, mobile clients on the same API and logout. Postman doesn't send an `Origin` header, so in Postman everything behaves like a mobile app.

When everything matches, record the version and date in `CHANGELOG.md` and publish.

## Automated checks (run these too)

```bash
npm run typecheck && npm test && npm run build
createdb -h localhost -U postgres auth_e2e   # once: an empty database for e2e
DATABASE_URL=postgres://postgres:postgres@localhost:5432/auth_e2e npm run e2e
npm run playground                                                                   # in a second terminal
DATABASE_URL=postgres://postgres:postgres@localhost:5432/techelusive_playground npm run check:http
```

`npm run e2e` creates and drops its own tables, so point it at an empty database (not the playground's). `npm run check:http` runs every flow over HTTP against the running playground (38 checks); start the playground on an empty database for it (`dropdb techelusive_playground`), since it registers fixed test users. CI runs all of these on every change.
