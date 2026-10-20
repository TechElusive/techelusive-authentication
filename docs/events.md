# Events

Every important action produces an event. Each event goes to three places, in this order:

1. **The audit log** (`auth_audit_logs`, visible at `GET /auth/admin/audit-log`)
2. **Your `onEvent` handler** (in-process)
3. **Webhooks** subscribed to it (delivered in the background)

A failure in any of these is logged and **never** breaks the action that caused the event.

```ts
AuthModule.forRoot({
  useFactory: (profiles: ProfilesService) => ({
    // ...
    onEvent: async (event) => {
      if (event.name === 'user.created') await profiles.createEmptyProfile(event.userId!);
      if (event.name === 'user.deleted') await profiles.deleteEverythingFor(event.userId!);
    },
  }),
  inject: [ProfilesService],
});
```

`onEvent` runs inside the request, so keep it quick. Hand slow work to a queue.

## Event shape

```ts
interface AuthEvent {
  name: AuthEventName;          // e.g. "user.created"
  userId: string | null;        // the user it is about
  data: Record<string, unknown>;// details; never passwords, tokens or codes
  occurredAt: string;           // ISO time
}
```

## All events

| Event | When | `data` |
|---|---|---|
| `user.created` | New account (any method) | `status` |
| `user.activated` | `PENDING_VERIFICATION` → `ACTIVE` | |
| `user.updated` | Profile changed | `changedFields` |
| `user.email_verified` | Email verified | |
| `user.email_change_requested` | `POST /auth/email/change` accepted (also when the address was taken, so it can't be told apart) | `newEmail` (masked) |
| `user.email_changed` | Email change confirmed | `previousEmail`, `newEmail` (both masked) |
| `user.phone_verified` | Phone verified | |
| `user.onboarding_completed` | Your app called `completeOnboarding` | |
| `user.roles_changed` | Admin changed roles | `previousRoles`, `roles` |
| `user.signed_in` | Successful sign-in | `signInMethod`, `usedTwoFactor`, `sessionId`, `isNewDevice` |
| `user.sign_in_failed` | Wrong password/code, blocked account | `signInMethod`, `reason` |
| `user.signed_out` | Sign-out (one device or all) | `sessionId` or `everywhere`, `endedSessions` |
| `user.password_changed` | Change, reset, first set, or removal of an unverified password | `how` |
| `user.password_reset_requested` | Reset email sent | |
| `user.two_factor_enabled` / `user.two_factor_disabled` | 2FA turned on / off (also admin reset) | `resetByAdmin?` |
| `user.passkey_added` / `user.passkey_removed` | | `passkeyId` |
| `user.social_account_linked` / `user.social_account_unlinked` | | `provider` |
| `user.suspended` | Admin suspended | `reason` |
| `user.deactivated` / `user.reactivated` | User paused / resumed (or admin lifted a suspension) | |
| `user.deleted` | Account deleted | |
| `session.revoked` | A session ended | `sessionId`, `reason` |
| `session.refresh_token_reused` | **Security:** a used refresh token came back; the session was ended | `sessionId` |
| `organization.created` / `organization.updated` / `organization.deleted` | | `organizationId` |
| `organization.member_added` / `organization.member_removed` | | `organizationId`, `role?` |
| `organization.member_role_changed` | | `organizationId`, `previousRole`, `role` |
| `organization.invitation_sent` | | `organizationId`, `role` |
| `api_key.created` / `api_key.revoked` | | `apiKeyId`, `name?`, `scopes?` |
| `settings.changed` | Admin changed or reset settings | `changedSections` or `reset` |

The event names are exported as `AUTH_EVENTS`:

```ts
import { AUTH_EVENTS } from '@techelusive/nest-auth';
if (event.name === AUTH_EVENTS.refreshTokenReused) alertSecurityTeam(event);
```

## Recording your own audit entries

```ts
constructor(private readonly authEvents: AuthEventsService) {}

await this.authEvents.record({ name: AUTH_EVENTS.userUpdated, userId, request, details: { changedFields: ['payoutAccount'] } });
```
