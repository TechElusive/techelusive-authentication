# Organizations

Organizations let users work in teams: companies, workspaces, fleets, households. A user can belong to many organizations, with a different role in each. Turn them on with `organizations.enabled: true`.

## Roles

| Role | Can |
|---|---|
| `owner` | Everything, including deleting the organization and managing other owners |
| `admin` | Rename the organization, invite people, change roles of members and admins, remove members and admins |
| `member` | See the organization and its members |

Rules the API enforces:

- **Creators:** whoever creates an organization becomes its owner.
- **Owners:** only an owner can make someone an owner, demote an owner, or remove an owner.
- **Last owner:** an organization always keeps at least one owner (`LAST_OWNER`).
- **Leaving:** anyone can leave by removing themselves.
- **Outsiders:** non-members get `NOT_FOUND`, not `FORBIDDEN`, so they can't discover which organizations exist.

These organization roles are separate from app-wide roles (`user.roles`, e.g. `admin`), which are managed by app admins.

## Invitations

```http
POST /auth/organizations/:id/invitations
{ "email": "ravi@example.com", "role": "member" }
```

The library asks your `emailSender` to send an `organization_invitation` email with a `token`. Link it to a page in your app. Once the invited person has signed in, the page calls:

```http
POST /auth/organizations/invitations/accept
{ "token": "oi_..." }
```

- **Security:** the signed-in user's **verified email must match** the invited email, so a forwarded link is useless to anyone else.
- **Lifetime:** invitations expire after `organizations.invitationExpiresInDays` (7 days by default).
- **Replacement:** sending a new invitation to the same email cancels the old one.
- **Cancelling:** an admin can cancel an invitation with `DELETE .../invitations/:invitationId`.

## The active organization

A device works in one organization at a time:

```http
POST /auth/organizations/switch
{ "organizationId": "a1b2..." }
→ { "accessToken": "eyJ...", "expiresIn": 900, "organizationId": "a1b2..." }
```

Replace the stored access token with the returned one. From then on, every token for this device (including after refresh) carries:

```json
{ "org_id": "a1b2...", "org_role": "admin" }
```

Send `{ "organizationId": null }` to leave organization mode.

## Scoping your own data

Store `organization_id` on your own rows and filter by the claim:

```ts
@Get('vehicles')
listVehicles(@CurrentUser() user: AccessTokenClaims) {
  if (!user.org_id) throw new AuthError(AUTH_ERRORS.forbidden);
  return this.vehicles.find({ where: { organizationId: user.org_id } });
}

@Delete('vehicles/:id')
removeVehicle(@CurrentUser() user: AccessTokenClaims) {
  if (user.org_role !== ORGANIZATION_ROLE.owner && user.org_role !== ORGANIZATION_ROLE.admin) throw new AuthError(AUTH_ERRORS.forbidden);
  // ...
}
```

When a member is removed, their devices leave the organization at the next token refresh. For immediate effect on sensitive routes, add `@CheckSession()` and re-check membership with `OrganizationsService.listMembers()` or your own query.

## API keys for an organization

An API key created with an `organizationId` acts on behalf of that organization. In routes marked `@ApiKeyScopes()`, read it from `@CurrentCaller().apiKey.organizationId`.

## Deleting

`DELETE /auth/organizations/:id` (owners only) removes the organization, its memberships, invitations and API keys. Delete your own organization data in an `onEvent` handler for `organization.deleted`.
