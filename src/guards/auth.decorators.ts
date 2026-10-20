import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { CALLER_REQUEST_PROPERTY, METADATA_KEY } from '@/constants';
import { AccessTokenClaims } from '@/features/sessions/session.types';

/**
 * Who is calling the route. Exactly one of the two fields is set:
 * - `user`: a person signed in with an access token.
 * - `apiKey`: another server calling with an API key.
 */
export interface AuthenticatedCaller {
  user?: AccessTokenClaims;
  apiKey?: { id: string; name: string; scopes: string[]; organizationId: string | null };
}

/**
 * Anyone may call this route or controller, signed in or not.
 *
 * @returns A route or controller decorator.
 */
export const Public = () => SetMetadata(METADATA_KEY.publicRoute, true);

/**
 * Only users with at least one of these roles may call the route.
 *
 * @param roleNames - The roles that are allowed.
 * @returns A route or controller decorator.
 * @example
 * @Roles('seller', 'admin')
 */
export const Roles = (...roleNames: string[]) => SetMetadata(METADATA_KEY.requiredRoles, roleNames);

/**
 * Only admins may call the route. Which roles count as "admin" comes from the settings
 * (admin.adminRoles), so it can be changed at runtime. Also checks that the session is still active.
 *
 * @returns A route or controller decorator.
 */
export const AdminOnly = () => applyDecorators(SetMetadata(METADATA_KEY.adminOnly, true), CheckSession());

/**
 * Before running the route, confirm in the database that the session has not been signed out
 * and the account is still ACTIVE. Use it on sensitive routes (payments, changing email, admin work).
 * Without it, a signed-out token keeps working until it expires (a few minutes).
 *
 * @returns A route or controller decorator.
 */
export const CheckSession = () => SetMetadata(METADATA_KEY.checkSessionInDatabase, true);

/**
 * Lets servers call the route with an API key that has ALL of these scopes.
 * Signed-in users may still call it as normal.
 *
 * @param scopes - The scopes the key must have.
 * @returns A route or controller decorator.
 * @example
 * @ApiKeyScopes('rides:read')
 */
export const ApiKeyScopes = (...scopes: string[]) => SetMetadata(METADATA_KEY.apiKeyScopes, scopes);

/**
 * Controller parameter: the signed-in user's token claims.
 *   @Get('profile') getProfile(@CurrentUser() user: AccessTokenClaims) { ... }
 *   @Get('id') getId(@CurrentUser('sub') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (claimName: keyof AccessTokenClaims | undefined, executionContext: ExecutionContext) => {
    const caller: AuthenticatedCaller | undefined = executionContext.switchToHttp().getRequest()[CALLER_REQUEST_PROPERTY];
    const user = caller?.user;
    return claimName ? user?.[claimName] : user;
  },
);

/** Controller parameter: the signed-in user's id (the token's "sub" claim). */
export const CurrentUserId = createParamDecorator((_unused: unknown, executionContext: ExecutionContext): string | undefined => {
  const caller: AuthenticatedCaller | undefined = executionContext.switchToHttp().getRequest()[CALLER_REQUEST_PROPERTY];
  return caller?.user?.sub;
});

/** Controller parameter: the full caller (user or API key). Useful on routes that accept both. */
export const CurrentCaller = createParamDecorator(
  (_unused: unknown, executionContext: ExecutionContext): AuthenticatedCaller | undefined =>
    executionContext.switchToHttp().getRequest()[CALLER_REQUEST_PROPERTY],
);
