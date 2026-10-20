# Organizations

Needs `organizations.enabled`; otherwise `403 FEATURE_DISABLED`. Every route needs a signed-in user, and roles (`owner`, `admin`, `member`) are checked per organization. If you're not a member, the organization's routes return `404 NOT_FOUND`. Concepts are explained in [Organizations](../organizations.md).

## Organization object

```json
{
  "id": "a1b2c3d4-0000-4000-8000-000000000001",
  "name": "Acme Travels",
  "slug": "acme-travels",
  "metadata": {},
  "createdByUserId": "5f0c8a2e-1d3b-4c5a-9e7f-0a1b2c3d4e5f",
  "createdAt": "2026-10-20T06:30:00.000Z",
  "updatedAt": "2026-10-20T06:30:00.000Z"
}
```

---

## GET /auth/organizations

The organizations the user belongs to.

**Response `200`**

```json
{
  "success": true,
  "organizations": [
    { "id": "a1b2...", "name": "Acme Travels", "slug": "acme-travels", "metadata": {}, "role": "owner", "joinedAt": "2026-10-20T06:30:00.000Z" }
  ]
}
```

## POST /auth/organizations

Creates an organization; the caller becomes its owner. Session checked live. When `organizations.allowUsersToCreate` is off, only app admins can create.

**Request**

```json
{ "name": "Acme Travels", "slug": "acme-travels" }
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | up to 100 characters |
| `slug` | string | yes | 3–50 lowercase letters, digits and dashes; can't start or end with a dash |

**Response `201`:** `{ "success": true, "organization": { ...organization object } }`

**Errors:** `409 ORGANIZATION_SLUG_TAKEN`, `403 FORBIDDEN` (users may not create), `400 VALIDATION_ERROR` (`problems: ["too many organizations"]`, 100 per user).

## POST /auth/organizations/switch

Picks the organization this device works in. **Replace the stored access token** with the returned one; refreshes keep the organization. Session checked live.

**Request**

```json
{ "organizationId": "a1b2c3d4-0000-4000-8000-000000000001" }
```

Send `{ "organizationId": null }` to leave organization mode.

**Response `200`**

```json
{ "success": true, "accessToken": "eyJhbGciOiJFUzI1NiIs...", "expiresIn": 900, "organizationId": "a1b2c3d4-0000-4000-8000-000000000001" }
```

The new token carries `"org_id"` and `"org_role"`.

## POST /auth/organizations/invitations/accept

Accepts an emailed invitation. The signed-in user's **verified** email must match the invited email. Session checked live.

**Request**

```json
{ "token": "oi_aW52aXRhdGlvbmV4YW1wbGV0b2tlbjEyMzQ1Njc4OTAxMjM" }
```

**Response `200`**

```json
{ "success": true, "organizationId": "a1b2c3d4-0000-4000-8000-000000000001", "role": "member" }
```

**Errors:** `400 INVALID_TOKEN` (unknown, used, expired (`organizations.invitationExpiresInDays`, 7 by default), cancelled, or a different / unverified email), `409 ALREADY_MEMBER`.

---

## GET /auth/organizations/:organizationId

Any member. **Response `200`:** `{ "success": true, "organization": { ...organization object, "myRole": "admin" } }`

## PATCH /auth/organizations/:organizationId

Admin or owner. Session checked live.

**Request** (all optional):

```json
{ "name": "Acme Travels India", "slug": "acme-india", "metadata": { "gstNumber": "29ABCDE1234F1Z5" } }
```

**Response `200`:** `{ "success": true, "organization": { ... } }`. Errors: `409 ORGANIZATION_SLUG_TAKEN`, `403 FORBIDDEN`.

## DELETE /auth/organizations/:organizationId

Owner only. Removes members, invitations and the organization's API keys. Session checked live. **Response `200`:** `{ "success": true }`

---

## GET /auth/organizations/:organizationId/members

Any member.

**Response `200`**

```json
{
  "success": true,
  "members": [
    { "userId": "5f0c...", "email": "asha@example.com", "firstName": "Asha", "lastName": "Rao", "role": "owner", "joinedAt": "2026-10-20T06:30:00.000Z" },
    { "userId": "9d2e...", "email": "ravi@example.com", "firstName": "Ravi", "lastName": "Kumar", "role": "member", "joinedAt": "2026-10-21T09:00:00.000Z" }
  ]
}
```

## PATCH /auth/organizations/:organizationId/members/:memberUserId

Changes a member's role. Admins manage members and admins; **only owners** can make or unmake owners. Session checked live.

**Request**

```json
{ "role": "admin" }
```

`role` is one of `"owner"`, `"admin"`, `"member"`.

**Response `200`:** `{ "success": true }`. Errors: `403 FORBIDDEN`, `404 NOT_FOUND`, `409 LAST_OWNER`.

## DELETE /auth/organizations/:organizationId/members/:memberUserId

Removes a member. Use your own user id to **leave**. Session checked live. **Response `200`:** `{ "success": true }`. Errors: `403 FORBIDDEN`, `404 NOT_FOUND`, `409 LAST_OWNER`.

---

## GET /auth/organizations/:organizationId/invitations

Admin or owner. Open (not accepted, not cancelled) invitations.

**Response `200`**

```json
{
  "success": true,
  "invitations": [
    {
      "id": "c3d4...",
      "organizationId": "a1b2...",
      "email": "ravi@example.com",
      "role": "member",
      "invitedByUserId": "5f0c...",
      "expiresAt": "2026-10-27T06:30:00.000Z",
      "acceptedAt": null,
      "revokedAt": null,
      "createdAt": "2026-10-20T06:30:00.000Z"
    }
  ]
}
```

## POST /auth/organizations/:organizationId/invitations

Admin or owner (inviting an `owner` needs an owner). Sends an `organization_invitation` email; a new invitation to the same email replaces the old one. Session checked live.

**Request**

```json
{ "email": "ravi@example.com", "role": "member" }
```

**Response `201`:** `{ "success": true }`. Errors: `400 INVALID_EMAIL`, `403 FORBIDDEN`.

## DELETE /auth/organizations/:organizationId/invitations/:invitationId

Admin or owner. Cancels an open invitation. Session checked live. **Response `200`:** `{ "success": true }`. Errors: `404 NOT_FOUND`.
