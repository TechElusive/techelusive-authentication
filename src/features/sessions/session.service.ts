import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, MoreThan, Not } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { signJwt, verifyJwt } from '@/common/crypto/jwt';
import { createRandomToken, hasRandomTokenFormat, sha256Hex } from '@/common/crypto/random-secrets';
import { RequestContext } from '@/common/request-context';
import {
  ACCESS_TOKEN_JWT_TYPE,
  ACCOUNT_STATUS,
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  DAY_IN_SECONDS,
  LOG_CONTEXT,
  MINUTE_IN_SECONDS,
  SECOND_IN_MILLISECONDS,
  type SessionEndReason,
  SESSION_CHECK_CACHE_MAX_ENTRIES,
  SESSION_CHECK_CACHE_SECONDS,
  SESSION_END_REASON,
  SIGNING_ALGORITHM,
  SORT_ORDER,
  TOKEN_PREFIX,
  TRAILING_SLASHES_PATTERN,
  TWO_FACTOR_AMR_VALUE,
} from '@/constants';
import { OrganizationMemberEntity, RefreshTokenEntity, SessionEntity, UserEntity } from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { AuthSettings } from '@/features/settings/settings.types';
import { SigningKeysService } from '@/features/signing-keys/signing-keys.service';
import { AccessTokenClaims, SignInMethod, TokenSet } from './session.types';
import { currentUnixTimeSeconds } from '@/common/time';

/**
 * Sessions (one per signed-in device) and the tokens that belong to them.
 *
 * - Access token: a signed JWT that lives a few minutes. Your API checks it on every request.
 * - Refresh token: a random string that works ONCE to get a new pair of tokens. If an already-used
 *   refresh token comes back, someone copied it, so we end that session to protect the user.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(LOG_CONTEXT.sessions);
  private readonly database: DataSource;
  /** Token "iss" and "aud": your API's URL. */
  readonly issuer: string;
  /** Short cache of "is this session still allowed?" answers, so the database isn't hit on every request. */
  private readonly sessionCheckCache = new Map<string, { isAllowed: boolean; checkedAt: number }>();

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly signingKeys: SigningKeysService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
    this.issuer = options.issuer.replace(TRAILING_SLASHES_PATTERN, '');
  }

  /**
   * Starts a session for a user who has just proven who they are, and returns their first tokens.
   *
   * @param user - The user signing in.
   * @param signInMethod - How they signed in (goes into the token's "amr" claim).
   * @param usedTwoFactor - Whether a second factor was used.
   * @param request - The device's IP and user agent, shown in the user's device list.
   * @param settings - The current settings (session and token lifetimes).
   * @returns The access token, refresh token and session id.
   */
  async startSession(
    user: UserEntity,
    signInMethod: SignInMethod,
    usedTwoFactor: boolean,
    request: RequestContext,
    settings: AuthSettings,
  ): Promise<TokenSet> {
    const now = new Date();
    const session = await this.database.getRepository(SessionEntity).save({
      userId: user.id,
      signInMethod,
      usedTwoFactor,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + settings.tokens.sessionDays * DAY_IN_SECONDS * SECOND_IN_MILLISECONDS),
    });
    return this.issueTokens(user, session, settings);
  }

  /**
   * Swaps a refresh token for a new access token and a new refresh token.
   * Each refresh token works exactly once; a second use ends the whole session.
   *
   * @param refreshToken - The "rt_..." token the client sent.
   * @param request - Who is asking (for the audit log if the token was reused).
   * @param settings - The current settings.
   * @returns A new set of tokens for the same session.
   * @throws AuthError INVALID_TOKEN when the token is unknown, used, expired, its session has
   *   ended, or the account is no longer active.
   */
  async refreshSession(refreshToken: unknown, request: RequestContext, settings: AuthSettings): Promise<TokenSet> {
    if (!hasRandomTokenFormat(refreshToken, TOKEN_PREFIX.refreshToken)) throw new AuthError(AUTH_ERRORS.invalidRefreshToken);
    const tokenHash = sha256Hex(refreshToken);

    // Mark the token used in a single UPDATE: if two requests race, only one gets a row back.
    const markAsUsed = await this.database
      .createQueryBuilder()
      .update(RefreshTokenEntity)
      .set({ usedAt: () => 'now()' })
      .where('token_hash = :tokenHash AND used_at IS NULL AND expires_at > now()', { tokenHash })
      // returning() takes entity property names; the raw rows use column names (session_id).
      .returning(['sessionId'])
      .execute();
    const sessionId: string | undefined = markAsUsed.raw[0]?.session_id;

    if (!sessionId) {
      await this.handleRefreshTokenReuse(tokenHash, request);
      throw new AuthError(AUTH_ERRORS.invalidRefreshToken);
    }

    const session = await this.database.getRepository(SessionEntity).findOne({
      where: { id: sessionId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    if (!session) throw new AuthError(AUTH_ERRORS.invalidRefreshToken);

    // The account may have been suspended or deactivated since the last refresh.
    const user = await this.database.getRepository(UserEntity).findOne({ where: { id: session.userId } });
    if (!user || user.status !== ACCOUNT_STATUS.active) {
      await this.revokeSession(session.id, SESSION_END_REASON.accountNotActive);
      throw new AuthError(AUTH_ERRORS.invalidRefreshToken);
    }

    await this.database.getRepository(SessionEntity).update({ id: session.id }, { lastUsedAt: new Date() });
    return this.issueTokens(user, session, settings);
  }

  /**
   * Checks an access token's signature, issuer, audience and expiry.
   * This does not check whether the session was ended since; see `isSessionStillAllowed`.
   *
   * @param accessToken - The token from the Authorization header.
   * @returns The token's claims (user id, session id, roles...).
   * @throws AuthError INVALID_TOKEN when any check fails.
   */
  async verifyAccessToken(accessToken: string): Promise<AccessTokenClaims> {
    const { publicKeysById } = await this.signingKeys.getSigningKeys();
    const claims = verifyJwt(accessToken, (keyId) => publicKeysById.get(keyId), {
      allowedAlgorithm: SIGNING_ALGORITHM,
      expectedIssuers: [this.issuer],
      expectedAudiences: [this.issuer],
      expectedTokenType: ACCESS_TOKEN_JWT_TYPE,
    });
    if (!claims || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') throw new AuthError(AUTH_ERRORS.invalidAccessToken);
    return claims as AccessTokenClaims;
  }

  /**
   * Checks that the session has not been ended and its user is ACTIVE.
   * Answers are cached for a few seconds, so signing out or suspending takes effect almost at once
   * without a database query on every request.
   *
   * @param sessionId - The "sid" claim from the access token.
   * @param userId - The "sub" claim from the access token.
   * @returns True when requests from this session should still be accepted.
   */
  async isSessionStillAllowed(sessionId: string, userId: string): Promise<boolean> {
    const cached = this.sessionCheckCache.get(sessionId);
    if (cached && Date.now() - cached.checkedAt < SESSION_CHECK_CACHE_SECONDS * SECOND_IN_MILLISECONDS) return cached.isAllowed;

    const matchingRows = await this.database
      .getRepository(SessionEntity)
      .createQueryBuilder('session')
      .innerJoin(UserEntity, 'user', 'user.id = session.user_id')
      .where('session.id = :sessionId AND session.user_id = :userId', { sessionId, userId })
      .andWhere('session.revoked_at IS NULL AND session.expires_at > now()')
      .andWhere('user.status = :activeStatus', { activeStatus: ACCOUNT_STATUS.active })
      .getCount();

    const isAllowed = matchingRows === 1;
    this.sessionCheckCache.set(sessionId, { isAllowed, checkedAt: Date.now() });
    if (this.sessionCheckCache.size > SESSION_CHECK_CACHE_MAX_ENTRIES) this.sessionCheckCache.clear();
    return isAllowed;
  }

  /**
   * Ends one session.
   *
   * @param sessionId - The session to end.
   * @param reason - Why it ended (stored, and shown in the audit log).
   * @param userId - When given, the session is only ended if it belongs to this user.
   * @returns False if nothing was ended (unknown, already ended, or someone else's session).
   */
  async revokeSession(sessionId: string, reason: SessionEndReason, userId?: string): Promise<boolean> {
    const result = await this.database
      .getRepository(SessionEntity)
      .update({ id: sessionId, revokedAt: IsNull(), ...(userId ? { userId } : {}) }, { revokedAt: new Date(), revokedReason: reason });
    this.sessionCheckCache.delete(sessionId);
    const wasRevoked = (result.affected ?? 0) > 0;
    if (wasRevoked) {
      await this.events.record({ name: AUTH_EVENTS.sessionRevoked, userId: userId ?? null, details: { sessionId, reason } });
    }
    return wasRevoked;
  }

  /**
   * Ends every session of a user, e.g. after a password change.
   *
   * @param userId - The user to sign out.
   * @param reason - Why the sessions ended.
   * @param keepSessionId - When given, this session (the device making the request) stays signed in.
   * @returns How many sessions were ended.
   */
  async revokeAllSessions(userId: string, reason: SessionEndReason, keepSessionId?: string): Promise<number> {
    const result = await this.database
      .getRepository(SessionEntity)
      .update(
        { userId, revokedAt: IsNull(), ...(keepSessionId ? { id: Not(keepSessionId) } : {}) },
        { revokedAt: new Date(), revokedReason: reason },
      );
    this.sessionCheckCache.clear();
    return result.affected ?? 0;
  }

  /**
   * Lists the user's signed-in devices, most recently used first.
   *
   * @param userId - The user.
   * @returns The sessions that have not ended or expired.
   */
  listActiveSessions(userId: string): Promise<SessionEntity[]> {
    return this.database.getRepository(SessionEntity).find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { lastUsedAt: SORT_ORDER.newestFirst },
    });
  }

  /**
   * Switches the organization a device is working in, and returns a fresh access token that carries it
   * (in the "org_id" and "org_role" claims).
   *
   * @param sessionId - The device's session.
   * @param organizationId - The organization to switch to, or null for none.
   * @param settings - The current settings.
   * @returns A new access token and its lifetime in seconds.
   */
  async switchActiveOrganization(sessionId: string, organizationId: string | null, settings: AuthSettings) {
    const session = await this.database.getRepository(SessionEntity).findOneOrFail({ where: { id: sessionId } });
    session.activeOrganizationId = organizationId;
    await this.database.getRepository(SessionEntity).update({ id: sessionId }, { activeOrganizationId: organizationId });
    const user = await this.database.getRepository(UserEntity).findOneOrFail({ where: { id: session.userId } });
    return this.createAccessToken(user, session, settings);
  }

  /**
   * Creates a new access token and a new refresh token for a session.
   *
   * @param user - The session's user.
   * @param session - The session the tokens belong to.
   * @param settings - The current settings (token lifetimes).
   * @returns The full token set to send to the client.
   */
  private async issueTokens(user: UserEntity, session: SessionEntity, settings: AuthSettings): Promise<TokenSet> {
    const { accessToken, expiresIn } = await this.createAccessToken(user, session, settings);

    const { plainToken: refreshToken, tokenHash } = createRandomToken(TOKEN_PREFIX.refreshToken);
    const refreshTokenLifetimeMs = settings.tokens.refreshTokenDays * DAY_IN_SECONDS * SECOND_IN_MILLISECONDS;
    // A refresh token never outlives its session.
    const refreshTokenExpiresAt = new Date(Math.min(Date.now() + refreshTokenLifetimeMs, session.expiresAt.getTime()));
    await this.database.getRepository(RefreshTokenEntity).insert({ sessionId: session.id, tokenHash, expiresAt: refreshTokenExpiresAt });

    return {
      accessToken,
      expiresIn,
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
      sessionId: session.id,
    };
  }

  /**
   * Signs an access token with the user's roles, how they signed in, and the active organization.
   *
   * @param user - The session's user.
   * @param session - The session the token belongs to.
   * @param settings - The current settings (access token lifetime).
   * @returns The signed token and its lifetime in seconds.
   */
  private async createAccessToken(user: UserEntity, session: SessionEntity, settings: AuthSettings) {
    const { currentKey } = await this.signingKeys.getSigningKeys();
    const issuedAt = currentUnixTimeSeconds();
    const expiresIn = settings.tokens.accessTokenMinutes * MINUTE_IN_SECONDS;

    const organizationMembership = session.activeOrganizationId
      ? await this.database.getRepository(OrganizationMemberEntity).findOne({
          where: { organizationId: session.activeOrganizationId, userId: user.id },
        })
      : null;

    const claims: AccessTokenClaims = {
      iss: this.issuer,
      aud: this.issuer,
      sub: user.id,
      sid: session.id,
      roles: user.roles,
      amr: session.usedTwoFactor ? [session.signInMethod, TWO_FACTOR_AMR_VALUE] : [session.signInMethod],
      ...(organizationMembership ? { org_id: organizationMembership.organizationId, org_role: organizationMembership.role } : {}),
      iat: issuedAt,
      exp: issuedAt + expiresIn,
      jti: randomUUID(),
    };
    return { accessToken: signJwt(claims, currentKey, ACCESS_TOKEN_JWT_TYPE), expiresIn };
  }

  /**
   * An already-used refresh token came back: it was copied. End the session; the real user simply
   * signs in again. Does nothing if the token was never ours.
   *
   * @param tokenHash - The hash of the token that was sent.
   * @param request - Who sent it (for the audit log).
   */
  private async handleRefreshTokenReuse(tokenHash: string, request: RequestContext) {
    const reusedToken = await this.database.getRepository(RefreshTokenEntity).findOne({ where: { tokenHash, usedAt: Not(IsNull()) } });
    if (!reusedToken) return;
    const session = await this.database.getRepository(SessionEntity).findOne({ where: { id: reusedToken.sessionId } });
    if (!session || !(await this.revokeSession(session.id, SESSION_END_REASON.refreshTokenReused))) return;

    this.logger.warn(`A used refresh token was presented again; session ${session.id} has been ended`);
    await this.events.record({
      name: AUTH_EVENTS.refreshTokenReused,
      userId: session.userId,
      request,
      details: { sessionId: session.id },
    });
  }
}
