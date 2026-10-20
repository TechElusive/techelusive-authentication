import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthError } from '@/common/auth-error';
import {
  API_KEY_HEADER,
  AUTH_ERRORS,
  BEARER_TOKEN_PATTERN,
  CALLER_REQUEST_PROPERTY,
  HTTP_CONTEXT_TYPE,
  HTTP_HEADER,
  METADATA_KEY,
} from '@/constants';
import { ApiKeysService } from '@/features/api-keys/api-keys.service';
import { SessionService } from '@/features/sessions/session.service';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthenticatedCaller } from './auth.decorators';

/**
 * Runs before every route (when installed as the app-wide guard) and decides who may call it.
 *
 * Checks, in this order:
 * - @Public() routes let everyone in (a token is still read if sent, so @CurrentUser() works
 *   on public routes too).
 * - An "x-api-key" header on a route marked @ApiKeyScopes(): the key and its scopes are checked.
 * - Otherwise an "Authorization: Bearer <access token>" header is required.
 * - @CheckSession() / @AdminOnly(): the database confirms the session is still active.
 * - @Roles() / @AdminOnly(): the user needs one of the roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeysService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Decides whether the request may reach the route (see the class comment for the order of checks).
   * On success, the caller is attached to the request for @CurrentUser() and friends.
   *
   * @param executionContext - Nest's view of the current request.
   * @returns True when the request may continue.
   * @throws AuthError UNAUTHORIZED when no access token was sent.
   * @throws AuthError INVALID_TOKEN when the token is bad, or the session has ended (on checked routes).
   * @throws AuthError INVALID_API_KEY or FORBIDDEN for a bad API key or a missing scope.
   * @throws AuthError FORBIDDEN when the user lacks a required role.
   */
  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    if (executionContext.getType() !== HTTP_CONTEXT_TYPE) return true;
    const request = executionContext.switchToHttp().getRequest();
    const readMetadata = <T>(key: string) =>
      this.reflector.getAllAndOverride<T | undefined>(key, [executionContext.getHandler(), executionContext.getClass()]);

    const isPublicRoute = readMetadata<boolean>(METADATA_KEY.publicRoute) === true;
    const requiredApiKeyScopes = readMetadata<string[]>(METADATA_KEY.apiKeyScopes);
    const presentedApiKey = request.headers?.[API_KEY_HEADER];
    const presentedAccessToken = this.readBearerToken(request.headers?.[HTTP_HEADER.authorization]);

    // Public route: a token is optional, and a bad one is simply ignored.
    if (isPublicRoute) {
      if (presentedAccessToken) {
        const claims = await this.sessions.verifyAccessToken(presentedAccessToken).catch(() => undefined);
        if (claims) this.attachCaller(request, { user: claims });
      }
      return true;
    }

    // Server-to-server call with an API key.
    if (presentedApiKey !== undefined && requiredApiKeyScopes) {
      const apiKey = await this.apiKeys.verifyApiKey(presentedApiKey);
      const hasEveryScope = requiredApiKeyScopes.every((scope) => apiKey.scopes.includes(scope));
      if (!hasEveryScope) throw new AuthError(AUTH_ERRORS.missingApiKeyScope);
      this.attachCaller(request, {
        apiKey: { id: apiKey.id, name: apiKey.name, scopes: apiKey.scopes, organizationId: apiKey.organizationId },
      });
      return true;
    }

    // Everything else needs a signed-in user.
    if (!presentedAccessToken) throw new AuthError(AUTH_ERRORS.unauthorized);
    const claims = await this.sessions.verifyAccessToken(presentedAccessToken);

    // Optional live check that the session and account are still active.
    const isAdminOnlyRoute = readMetadata<boolean>(METADATA_KEY.adminOnly) === true;
    const mustCheckSession = isAdminOnlyRoute || readMetadata<boolean>(METADATA_KEY.checkSessionInDatabase) === true;
    if (mustCheckSession && !(await this.sessions.isSessionStillAllowed(claims.sid, claims.sub))) {
      throw new AuthError(AUTH_ERRORS.invalidAccessToken);
    }

    // Roles.
    const requiredRoles = readMetadata<string[]>(METADATA_KEY.requiredRoles) ?? [];
    if (requiredRoles.length > 0 && !requiredRoles.some((role) => claims.roles.includes(role))) {
      throw new AuthError(AUTH_ERRORS.forbidden);
    }
    if (isAdminOnlyRoute) {
      const { adminRoles } = (await this.settings.getSettings()).admin;
      if (!adminRoles.some((role) => claims.roles.includes(role))) throw new AuthError(AUTH_ERRORS.forbidden);
    }

    this.attachCaller(request, { user: claims });
    return true;
  }

  /**
   * @param authorizationHeader - The Authorization header.
   * @returns The token from "Bearer <token>", or undefined.
   */
  private readBearerToken(authorizationHeader: unknown): string | undefined {
    if (typeof authorizationHeader !== 'string') return undefined;
    return BEARER_TOKEN_PATTERN.exec(authorizationHeader)?.[1];
  }

  /**
   * Stores who is calling on the request, for the @CurrentUser(), @CurrentUserId() and @CurrentCaller() decorators.
   *
   * @param request - The HTTP request.
   * @param caller - The signed-in user or the API key.
   */
  private attachCaller(request: Record<string, unknown>, caller: AuthenticatedCaller) {
    request[CALLER_REQUEST_PROPERTY] = caller;
  }
}
