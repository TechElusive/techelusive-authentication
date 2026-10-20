import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan, MoreThanOrEqual } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { RequestContext } from '@/common/request-context';
import {
  AccountStatus,
  ACCOUNT_STATUS,
  ADMIN_STATS_WINDOW_SECONDS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAXIMUM_PAGE_SIZE,
  PERFORMED_BY,
  SECOND_IN_MILLISECONDS,
  SORT_ORDER,
  SQL_LIKE_ANY_TEXT,
  SQL_LIKE_ESCAPE_CHARACTER,
  SQL_LIKE_SPECIAL_CHARACTERS_PATTERN,
  WEBHOOK_DELIVERY_STATUS,
} from '@/constants';
import { AuditLogEntity, SessionEntity, UserEntity, WebhookDeliveryEntity } from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { SessionService } from '@/features/sessions/session.service';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthSettings, SettingsChanges } from '@/features/settings/settings.types';
import { SignInMethodsService } from '@/features/users/sign-in-methods.service';
import { UsersService } from '@/features/users/users.service';

/** Events counted by GET /auth/admin/stats, by the name they have in the response. */
const STATS_EVENT_NAMES = {
  signIns: AUTH_EVENTS.userSignedIn,
  failedSignIns: AUTH_EVENTS.userSignInFailed,
  newUsers: AUTH_EVENTS.userCreated,
  refreshTokenReuses: AUTH_EVENTS.refreshTokenReused,
  passwordResetsRequested: AUTH_EVENTS.passwordResetRequested,
} as const;

export interface UserSearch {
  /** Matches email, phone number, first or last name (partial, case-insensitive). */
  search?: string;
  status?: AccountStatus;
  role?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogSearch {
  userId?: string;
  eventName?: string;
  page?: number;
  pageSize?: number;
}

/** Read-heavy admin operations. Changes to a single user go through UsersService, so the rules stay in one place. */
@Injectable()
export class AdminService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly signInMethods: SignInMethodsService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Paged user list with search and filters. Deleted accounts are excluded unless asked for
   * with `status: "DELETED"`.
   *
   * @param filters - Search text, status, role, page and page size.
   * @returns One page of public profiles, plus the total number of matches.
   */
  async searchUsers(filters: UserSearch) {
    const settings = await this.settingsService.getSettings();
    const { page, pageSize, skip } = this.paging(filters.page, filters.pageSize);

    const query = this.database.getRepository(UserEntity).createQueryBuilder('user');
    if (filters.status) query.andWhere('user.status = :status', { status: filters.status });
    else query.andWhere('user.status <> :deletedStatus', { deletedStatus: ACCOUNT_STATUS.deleted });
    if (filters.role) query.andWhere(':role = ANY(user.roles)', { role: filters.role });
    if (filters.search?.trim()) {
      // Escape % and _ so the search text is matched literally.
      const escapedSearch = filters.search.trim().replace(SQL_LIKE_SPECIAL_CHARACTERS_PATTERN, (character) => SQL_LIKE_ESCAPE_CHARACTER + character);
      const pattern = SQL_LIKE_ANY_TEXT + escapedSearch + SQL_LIKE_ANY_TEXT;
      query.andWhere(
        '(user.email ILIKE :pattern OR user.phone_number ILIKE :pattern OR user.first_name ILIKE :pattern OR user.last_name ILIKE :pattern)',
        { pattern },
      );
    }
    const [users, total] = await query.orderBy('user.created_at', SORT_ORDER.newestFirst).skip(skip).take(pageSize).getManyAndCount();
    return {
      success: true as const,
      users: users.map((user: UserEntity) => this.users.toPublicProfile(user, settings)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Everything support staff need about one user: profile, suspension reason, sign-in methods, devices.
   *
   * @param userId - The user.
   * @returns The profile and the extra details.
   * @throws AuthError NOT_FOUND when the user doesn't exist.
   */
  async getUserDetails(userId: string) {
    const settings = await this.settingsService.getSettings();
    const user = await this.users.getUserOrThrow(userId);
    const [signInMethods, sessions] = await Promise.all([
      this.signInMethods.listSignInMethods(user, settings),
      this.sessions.listActiveSessions(userId),
    ]);
    return {
      success: true as const,
      user: this.users.toPublicProfile(user, settings),
      suspensionReason: user.suspensionReason,
      statusChangedAt: user.statusChangedAt?.toISOString() ?? null,
      termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
      privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt?.toISOString() ?? null,
      signInMethods,
      sessions: sessions.map((session) => ({
        id: session.id,
        signInMethod: session.signInMethod,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
      })),
    };
  }

  /**
   * Paged security history, newest first.
   *
   * @param filters - Optional user id and event name, plus page and page size.
   * @returns One page of audit log entries, plus the total number of matches.
   */
  async searchAuditLog(filters: AuditLogSearch) {
    const { page, pageSize, skip } = this.paging(filters.page, filters.pageSize);
    const [entries, total] = await this.database.getRepository(AuditLogEntity).findAndCount({
      where: {
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.eventName ? { eventName: filters.eventName } : {}),
      },
      order: { createdAt: SORT_ORDER.newestFirst },
      skip,
      take: pageSize,
    });
    return { success: true as const, entries, total, page, pageSize };
  }

  // -------------------------------------------------------------------------------------------
  // Runtime settings
  // -------------------------------------------------------------------------------------------

  /**
   * @returns The settings in force: the code settings with any admin changes on top.
   */
  async getSettings(): Promise<{ success: true; settings: AuthSettings }> {
    return { success: true, settings: await this.settingsService.getSettings() };
  }

  /**
   * Saves admin changes on top of the code settings. Takes effect on every server within seconds.
   *
   * @param changes - Only the sections and fields to change.
   * @param adminUserId - The admin doing it (for the audit log).
   * @param request - Who is asking.
   * @returns The settings now in force.
   * @throws AuthError INVALID_SETTINGS when a value is not allowed.
   */
  async changeSettings(changes: SettingsChanges, adminUserId: string, request: RequestContext) {
    const settings = await this.settingsService.saveAdminChanges(changes, PERFORMED_BY.admin(adminUserId));
    await this.events.record({
      name: AUTH_EVENTS.settingsChanged,
      userId: adminUserId,
      performedBy: PERFORMED_BY.admin(adminUserId),
      request,
      details: { changedSections: Object.keys(changes) },
    });
    return { success: true as const, settings };
  }

  /**
   * Throws away all admin changes, back to the settings in code.
   *
   * @param adminUserId - The admin doing it (for the audit log).
   * @param request - Who is asking.
   * @returns The settings now in force.
   */
  async resetSettings(adminUserId: string, request: RequestContext) {
    const settings = await this.settingsService.discardAdminChanges();
    await this.events.record({
      name: AUTH_EVENTS.settingsChanged,
      userId: adminUserId,
      performedBy: PERFORMED_BY.admin(adminUserId),
      request,
      details: { reset: true },
    });
    return { success: true as const, settings };
  }

  /**
   * Numbers for an admin dashboard or monitoring: accounts by status, signed-in devices, and what
   * happened in the last 24 hours (from the audit log, so it covers every server).
   *
   * @returns The counts and when they were generated.
   */
  async getStats() {
    const since = new Date(Date.now() - ADMIN_STATS_WINDOW_SECONDS * SECOND_IN_MILLISECONDS);
    const statuses = Object.values(ACCOUNT_STATUS);
    const eventLabels = Object.entries(STATS_EVENT_NAMES);
    const [userCounts, activeSessions, eventCounts, pendingWebhookDeliveries] = await Promise.all([
      Promise.all(statuses.map((status) => this.database.getRepository(UserEntity).count({ where: { status } }))),
      this.database.getRepository(SessionEntity).count({ where: { revokedAt: IsNull(), expiresAt: MoreThan(new Date()) } }),
      Promise.all(
        eventLabels.map(([, eventName]) =>
          this.database.getRepository(AuditLogEntity).count({ where: { eventName, createdAt: MoreThanOrEqual(since) } }),
        ),
      ),
      this.database.getRepository(WebhookDeliveryEntity).count({ where: { status: WEBHOOK_DELIVERY_STATUS.pending } }),
    ]);

    return {
      success: true as const,
      usersByStatus: Object.fromEntries(statuses.map((status, index) => [status, userCounts[index]])),
      activeSessions,
      last24Hours: Object.fromEntries(eventLabels.map(([label], index) => [label, eventCounts[index]])),
      pendingWebhookDeliveries,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Turns the requested page and page size into safe values (at least 1, at most MAXIMUM_PAGE_SIZE).
   *
   * @param requestedPage - 1-based page number.
   * @param requestedPageSize - Rows per page.
   * @returns The clean page, page size, and how many rows to skip.
   */
  private paging(requestedPage = FIRST_PAGE, requestedPageSize = DEFAULT_PAGE_SIZE) {
    const page = Math.max(Math.floor(requestedPage) || FIRST_PAGE, FIRST_PAGE);
    const pageSize = Math.min(Math.max(Math.floor(requestedPageSize) || DEFAULT_PAGE_SIZE, 1), MAXIMUM_PAGE_SIZE);
    return { page, pageSize, skip: (page - 1) * pageSize };
  }
}
