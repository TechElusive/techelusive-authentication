import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { AUTH_OPTIONS_TOKEN, DATA_EXPORT_AUDIT_LOG_LIMIT, RATE_LIMITS, RATE_LIMIT_KEY, SORT_ORDER } from '@/constants';
import {
  AuditLogEntity,
  OrganizationEntity,
  OrganizationMemberEntity,
  PasskeyEntity,
  SessionEntity,
  SocialAccountEntity,
} from '@/database/entities';
import { SettingsService } from '@/features/settings/settings.service';
import { SignInMethodsService } from '@/features/users/sign-in-methods.service';
import { UsersService } from '@/features/users/users.service';

/**
 * "Download my data" (GET /auth/me/export), for privacy laws such as India's DPDP Act and the GDPR.
 *
 * Everything this library stores about the user, in readable form: profile, sign-in methods,
 * linked accounts, passkeys (names only), devices, organizations and their security history.
 * Never included: password hashes, 2FA secrets, backup codes, tokens or keys.
 * Your app adds its own data (orders, rides...) next to this in its own export.
 */
@Injectable()
export class DataExportService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly signInMethods: SignInMethodsService,
    private readonly rateLimiter: RateLimiterService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Collects everything this library stores about the user, in readable form.
   * Secrets (password hashes, 2FA secrets, backup codes, tokens, keys) are never included.
   *
   * @param userId - The signed-in user.
   * @returns Profile, sign-in methods, linked accounts, passkeys, devices, organizations and security history.
   * @throws AuthError TOO_MANY_REQUESTS when exported too often.
   */
  async exportUserData(userId: string) {
    await this.rateLimiter.consume(RATE_LIMIT_KEY.exportDataPerUser(userId), RATE_LIMITS.exportDataPerUser);
    const settings = await this.settingsService.getSettings();
    const user = await this.users.getUserOrThrow(userId);

    const [signInMethods, socialAccounts, passkeys, sessions, memberships, history] = await Promise.all([
      this.signInMethods.listSignInMethods(user, settings),
      this.database.getRepository(SocialAccountEntity).find({ where: { userId }, order: { createdAt: SORT_ORDER.oldestFirst } }),
      this.database.getRepository(PasskeyEntity).find({ where: { userId }, order: { createdAt: SORT_ORDER.oldestFirst } }),
      this.database.getRepository(SessionEntity).find({ where: { userId }, order: { createdAt: SORT_ORDER.newestFirst } }),
      this.database.getRepository(OrganizationMemberEntity).find({ where: { userId }, order: { createdAt: SORT_ORDER.oldestFirst } }),
      this.database.getRepository(AuditLogEntity).find({
        where: { userId },
        order: { createdAt: SORT_ORDER.newestFirst },
        take: DATA_EXPORT_AUDIT_LOG_LIMIT,
      }),
    ]);
    const organizations = memberships.length
      ? await this.database.getRepository(OrganizationEntity).findBy({ id: In(memberships.map((membership) => membership.organizationId)) })
      : [];

    return {
      success: true as const,
      exportedAt: new Date().toISOString(),
      profile: {
        ...this.users.toPublicProfile(user, settings),
        termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
        privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt?.toISOString() ?? null,
        onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
        updatedAt: user.updatedAt.toISOString(),
      },
      signInMethods,
      linkedAccounts: socialAccounts.map((account) => ({
        provider: account.provider,
        email: account.email,
        linkedAt: account.createdAt.toISOString(),
      })),
      passkeys: passkeys.map((passkey) => ({
        name: passkey.name,
        createdAt: passkey.createdAt.toISOString(),
        lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
      })),
      devices: sessions.map((session) => ({
        signInMethod: session.signInMethod,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        signedInAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        endedAt: session.revokedAt?.toISOString() ?? null,
      })),
      organizations: memberships.map((membership) => ({
        name: organizations.find((organization) => organization.id === membership.organizationId)?.name ?? null,
        role: membership.role,
        joinedAt: membership.createdAt.toISOString(),
      })),
      securityHistory: history.map((entry) => ({
        event: entry.eventName,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        details: entry.details,
        at: entry.createdAt.toISOString(),
      })),
    };
  }
}
