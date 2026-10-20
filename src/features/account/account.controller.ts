import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Req, Res, UsePipes } from '@nestjs/common';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  HEALTH_SERVICE_UNAVAILABLE_STATUS,
  HEALTH_STATUS,
  RATE_LIMITS,
  RATE_LIMIT_KEY,
  ROUTES,
  ROUTE_PARAM,
  SESSION_END_REASON,
  SUCCESS_MESSAGES,
} from '@/constants';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { CheckSession, CurrentUser, CurrentUserId, Public } from '@/guards/auth.decorators';
import { AccessTokenClaims } from '@/features/sessions/session.types';
import { SessionService } from '@/features/sessions/session.service';
import { SettingsService } from '@/features/settings/settings.service';
import { SignInService } from '@/features/sign-in/sign-in.service';
import { SignInMethodsService } from '@/features/users/sign-in-methods.service';
import { UsersService } from '@/features/users/users.service';
import { ReactivateAccountInput, RefreshTokenInput, UpdateMyProfileInput } from './account.dto';
import { DataExportService } from './data-export.service';
import { HealthService } from './health.service';
import {
  assertAllowedOrigin,
  ClearsRefreshTokenCookie,
  LibraryController,
  readRefreshCookie,
} from '@/common/refresh-token-cookie';

/** The parts of the raw HTTP request read by the cookie refresh. */
type HttpRequestWithHeaders = { headers: Record<string, string | string[] | undefined> };

/**
 * The signed-in user's own account: tokens, profile, devices, deactivate / delete.
 *
 *   POST   /auth/refresh            new tokens from a refresh token
 *   POST   /auth/logout             sign out this device
 *   POST   /auth/logout-all         sign out every device
 *   GET    /auth/me                 profile
 *   PATCH  /auth/me                 change name / app fields
 *   GET    /auth/sign-in-methods    password? Google? passkeys?
 *   GET    /auth/sessions           signed-in devices
 *   DELETE /auth/sessions/:id       sign out one device
 *   POST   /auth/deactivate         switch account off (reversible)
 *   POST   /auth/reactivate         switch it back on
 *   DELETE /auth/me                 delete account (permanent)
 *   GET    /auth/me/export          download my data (JSON)
 *   GET    /auth/health             database / Redis reachable (public)
 */
@Controller(ROUTES.auth.prefix)
@LibraryController()
@UsePipes(strictValidationPipe)
export class AccountController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly signIn: SignInService,
    private readonly signInMethods: SignInMethodsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly dataExport: DataExportService,
    private readonly healthService: HealthService,
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions,
  ) {}

  /**
   * POST /auth/refresh — Swaps a refresh token for new tokens. Public.
   *
   * The refresh token comes from the body or, with AuthOptions.refreshTokenCookie, from the
   * HttpOnly cookie (then the request must come from one of the allowed origins).
   *
   * @param body - `{ refreshToken }`, or empty when the cookie is used.
   * @param request - Who is asking (for rate limits).
   * @param httpRequest - The raw request, to read the cookie and Origin header.
   * @returns A new access token and refresh token.
   */
  @Post(ROUTES.auth.refresh)
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshTokenInput, @CurrentRequest() request: RequestContext, @Req() httpRequest: HttpRequestWithHeaders) {
    await this.rateLimiter.consume(RATE_LIMIT_KEY.refreshPerIp(request.ipAddress), RATE_LIMITS.refreshPerIp);
    let refreshToken = body.refreshToken;
    const cookieOptions = this.options.refreshTokenCookie;
    if (refreshToken === undefined && cookieOptions) {
      assertAllowedOrigin(cookieOptions, httpRequest);
      refreshToken = readRefreshCookie(cookieOptions, httpRequest);
    }
    const tokens = await this.sessions.refreshSession(refreshToken, request, await this.settingsService.getSettings());
    return { success: true, ...tokens };
  }

  /**
   * POST /auth/logout — Signs out this device and clears the refresh token cookie.
   *
   * @param user - The access token's claims (user id and session id).
   * @param request - Who is asking.
   * @returns A success message.
   */
  @Post(ROUTES.auth.logout)
  @ClearsRefreshTokenCookie()
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AccessTokenClaims, @CurrentRequest() request: RequestContext) {
    await this.signIn.signOut(user.sub, user.sid, request);
    return { success: true, message: SUCCESS_MESSAGES.signedOut };
  }

  /**
   * POST /auth/logout-all — Signs out every device, this one included.
   *
   * @param user - The access token's claims.
   * @param request - Who is asking.
   * @returns A success message and how many sessions were ended.
   */
  @Post(ROUTES.auth.logoutAll)
  @ClearsRefreshTokenCookie()
  @HttpCode(HttpStatus.OK)
  async logoutEverywhere(@CurrentUser() user: AccessTokenClaims, @CurrentRequest() request: RequestContext) {
    const endedSessions = await this.signIn.signOutEverywhere(user.sub, request);
    return { success: true, message: SUCCESS_MESSAGES.signedOutEverywhere, endedSessions };
  }

  /**
   * GET /auth/me — The signed-in user's profile.
   *
   * @param userId - From the access token.
   * @returns The public profile.
   */
  @Get(ROUTES.auth.me)
  @CheckSession()
  async getMe(@CurrentUserId() userId: string) {
    const settings = await this.settingsService.getSettings();
    return { success: true, user: this.users.toPublicProfile(await this.users.getUserOrThrow(userId), settings) };
  }

  /**
   * PATCH /auth/me — Changes the signed-in user's names or metadata.
   *
   * @param userId - From the access token.
   * @param body - The fields to change.
   * @param request - Who is asking.
   * @returns The updated public profile.
   */
  @Patch(ROUTES.auth.me)
  @CheckSession()
  async updateMe(@CurrentUserId() userId: string, @Body() body: UpdateMyProfileInput, @CurrentRequest() request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const user = await this.users.updateProfile(userId, body, null, request);
    return { success: true, user: this.users.toPublicProfile(user, settings) };
  }

  /**
   * GET /auth/sign-in-methods — Every way the user can currently sign in.
   *
   * @param userId - From the access token.
   * @returns Password, codes, social accounts and passkey count.
   */
  @Get(ROUTES.auth.signInMethods)
  async getSignInMethods(@CurrentUserId() userId: string) {
    const settings = await this.settingsService.getSettings();
    const user = await this.users.getUserOrThrow(userId);
    return { success: true, signInMethods: await this.signInMethods.listSignInMethods(user, settings) };
  }

  /**
   * GET /auth/sessions — The user's signed-in devices, with this one marked `isCurrentDevice`.
   *
   * @param user - The access token's claims (user id and session id).
   * @returns The devices, most recently used first.
   */
  @Get(ROUTES.auth.sessions)
  async listSessions(@CurrentUser() user: AccessTokenClaims) {
    const sessions = await this.sessions.listActiveSessions(user.sub);
    return {
      success: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        isCurrentDevice: session.id === user.sid,
        signInMethod: session.signInMethod,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
      })),
    };
  }

  /**
   * DELETE /auth/sessions/:sessionId — Signs out one of the user's devices.
   *
   * @param userId - From the access token.
   * @param sessionId - From the URL.
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when the session isn't the user's or has already ended.
   */
  @Delete(ROUTES.auth.session)
  async revokeSession(@CurrentUserId() userId: string, @Param(ROUTE_PARAM.sessionId, new ParseUUIDPipe()) sessionId: string) {
    const wasRevoked = await this.sessions.revokeSession(sessionId, SESSION_END_REASON.signedOutByUser, userId);
    if (!wasRevoked) throw new AuthError(AUTH_ERRORS.notFound);
    return { success: true };
  }

  /**
   * POST /auth/deactivate — Switches the account off and signs out everywhere.
   * Signing in again offers to reactivate it.
   *
   * @param userId - From the access token.
   * @param request - Who is asking.
   * @returns A success message.
   */
  @Post(ROUTES.auth.deactivate)
  @ClearsRefreshTokenCookie()
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  async deactivate(@CurrentUserId() userId: string, @CurrentRequest() request: RequestContext) {
    await this.users.deactivateAccount(userId, request);
    return { success: true, message: SUCCESS_MESSAGES.accountDeactivated };
  }

  /**
   * POST /auth/reactivate — Switches a deactivated account back on and signs in. Public.
   *
   * @param body - `{ reactivationToken }` from the ACCOUNT_DEACTIVATED error.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   */
  @Post(ROUTES.auth.reactivate)
  @Public()
  @HttpCode(HttpStatus.OK)
  async reactivate(@Body() body: ReactivateAccountInput, @CurrentRequest() request: RequestContext) {
    return this.signIn.reactivateAndSignIn(body.reactivationToken, request, await this.settingsService.getSettings());
  }

  /**
   * GET /auth/me/export — Everything stored about the signed-in user, as JSON ("download my data").
   *
   * @param userId - From the access token.
   * @returns See `DataExportService.exportUserData`.
   */
  @Get(ROUTES.auth.exportMyData)
  @CheckSession()
  exportMyData(@CurrentUserId() userId: string) {
    return this.dataExport.exportUserData(userId);
  }

  /**
   * GET /auth/health — For load balancers and uptime checks: 200 when the database (and Redis, if
   * used) answer, 503 otherwise. Says nothing about users. Public.
   *
   * @param response - Used only to set the 503 status.
   * @returns The overall status and each check's result.
   */
  @Get(ROUTES.auth.health)
  @Public()
  async health(@Res({ passthrough: true }) response: { status: (code: number) => unknown }) {
    const report = await this.healthService.check();
    if (!report.isHealthy) response.status(HEALTH_SERVICE_UNAVAILABLE_STATUS);
    return { success: report.isHealthy, status: report.isHealthy ? HEALTH_STATUS.ok : HEALTH_STATUS.error, checks: report.checks };
  }

  /**
   * DELETE /auth/me — Deletes the signed-in user's account. This cannot be undone.
   *
   * @param userId - From the access token.
   * @param request - Who is asking.
   * @returns A success message.
   */
  @Delete(ROUTES.auth.me)
  @ClearsRefreshTokenCookie()
  @CheckSession()
  async deleteMe(@CurrentUserId() userId: string, @CurrentRequest() request: RequestContext) {
    await this.users.deleteUser(userId, null, request);
    return { success: true, message: SUCCESS_MESSAGES.accountDeleted };
  }
}
