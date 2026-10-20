# Protecting routes

`AuthModule` installs `AuthGuard` for the whole app, so **every route requires a signed-in user unless you say otherwise**. Forgetting a decorator therefore fails closed, never open.

## Decorators

```ts
import { Public, Roles, CheckSession, ApiKeyScopes, AdminOnly, CurrentUser, CurrentUserId, CurrentCaller, AccessTokenClaims } from '@techelusive/nest-auth';

@Controller('orders')
export class OrdersController {
  @Get('menu')
  @Public()                                   // anyone; @CurrentUser() still works if a token is sent
  getMenu() {}

  @Get('mine')                                 // any signed-in user (default)
  listMine(@CurrentUser() user: AccessTokenClaims) {}

  @Post()
  @Roles('seller', 'admin')                    // at least one of these roles
  create(@CurrentUserId() userId: string) {}

  @Post(':id/refund')
  @CheckSession()                              // also check the session is still active right now
  refund() {}

  @Get('export')
  @ApiKeyScopes('orders:read')                 // servers with an API key holding this scope (users still allowed)
  export(@CurrentCaller() caller) {}            // caller.user or caller.apiKey

  @Delete(':id')
  @AdminOnly()                                 // roles in settings.admin.adminRoles, checked live
  remove() {}
}
```

Decorators work on methods and on whole controllers. A method decorator wins over its controller's.

## What's in the token

`@CurrentUser()` returns the access-token claims:

| Claim | Example | Meaning |
|---|---|---|
| `sub` | `"5f0c..."` | User id. Use it as the foreign key in your tables. |
| `sid` | `"8c1e..."` | Session (device) id |
| `roles` | `["user"]` | App-wide roles |
| `amr` | `["password", "two_factor"]` | How the user signed in. Require `two_factor` for very sensitive actions if you like. |
| `org_id`, `org_role` | `"a1b2..."`, `"admin"` | The organization chosen on this device, if any ([Organizations](organizations.md)) |
| `iss`, `aud` | `"https://api.myapp.com"` | Your issuer |
| `iat`, `exp`, `jti` | | Issued at, expiry, unique id |

`@CurrentUserId()` returns just the user id (`sub`).

## How fresh is the token?

An access token is valid until it expires (`tokens.accessTokenMinutes`, 15 by default). Within that window, a user who signed out, was suspended or lost a role still holds a working token. Two ways to close the gap:

- **`@CheckSession()`** on sensitive routes checks in the database that the session is still active and the user is `ACTIVE`. The answer is cached for 5 seconds per server, which costs at most one small query per user every 5 seconds. `@AdminOnly()` always does this.
- **Shorter access tokens.** For example `tokens.accessTokenMinutes: 5`, at the cost of more refreshes.

Role changes appear in the user's **next** access token (at the next refresh).

## Opt-in instead of protect-all

```ts
AuthModule.forRoot({ protectAllRoutes: false, useFactory: ... })

@UseGuards(AuthGuard)       // then protect controllers explicitly
@Controller('orders')
export class OrdersController {}
```

## Verifying tokens in other services

Access tokens are standard JWTs signed with ES256. Any service in any language can verify them using the public keys at `GET https://api.myapp.com/.well-known/jwks.json`, with no shared secret.

Node.js with [`jose`](https://github.com/panva/jose):

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const keys = createRemoteJWKSet(new URL('https://api.myapp.com/.well-known/jwks.json'));

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: 'https://api.myapp.com',
    audience: 'https://api.myapp.com',
    algorithms: ['ES256'],
    typ: 'at+jwt',
  });
  return payload; // payload.sub, payload.roles, ...
}
```

Python with [PyJWT](https://pyjwt.readthedocs.io):

```python
import jwt
jwks = jwt.PyJWKClient("https://api.myapp.com/.well-known/jwks.json")

def verify_access_token(token: str) -> dict:
    key = jwks.get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["ES256"],
                      issuer="https://api.myapp.com", audience="https://api.myapp.com")
```

Always pin the algorithm (`ES256`) and check `iss` and `aud`. These other services can't see sign-outs before expiry. If they need that, have them call an endpoint on the main API that is marked `@CheckSession()`.

## API keys (server to server)

Other servers (partners, cron jobs, internal services) call your API with a key instead of a user token:

```http
GET /orders/export
x-api-key: ak_3Fx9...
```

- An admin creates keys with `POST /auth/admin/api-keys` ([details](admin-api-keys-webhooks.md#api-keys)).
- Keys only work on routes marked `@ApiKeyScopes(...)`, and only if they hold **all** the listed scopes. On any other route, an API key is not accepted.
- In the route, `@CurrentCaller()` returns `{ apiKey: { id, name, scopes, organizationId } }`.

## Using the services from your own code

The module is global, so inject its services anywhere:

```ts
@Injectable()
export class ProfileService {
  constructor(private readonly users: UsersService) {}

  async finishOnboarding(userId: string, request: RequestContext) {
    await this.users.completeOnboarding(userId, request);
  }
}
```

| Service | Useful methods |
|---|---|
| `UsersService` | `findUserById`, `findUserByEmail`, `completeOnboarding`, `updateProfile`, `setRoles`, `suspendUser`, `deleteUser`, `toPublicProfile` |
| `SessionService` | `listActiveSessions`, `revokeSession`, `revokeAllSessions`, `verifyAccessToken` |
| `OrganizationsService` | `listMyOrganizations`, `listMembers`, `createOrganization` |
| `SettingsService` | `getSettings()`, the settings in force right now |
| `AuthEventsService` | `record()`, to write your own entries to the audit log |
| `ApiKeysService`, `WebhooksService`, `TwoFactorService`, `SigningKeysService` | Same operations as the admin API |

Use `@CurrentRequest()` in controllers to get the `RequestContext` (IP and user agent). Use `SYSTEM_REQUEST` in scripts and jobs.
