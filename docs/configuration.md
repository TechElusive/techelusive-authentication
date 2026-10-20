# Configuration

Configuration has two parts:

- **Options** (`AuthOptions`): wiring and secrets, such as the database, URLs, keys and senders. They are set in code at startup and checked then; a mistake stops the app with a clear message.
- **Settings** (`AuthSettings`): behavior, such as which sign-in methods are on, token lifetimes and roles. You set defaults in code, and admins can change them at runtime.

## Options

```ts
AuthModule.forRoot({
  imports: [],            // modules your factory needs (e.g. ConfigModule)
  inject: [],             // providers passed to useFactory
  protectAllRoutes: true, // install AuthGuard app-wide (default true)
  useFactory: (...injected) => ({ /* AuthOptions */ }),
})
```

| Option | Required | Description |
|---|---|---|
| `dataSource` | yes | Your TypeORM `DataSource`, already initialized, including `AUTH_ENTITIES`. |
| `issuer` | yes | Your API's public URL, e.g. `https://api.myapp.com`. Written into every token as `iss` and `aud`. Must be https in production. |
| `encryption` | yes | `{ awsKmsKeyId, awsRegion, legacyLocalKey? }` in production, or `{ localKey }` (32 random bytes in base64) in development. `legacyLocalKey` is only for [moving an existing database to KMS](production-checklist.md#configuration). |
| `emailSender` | yes | Object with `send(email: AuthEmail): Promise<void>`. See [below](#email-sender). |
| `smsSender` | for phone OTP | Object with `sendCode(phoneNumber, code)`. `Msg91SmsSender` is included. |
| `facebookAppSecret` | for Facebook | Your Facebook app secret. Google and Apple need no secret. |
| `passkeys` | for passkeys | `{ relyingPartyId: 'myapp.com', relyingPartyName: 'MyApp', allowedOrigins: ['https://myapp.com'] }` |
| `appName` | no | Shown in authenticator apps next to the 2FA code. Default `Techelusive`. |
| `settings` | no | Your defaults for behavior (see below). |
| `redisUrl` | in production | Shares rate limits between servers. Required when `NODE_ENV=production` (the app refuses to start without it), because without it each server counts separately and an attacker gets a full set of attempts per server. |
| `singleServer` | no | `true` lets production run without Redis. Only when exactly one server process runs; counters then live in its memory and reset on restart. |
| `refreshTokenCookie` | for web apps | `{ allowedOrigins: ['https://app.myapp.com'], name?, domain?, path?, sameSite? }`. Web requests get the refresh token in an HttpOnly cookie instead of the body. See [Client integration](client-integration.md#web-apps-refresh-token-in-a-cookie). |
| `onEvent` | no | `(event) => void \| Promise<void>`, called for every [event](events.md). |

### Email sender

The library never builds email HTML. It hands you the data, and you render your own templates with your own provider (SES, Resend, Postmark, SMTP...).

```ts
import { AuthEmail, EmailSender } from '@techelusive/nest-auth';

export class SesEmailSender implements EmailSender {
  async send(email: AuthEmail): Promise<void> {
    switch (email.type) {
      case 'verify_email':
        return sendTemplate(email.to, 'verify-email', { link: `https://myapp.com/verify-email?token=${email.token}` });
      case 'reset_password':
        return sendTemplate(email.to, 'reset-password', { link: `https://myapp.com/reset-password?token=${email.token}` });
      case 'magic_sign_in':
        return sendTemplate(email.to, 'magic-link', { link: `https://myapp.com/magic?token=${email.token}` });
      case 'sign_in_code':
        return sendTemplate(email.to, 'sign-in-code', { code: email.code });
      case 'organization_invitation':
        return sendTemplate(email.to, 'invitation', {
          link: `https://myapp.com/join?token=${email.token}`,
          organizationName: email.organizationName,
          invitedByName: email.invitedByName,
        });
      case 'password_changed':
        return sendTemplate(email.to, 'password-changed', {});
      case 'new_sign_in':
        return sendTemplate(email.to, 'new-sign-in', { ipAddress: email.ipAddress, device: email.userAgent });
      case 'confirm_email_change':
        return sendTemplate(email.to, 'confirm-email-change', { link: `https://myapp.com/confirm-email?token=${email.token}` });
      case 'email_changed':
        return sendTemplate(email.to, 'email-changed', { newEmail: email.newEmail });
    }
  }
}
```

| `type` | Extra fields | When |
|---|---|---|
| `verify_email` | `token` | Registration, or `POST /auth/email/send-verification` |
| `reset_password` | `token` | `POST /auth/password/forgot` |
| `magic_sign_in` | `token` | `POST /auth/magic-link/send` |
| `sign_in_code` | `code` | `POST /auth/email/send-otp` |
| `organization_invitation` | `token`, `organizationName`, `invitedByName` | Organization admin invites someone |
| `password_changed` | none | Password changed or reset (if `password.notifyOnChange`) |
| `new_sign_in` | `ipAddress`, `userAgent` | Sign-in from a new device (if `security.notifyOnNewSignIn`) |
| `confirm_email_change` | `token` | `POST /auth/email/change`; sent to the **new** address. Your link page calls `POST /auth/email/change/confirm` |
| `email_changed` | `newEmail` (masked, e.g. `a***@mail.com`) | The change was confirmed; sent to the **old** address. Tell the user how to contact support if it wasn't them |

If `send` throws for a code or link the user is waiting for, the request fails with `INTERNAL_SERVER_ERROR`, so the user knows to try again. Failures of notice emails (`password_changed`, `new_sign_in`, `email_changed`) are only logged.

### SMS sender

```ts
import { Msg91SmsSender } from '@techelusive/nest-auth';

smsSender: new Msg91SmsSender({
  authKey: process.env.MSG91_AUTH_KEY!,
  templateId: process.env.MSG91_TEMPLATE_ID!, // DLT-approved template, e.g. "Your MyApp code is ##otp##"
  codeVariableName: 'otp',                    // the variable used in your template (default "otp")
}),
```

For any other provider (Twilio, AWS SNS, Vonage...), implement the interface:

```ts
const twilioSender: SmsSender = {
  async sendCode(phoneNumber, code) {
    await twilio.messages.create({ to: phoneNumber, from: TWILIO_NUMBER, body: `Your MyApp code is ${code}` });
  },
};
```

Phone numbers are always passed in E.164 form (`+919876543210`).

## Settings

Settings are built in three layers: **defaults**, overridden by **your code**, overridden by **admin changes**. Admin changes are stored in the `auth_settings` table and reach every server within 10 seconds.

```ts
settings: {
  emailOtp: { enabled: true, expiresInMinutes: 5, resendAfterSeconds: 30 },
  google: { enabled: true, clientIds: ['1234-abc.apps.googleusercontent.com'] },
  tokens: { accessTokenMinutes: 10, sessionDays: 30 },
  magicLink: { enabled: true, expiresInMinutes: 30 },
}
```

```http
PATCH /auth/admin/settings
{ "phoneOtp": { "enabled": true, "allowedCountryCodes": ["+91"] } }
```

Every change is validated, both field by field and in combination. For example, the API won't let you turn off every sign-in method or turn on Google without a client id. Invalid changes return `INVALID_SETTINGS` with a `problems` list. If a later code release makes a stored admin change invalid, the library falls back to the code settings instead of breaking sign-in.

### Reference

| Setting | Default | Notes |
|---|---|---|
| **registration** | | |
| `enabled` | `true` | Allow new accounts with any method. |
| `defaultRoles` | `["user"]` | Roles every new user gets. Users can never pick their own role. |
| `requireFirstAndLastName` | `true` | |
| `requirePhoneNumber` | `false` | Email + password sign-up must include a phone number. |
| `requireTermsAcceptance` | `true` | Sign-up must send `acceptTerms: true`. The time is stored. |
| `requirePrivacyPolicyAcceptance` | `true` | Sign-up must send `acceptPrivacyPolicy: true`. |
| `allowedEmailDomains` | `[]` | e.g. `["mycompany.com"]` for internal tools. Empty means any domain. |
| **activation** | | Which verifications move `PENDING_VERIFICATION` to `ACTIVE`. |
| `requireVerifiedEmail` | `true` | |
| `requireVerifiedPhone` | `false` | |
| **password** | | |
| `enabled` | `true` | |
| `minimumLength` | `10` | 8–128. |
| `requireUppercaseLetter` / `requireLowercaseLetter` / `requireNumber` / `requireSymbol` | `false` | Length plus the breach check is stronger than character rules (NIST 800-63B). |
| `rejectBreachedPasswords` | `true` | Uses haveibeenpwned.com k-anonymity; the password never leaves your server. |
| `notifyOnChange` | `true` | Sends a `password_changed` email. |
| **emailVerification** | | |
| `linkExpiresInHours` | `24` | 1–72. How long the "verify your email" link works. |
| **passwordReset** | | |
| `linkExpiresInMinutes` | `60` | 10–180. How long the reset link works. |
| **emailChange** | | |
| `linkExpiresInMinutes` | `60` | 10–240. How long the link confirming a new email works. |
| **emailOtp** | | |
| `enabled` | `false` | |
| `codeLength` | `6` | 6–8. |
| `expiresInMinutes` | `10` | 1–15. |
| `resendAfterSeconds` | `60` | 30–300. Wait before another code can go to the same email. |
| `allowSignUp` | `true` | An unknown email gets a new account. |
| **magicLink** | | |
| `enabled` | `false` | |
| `expiresInMinutes` | `15` | 5–60. How long the sign-in link works. |
| `allowSignUp` | `true` | |
| **phoneOtp** | | Needs `smsSender`. |
| `enabled` | `false` | |
| `codeLength` / `expiresInMinutes` / `resendAfterSeconds` / `allowSignUp` | `6` / `10` / `60` / `true` | Same ranges as `emailOtp`. |
| `allowedCountryCodes` | `[]` | e.g. `["+91"]`. Empty means any country. Limiting countries cuts SMS fraud costs. |
| **google** / **apple** | | |
| `enabled` | `false` | |
| `clientIds` | `[]` | Google: your OAuth client ids (web, Android, iOS). Apple: bundle id and/or Services id. |
| **facebook** | | Needs `facebookAppSecret`. |
| `enabled` / `appId` | `false` / `""` | |
| **passkeys** | | Needs `passkeys` option. |
| `enabled` | `false` | |
| **twoFactor** | | |
| `enabled` | `true` | Users *may* turn on 2FA. It is never forced. |
| `challengeExpiresInMinutes` | `5` | 2–15. Time to enter the 2FA code after the password (or code) was right. |
| **organizations** | | |
| `enabled` | `false` | |
| `allowUsersToCreate` | `true` | Otherwise only app admins can create organizations. |
| `invitationExpiresInDays` | `7` | 1–30. How long an emailed invitation can be accepted. |
| **tokens** | | |
| `accessTokenMinutes` | `15` | 5–60. |
| `refreshTokenDays` | `30` | 1–90; can't exceed `sessionDays`. |
| `sessionDays` | `90` | 1–365. Hard limit: the user must sign in again after this. |
| **admin** | | |
| `adminRoles` | `["admin"]` | Roles allowed to use `/auth/admin/*`. |
| **security** | | |
| `notifyOnNewSignIn` | `false` | Email the user when a new device signs in. |
| **retention** | | See [Data retention](#data-retention). |
| `enabled` | `true` | The hourly automatic cleanup. |
| `expiredRecordDays` | `7` | 1–90. Ended sessions; used or expired links, codes, 2FA challenges and invitations. |
| `webhookDeliveryDays` | `30` | 1–365. Delivered or failed webhook deliveries. |
| `auditLogDays` | `365` | 0–3650. `0` keeps the audit log forever. |

### Data retention

Without cleanup, tables such as sessions, codes and the audit log grow forever. Every server runs a cleanup once an hour (first run a minute after start) that deletes, in batches of 5,000 rows:

| Rows | Deleted after |
|---|---|
| Sessions that ended (signed out, expired, revoked) and their refresh tokens | `expiredRecordDays` after they ended |
| Expired refresh tokens of sessions still in use | `expiredRecordDays` after they expired |
| Used or expired email links, one-time codes and 2FA challenges | `expiredRecordDays` |
| Accepted, cancelled or expired organization invitations | `expiredRecordDays` |
| Delivered or failed webhook deliveries (pending ones are never removed) | `webhookDeliveryDays` |
| Audit log entries | `auditLogDays` (`0` = never) |

Users, organizations, passkeys, API keys and other live data are never touched. Several servers running the cleanup at once is harmless. To run it on your own schedule instead, set `retention.enabled: false` and call `DataRetentionService.runCleanup()` (or `POST /auth/admin/maintenance/cleanup`).

Pick `auditLogDays` with your legal team: security logs are often kept for 1 year, but some industries require longer.

### Constants (not runtime settings)

Rate limits, attempt limits, Argon2 parameters and other security constants live in [`src/constants.ts`](../src/constants.ts). They are deliberately not settings, so they can't be weakened at runtime. (Timings such as link and code lifetimes *are* settings, listed above, each with a safe range.) Notable values:

| What | Value |
|---|---|
| Sign-in attempts | 30 per IP and 10 per account per 15 minutes |
| Sign-ups | 10 per IP per hour |
| Codes sent | 10 per IP and 5 per phone/email per hour (plus `resendAfterSeconds` between codes) |
| Emailed links | 10 per IP and 3 per email per hour |
| Wrong code attempts | 5 per code; 5 per 2FA challenge |
| Passkey prompt | must finish within 5 minutes |
| Reactivation | 10 minutes to confirm after proving who you are |
| "Recent sign-in" for email change without a password | 10 minutes |
