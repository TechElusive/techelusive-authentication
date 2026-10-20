import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { RequestContext } from '@/common/request-context';
import {
  AccountStatus,
  ACCOUNT_STATUS,
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  MAXIMUM_ROLES_PER_USER,
  PASSWORD_CHANGE_KIND,
  PENDING_VERIFICATION,
  PERFORMED_BY,
  POSTGRES_UNIQUE_VIOLATION_CODE,
  ROLE_NAME_PATTERN,
  SECOND_IN_MILLISECONDS,
  SESSION_END_REASON,
  UNVERIFIED_ACCOUNT_GRACE_SECONDS,
} from '@/constants';
import {
  BackupCodeEntity,
  LinkTokenEntity,
  OneTimeCodeEntity,
  OrganizationMemberEntity,
  PasskeyEntity,
  PasswordEntity,
  SignInChallengeEntity,
  SocialAccountEntity,
  TwoFactorSecretEntity,
  UserEntity,
} from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { SessionService } from '@/features/sessions/session.service';
import { AuthSettings } from '@/features/settings/settings.types';
import { PendingVerification, PublicUserProfile } from './users.types';
import type { JsonObject } from '@/database/entities/json-object';
import { typeormRow } from '@/database/typeorm-row';

export interface NewUserDetails {
  email?: string | null;
  phoneNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** True when the sign-up itself proved the email (email code, magic link, Google...). */
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  acceptedTerms?: boolean;
  acceptedPrivacyPolicy?: boolean;
}

export interface ProfileChanges {
  firstName?: string;
  lastName?: string;
  /** Your app's own extra fields. Replaces the whole object. */
  metadata?: JsonObject;
}

/**
 * Accounts and their life cycle:
 *
 *   PENDING_VERIFICATION --(required verifications done)--> ACTIVE
 *   ACTIVE --(admin)--> SUSPENDED --(admin lifts it)--> ACTIVE
 *   ACTIVE --(user)--> DEACTIVATED --(user reactivates)--> ACTIVE
 *   any --(user or admin)--> DELETED (personal data wiped; cannot be undone)
 *
 * Suspending, deactivating and deleting all sign the user out everywhere.
 */
@Injectable()
export class UsersService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  // -------------------------------------------------------------------------------------------
  // Finding users
  // -------------------------------------------------------------------------------------------

  /**
   * @param userId - The user's id.
   * @returns The user (in any status, including DELETED), or null.
   */
  findUserById(userId: string): Promise<UserEntity | null> {
    return this.database.getRepository(UserEntity).findOne({ where: { id: userId } });
  }

  /**
   * @param email - Must already be normalized (see `normalizeEmail`).
   * @returns The user with this email, or null.
   */
  findUserByEmail(email: string): Promise<UserEntity | null> {
    return this.database.getRepository(UserEntity).findOne({ where: { email } });
  }

  /**
   * @param phoneNumber - Must already be normalized (see `normalizePhoneNumber`).
   * @returns The user with this phone number, or null.
   */
  findUserByPhoneNumber(phoneNumber: string): Promise<UserEntity | null> {
    return this.database.getRepository(UserEntity).findOne({ where: { phoneNumber } });
  }

  /**
   * Loads a user that must exist. Deleted accounts count as missing.
   *
   * @param userId - The user's id.
   * @returns The user.
   * @throws AuthError NOT_FOUND when there is no such user, or it was deleted.
   */
  async getUserOrThrow(userId: string): Promise<UserEntity> {
    const user = await this.findUserById(userId);
    if (!user || user.status === ACCOUNT_STATUS.deleted) throw new AuthError(AUTH_ERRORS.notFound);
    return user;
  }

  // -------------------------------------------------------------------------------------------
  // Creating users
  // -------------------------------------------------------------------------------------------

  /**
   * Creates an account with the app's default roles (users can never pick their own role).
   * The account starts ACTIVE if the sign-up already proved everything the settings require,
   * otherwise PENDING_VERIFICATION.
   *
   * @param details - Contact details, names, and what the sign-up already verified.
   * @param settings - The current settings (registration and activation rules).
   * @param request - Who is asking (for the audit log).
   * @param transaction - Pass one to create the user together with other rows (e.g. the password).
   * @returns The saved user.
   * @throws AuthError SIGN_UP_CLOSED when registration is turned off.
   * @throws AuthError ACCOUNT_ALREADY_EXISTS when the email or phone number is already taken.
   */
  async createUser(
    details: NewUserDetails,
    settings: AuthSettings,
    request: RequestContext,
    transaction?: EntityManager,
  ): Promise<UserEntity> {
    if (!settings.registration.enabled) throw new AuthError(AUTH_ERRORS.signUpClosed);
    const now = new Date();
    const newUser = this.database.getRepository(UserEntity).create({
      email: details.email ?? null,
      isEmailVerified: details.isEmailVerified ?? false,
      phoneNumber: details.phoneNumber ?? null,
      isPhoneVerified: details.isPhoneVerified ?? false,
      firstName: details.firstName ?? null,
      lastName: details.lastName ?? null,
      roles: [...settings.registration.defaultRoles],
      termsAcceptedAt: details.acceptedTerms ? now : null,
      privacyPolicyAcceptedAt: details.acceptedPrivacyPolicy ? now : null,
      metadata: {},
    });
    newUser.status = this.getPendingVerifications(newUser, settings).length === 0 ? ACCOUNT_STATUS.active : ACCOUNT_STATUS.pendingVerification;
    newUser.statusChangedAt = now;

    let savedUser: UserEntity;
    try {
      savedUser = await (transaction ?? this.database.manager).save(UserEntity, newUser);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new AuthError(AUTH_ERRORS.accountAlreadyExists);
      throw error;
    }

    await this.events.record({
      name: AUTH_EVENTS.userCreated,
      userId: savedUser.id,
      request,
      details: { status: savedUser.status },
    });
    return savedUser;
  }

  // -------------------------------------------------------------------------------------------
  // Verification and activation
  // -------------------------------------------------------------------------------------------

  /**
   * Lists what the user still has to verify before the account becomes ACTIVE.
   *
   * @param user - The user.
   * @param settings - The current settings (activation rules).
   * @returns e.g. ["email"]; empty when nothing is left.
   */
  getPendingVerifications(user: UserEntity, settings: AuthSettings): PendingVerification[] {
    const pending: PendingVerification[] = [];
    if (settings.activation.requireVerifiedEmail && user.email && !user.isEmailVerified) pending.push(PENDING_VERIFICATION.email);
    if (settings.activation.requireVerifiedPhone && !(user.phoneNumber && user.isPhoneVerified)) pending.push(PENDING_VERIFICATION.phone);
    return pending;
  }

  /**
   * Marks the email verified, and activates the account if nothing else is pending.
   *
   * @param user - The user; updated in place.
   * @param settings - The current settings.
   * @param request - Who is asking (for the audit log).
   * @returns The same user, with its new status.
   */
  async markEmailVerified(user: UserEntity, settings: AuthSettings, request: RequestContext): Promise<UserEntity> {
    if (!user.isEmailVerified) {
      await this.database.getRepository(UserEntity).update({ id: user.id }, { isEmailVerified: true });
      user.isEmailVerified = true;
      await this.events.record({ name: AUTH_EVENTS.emailVerified, userId: user.id, request });
    }
    return this.activateIfReady(user, settings, request);
  }

  /**
   * Marks the phone number verified, and activates the account if nothing else is pending.
   *
   * @param user - The user; updated in place.
   * @param settings - The current settings.
   * @param request - Who is asking (for the audit log).
   * @returns The same user, with its new status.
   */
  async markPhoneVerified(user: UserEntity, settings: AuthSettings, request: RequestContext): Promise<UserEntity> {
    if (!user.isPhoneVerified) {
      await this.database.getRepository(UserEntity).update({ id: user.id }, { isPhoneVerified: true });
      user.isPhoneVerified = true;
      await this.events.record({ name: AUTH_EVENTS.phoneVerified, userId: user.id, request });
    }
    return this.activateIfReady(user, settings, request);
  }

  /**
   * Protects against "account pre-hijacking": someone registers YOUR email with THEIR password,
   * never verifies it, and waits for you to sign in with a code, link or Google. When the real
   * owner proves the email for the first time this way, any password set before that proof is
   * removed and all earlier sessions end. Call it BEFORE markEmailVerified.
   *
   * A brand-new account (younger than UNVERIFIED_ACCOUNT_GRACE_SECONDS) is left alone: that is the
   * normal "register with a password, then verify with the emailed code" flow.
   *
   * @param user - The user who just proved the email.
   * @param request - Who is asking (for the audit log).
   */
  async removeUnprovenPassword(user: UserEntity, request: RequestContext): Promise<void> {
    if (user.isEmailVerified) return;
    const accountAgeSeconds = (Date.now() - user.createdAt.getTime()) / SECOND_IN_MILLISECONDS;
    if (accountAgeSeconds < UNVERIFIED_ACCOUNT_GRACE_SECONDS) return;
    const removed = await this.database.getRepository(PasswordEntity).delete({ userId: user.id });
    await this.sessions.revokeAllSessions(user.id, SESSION_END_REASON.emailProvenByOwner);
    if (removed.affected) {
      await this.events.record({
        name: AUTH_EVENTS.passwordChanged,
        userId: user.id,
        request,
        details: { how: PASSWORD_CHANGE_KIND.removedUnverified },
      });
    }
  }

  /**
   * Moves a PENDING_VERIFICATION account to ACTIVE once nothing is left to verify.
   * Does nothing for accounts in any other status.
   *
   * @param user - The user; updated in place.
   * @param settings - The current settings.
   * @param request - Who is asking (for the audit log).
   * @returns The same user.
   */
  async activateIfReady(user: UserEntity, settings: AuthSettings, request: RequestContext): Promise<UserEntity> {
    if (user.status !== ACCOUNT_STATUS.pendingVerification || this.getPendingVerifications(user, settings).length > 0) return user;
    const wasActivated = await this.changeStatus(user, ACCOUNT_STATUS.pendingVerification, ACCOUNT_STATUS.active);
    if (wasActivated) await this.events.record({ name: AUTH_EVENTS.userActivated, userId: user.id, request });
    return user;
  }

  // -------------------------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------------------------

  /**
   * Changes the user's names and/or app metadata. Fields left undefined are not touched.
   *
   * @param userId - The user to change.
   * @param changes - The new values.
   * @param performedBy - Who made the change, for the audit log (null when it was the user).
   * @param request - Who is asking.
   * @returns The updated user.
   * @throws AuthError NOT_FOUND when the user doesn't exist.
   */
  async updateProfile(userId: string, changes: ProfileChanges, performedBy: string | null, request: RequestContext) {
    const user = await this.getUserOrThrow(userId);
    const changedFields = Object.keys(changes).filter((field) => changes[field as keyof ProfileChanges] !== undefined);
    if (changedFields.length === 0) return user;

    Object.assign(user, Object.fromEntries(changedFields.map((field) => [field, changes[field as keyof ProfileChanges]])));
    await this.database.getRepository(UserEntity).save(user);
    await this.events.record({ name: AUTH_EVENTS.userUpdated, userId, performedBy, request, details: { changedFields } });
    return user;
  }

  /**
   * Called by your app's profile module once the user has finished onboarding.
   * Calling it again changes nothing.
   *
   * @param userId - The user.
   * @param request - Who is asking (for the audit log).
   * @returns The updated user.
   */
  async completeOnboarding(userId: string, request: RequestContext): Promise<UserEntity> {
    const user = await this.getUserOrThrow(userId);
    if (user.onboardingCompletedAt) return user;
    user.onboardingCompletedAt = new Date();
    await this.database.getRepository(UserEntity).update({ id: userId }, { onboardingCompletedAt: user.onboardingCompletedAt });
    await this.events.record({ name: AUTH_EVENTS.onboardingCompleted, userId, request });
    return user;
  }

  /**
   * Replaces a user's app-wide roles. Admin only. New roles show up in the user's next access token.
   *
   * @param userId - The user to change.
   * @param roles - The full new list; duplicates are removed.
   * @param adminUserId - The admin doing it (for the audit log).
   * @param request - Who is asking.
   * @returns The updated user.
   * @throws AuthError VALIDATION_ERROR when a role name is invalid or there are too many roles.
   */
  async setRoles(userId: string, roles: string[], adminUserId: string, request: RequestContext): Promise<UserEntity> {
    const uniqueRoles = [...new Set(roles)];
    const hasInvalidRole = uniqueRoles.some((role) => !ROLE_NAME_PATTERN.test(role));
    if (hasInvalidRole || uniqueRoles.length > MAXIMUM_ROLES_PER_USER) throw new AuthError(AUTH_ERRORS.validationFailed);

    const user = await this.getUserOrThrow(userId);
    const previousRoles = user.roles;
    user.roles = uniqueRoles;
    await this.database.getRepository(UserEntity).update({ id: userId }, { roles: uniqueRoles });
    await this.events.record({
      name: AUTH_EVENTS.userRolesChanged,
      userId,
      performedBy: PERFORMED_BY.admin(adminUserId),
      request,
      details: { previousRoles, roles: uniqueRoles },
    });
    return user;
  }

  /**
   * Remembers when the user last signed in (shown to admins and in the profile).
   *
   * @param user - The user; updated in place.
   */
  async recordSignIn(user: UserEntity): Promise<void> {
    user.lastSignedInAt = new Date();
    await this.database.getRepository(UserEntity).update({ id: user.id }, { lastSignedInAt: user.lastSignedInAt });
  }

  // -------------------------------------------------------------------------------------------
  // Status changes
  // -------------------------------------------------------------------------------------------

  /**
   * Admin blocks an account. The reason is kept for support staff. Signs the user out everywhere.
   *
   * @param userId - The user to suspend.
   * @param reason - Why (kept for support staff, not shown to the user).
   * @param adminUserId - The admin doing it (for the audit log).
   * @param request - Who is asking.
   * @returns The updated user.
   */
  async suspendUser(userId: string, reason: string, adminUserId: string, request: RequestContext): Promise<UserEntity> {
    const user = await this.getUserOrThrow(userId);
    if (user.status !== ACCOUNT_STATUS.suspended) {
      user.suspensionReason = reason;
      await this.changeStatus(user, user.status, ACCOUNT_STATUS.suspended, { suspensionReason: reason });
    }
    await this.sessions.revokeAllSessions(userId, SESSION_END_REASON.accountSuspended);
    await this.events.record({
      name: AUTH_EVENTS.userSuspended,
      userId,
      performedBy: PERFORMED_BY.admin(adminUserId),
      request,
      details: { reason },
    });
    return user;
  }

  /**
   * Admin lifts a suspension. The account goes back to ACTIVE (or PENDING_VERIFICATION if still unverified).
   *
   * @param userId - The suspended user.
   * @param adminUserId - The admin doing it (for the audit log).
   * @param settings - The current settings.
   * @param request - Who is asking.
   * @returns The updated user (unchanged if it wasn't suspended).
   */
  async liftSuspension(userId: string, adminUserId: string, settings: AuthSettings, request: RequestContext) {
    const user = await this.getUserOrThrow(userId);
    if (user.status !== ACCOUNT_STATUS.suspended) return user;
    await this.changeStatus(user, ACCOUNT_STATUS.suspended, this.statusAfterReturning(user, settings), { suspensionReason: null });
    user.suspensionReason = null;
    await this.events.record({ name: AUTH_EVENTS.userReactivated, userId, performedBy: PERFORMED_BY.admin(adminUserId), request });
    return user;
  }

  /**
   * The user switches their own account off for a while. Signs them out everywhere.
   * They can switch it back on by signing in again.
   *
   * @param userId - The signed-in user.
   * @param request - Who is asking (for the audit log).
   * @throws AuthError ACCOUNT_SUSPENDED when an admin has suspended the account.
   */
  async deactivateAccount(userId: string, request: RequestContext): Promise<void> {
    const user = await this.getUserOrThrow(userId);
    if (user.status === ACCOUNT_STATUS.suspended) throw new AuthError(AUTH_ERRORS.accountSuspended);
    if (user.status !== ACCOUNT_STATUS.deactivated) await this.changeStatus(user, user.status, ACCOUNT_STATUS.deactivated);
    await this.sessions.revokeAllSessions(userId, SESSION_END_REASON.accountDeactivated);
    await this.events.record({ name: AUTH_EVENTS.userDeactivated, userId, request });
  }

  /**
   * The user switches their account back on (after proving who they are, see SignInService).
   *
   * @param userId - The deactivated user.
   * @param settings - The current settings.
   * @param request - Who is asking (for the audit log).
   * @returns The updated user.
   * @throws AuthError ACCOUNT_NOT_DEACTIVATED when the account isn't deactivated.
   */
  async reactivateAccount(userId: string, settings: AuthSettings, request: RequestContext): Promise<UserEntity> {
    const user = await this.getUserOrThrow(userId);
    if (user.status !== ACCOUNT_STATUS.deactivated) throw new AuthError(AUTH_ERRORS.accountNotDeactivated);
    await this.changeStatus(user, ACCOUNT_STATUS.deactivated, this.statusAfterReturning(user, settings));
    await this.events.record({ name: AUTH_EVENTS.userReactivated, userId, request });
    return user;
  }

  /**
   * Deletes the account. The row stays (so ids in your other tables don't dangle and the audit log
   * still makes sense), but every piece of personal data and every way to sign in is wiped.
   * This cannot be undone.
   *
   * @param userId - The user to delete.
   * @param performedBy - Who did it, for the audit log (null when it was the user).
   * @param request - Who is asking.
   */
  async deleteUser(userId: string, performedBy: string | null, request: RequestContext): Promise<void> {
    const user = await this.getUserOrThrow(userId);
    const deletedUserFilter = { userId };

    await this.database.transaction(async (transaction) => {
      await transaction.update(
        UserEntity,
        { id: userId },
        typeormRow<UserEntity>({
          email: null,
          isEmailVerified: false,
          phoneNumber: null,
          isPhoneVerified: false,
          firstName: null,
          lastName: null,
          roles: [],
          metadata: {},
          isTwoFactorEnabled: false,
          suspensionReason: null,
          status: ACCOUNT_STATUS.deleted,
          statusChangedAt: new Date(),
        }),
      );
      const tablesWithUserRows: Array<new () => { userId: string | null }> = [
        PasswordEntity,
        SocialAccountEntity,
        PasskeyEntity,
        TwoFactorSecretEntity,
        BackupCodeEntity,
        SignInChallengeEntity,
        LinkTokenEntity,
        OrganizationMemberEntity,
      ];
      for (const table of tablesWithUserRows) await transaction.delete(table, deletedUserFilter);
      // Pending codes are keyed by where they were sent, not by user.
      const destinations = [user.email, user.phoneNumber].filter((value): value is string => !!value);
      for (const destination of destinations) await transaction.delete(OneTimeCodeEntity, { destination });
    });

    await this.sessions.revokeAllSessions(userId, SESSION_END_REASON.accountDeleted);
    await this.events.record({ name: AUTH_EVENTS.userDeleted, userId, performedBy, request });
  }

  // -------------------------------------------------------------------------------------------
  // Responses
  // -------------------------------------------------------------------------------------------

  /**
   * The user as your app may show it. Never includes secrets.
   *
   * @param user - The user.
   * @param settings - The current settings (to work out pending verifications).
   * @returns The profile to send to the client.
   */
  toPublicProfile(user: UserEntity, settings: AuthSettings): PublicUserProfile {
    return {
      id: user.id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
      phoneNumber: user.phoneNumber,
      isPhoneVerified: user.isPhoneVerified,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      status: user.status,
      pendingVerifications: this.getPendingVerifications(user, settings),
      onboardingCompleted: user.onboardingCompletedAt !== null,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      metadata: user.metadata,
      lastSignedInAt: user.lastSignedInAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  /**
   * Where a returning (unsuspended / reactivated) account lands: ACTIVE, unless verification is still owed.
   *
   * @param user - The returning user.
   * @param settings - The current settings.
   * @returns ACTIVE or PENDING_VERIFICATION.
   */
  private statusAfterReturning(user: UserEntity, settings: AuthSettings): AccountStatus {
    return this.getPendingVerifications(user, settings).length === 0 ? ACCOUNT_STATUS.active : ACCOUNT_STATUS.pendingVerification;
  }

  /**
   * Changes the status only if it is still `expectedStatus` (so two admins clicking at once can't
   * clash). Updates `user` in place.
   *
   * @param user - The user to change.
   * @param expectedStatus - The status the user must still have.
   * @param newStatus - The status to set.
   * @param extraColumns - Other columns to change in the same UPDATE.
   * @returns False if someone else changed it first.
   */
  private async changeStatus(
    user: UserEntity,
    expectedStatus: AccountStatus,
    newStatus: AccountStatus,
    extraColumns: Partial<UserEntity> = {},
  ): Promise<boolean> {
    const changedAt = new Date();
    const result = await this.database
      .getRepository(UserEntity)
      .update({ id: user.id, status: expectedStatus }, typeormRow<UserEntity>({ status: newStatus, statusChangedAt: changedAt, ...extraColumns }));
    if (!result.affected) return false;
    user.status = newStatus;
    user.statusChangedAt = changedAt;
    return true;
  }

  /**
   * @param error - An error thrown by the database.
   * @returns True when Postgres refused a duplicate value (e.g. an email that is already taken).
   */
  private isUniqueViolation(error: unknown): boolean {
    return error instanceof QueryFailedError && (error as QueryFailedError & { code?: string }).code === POSTGRES_UNIQUE_VIOLATION_CODE;
  }
}
