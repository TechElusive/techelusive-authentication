import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, QueryFailedError } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { createRandomToken, hasRandomTokenFormat, sha256Hex } from '@/common/crypto/random-secrets';
import { normalizeEmail } from '@/common/identifiers';
import { RequestContext } from '@/common/request-context';
import {
  DAY_IN_SECONDS,
  AuthErrorDefinition,
  AUTH_ERRORS,
  AUTH_EVENTS,
  AUTH_OPTIONS_TOKEN,
  DISPLAY_NAME_SEPARATOR,
  EMAIL_TYPE,
  MAXIMUM_ORGANIZATIONS_PER_USER,
  OrganizationRole,
  ORGANIZATION_ROLE,
  ORGANIZATION_ROLE_RANK,
  PERFORMED_BY,
  POSTGRES_UNIQUE_VIOLATION_CODE,
  SECOND_IN_MILLISECONDS,
  SORT_ORDER,
  TOKEN_PREFIX,
  VALIDATION_PROBLEM,
} from '@/constants';
import {
  OrganizationEntity,
  OrganizationInvitationEntity,
  OrganizationMemberEntity,
  UserEntity,
} from '@/database/entities';
import { AuthEventsService } from '@/features/events/auth-events.service';
import { NotificationsService } from '@/features/notifications/notifications.service';
import { SessionService } from '@/features/sessions/session.service';
import { SettingsService } from '@/features/settings/settings.service';
import type { JsonObject } from '@/database/entities/json-object';

export interface OrganizationChanges {
  name?: string;
  slug?: string;
  metadata?: JsonObject;
}

/**
 * Organizations (companies, teams, workspaces) and their members.
 *
 * Roles inside an organization:
 *   owner  - everything, including deleting the organization and managing other owners
 *   admin  - manage members and invitations (but not owners)
 *   member - belongs to the organization
 *
 * A user picks the organization they are working in with switchActiveOrganization(); their access
 * token then carries "org_id" and "org_role", so your API can scope data with one check.
 */
@Injectable()
export class OrganizationsService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationsService,
    private readonly events: AuthEventsService,
  ) {
    this.database = options.dataSource;
  }

  // -------------------------------------------------------------------------------------------
  // Organizations
  // -------------------------------------------------------------------------------------------

  /**
   * Creates an organization; the creator becomes its owner.
   *
   * @param userId - The creator.
   * @param details - Name and URL-friendly slug.
   * @param isAppAdmin - Lets app admins create one even when users may not.
   * @param request - Who is asking (for the audit log).
   * @returns The new organization.
   * @throws AuthError FORBIDDEN when users may not create organizations.
   * @throws AuthError ORGANIZATION_SLUG_TAKEN when the slug is in use.
   * @throws AuthError VALIDATION_ERROR when the user is already in too many organizations.
   */
  async createOrganization(userId: string, details: Required<Pick<OrganizationChanges, 'name' | 'slug'>>, isAppAdmin: boolean, request: RequestContext) {
    const settings = await this.assertOrganizationsEnabled();
    if (!settings.organizations.allowUsersToCreate && !isAppAdmin) throw new AuthError(AUTH_ERRORS.forbidden);
    const membershipCount = await this.database.getRepository(OrganizationMemberEntity).count({ where: { userId } });
    if (membershipCount >= MAXIMUM_ORGANIZATIONS_PER_USER) throw new AuthError(AUTH_ERRORS.validationFailed, { problems: [VALIDATION_PROBLEM.tooManyOrganizations] });

    const organization = await this.database.transaction(async (transaction) => {
      const createdOrganization = await this.translateUniqueViolation(
        transaction.save(OrganizationEntity, { name: details.name.trim(), slug: details.slug, metadata: {}, createdByUserId: userId }),
        AUTH_ERRORS.organizationSlugTaken,
      );
      await transaction.insert(OrganizationMemberEntity, { organizationId: createdOrganization.id, userId, role: ORGANIZATION_ROLE.owner });
      return createdOrganization;
    });
    await this.events.record({ name: AUTH_EVENTS.organizationCreated, userId, request, details: { organizationId: organization.id } });
    return organization;
  }

  /**
   * The organizations the user belongs to, with their role in each.
   *
   * @param userId - The signed-in user.
   * @returns The organizations, sorted by name.
   */
  async listMyOrganizations(userId: string) {
    const rows: Array<Record<string, any>> = await this.database.query(
      `SELECT o.id, o.name, o.slug, o.metadata, m.role, m.created_at AS joined_at
         FROM auth_organization_members m
         JOIN auth_organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1
        ORDER BY o.name`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      metadata: row.metadata,
      role: row.role as OrganizationRole,
      joinedAt: new Date(row.joined_at).toISOString(),
    }));
  }

  /**
   * @param organizationId - The organization.
   * @param userId - The signed-in user, who must be a member.
   * @returns The organization plus `myRole`.
   * @throws AuthError NOT_FOUND when it doesn't exist or the user isn't a member.
   */
  async getOrganization(organizationId: string, userId: string) {
    const membership = await this.requireRole(organizationId, userId, ORGANIZATION_ROLE.member);
    const organization = await this.database.getRepository(OrganizationEntity).findOne({ where: { id: organizationId } });
    if (!organization) throw new AuthError(AUTH_ERRORS.notFound);
    return { ...organization, myRole: membership.role };
  }

  /**
   * Changes the name, slug or metadata. Admins and owners only.
   *
   * @param organizationId - The organization.
   * @param userId - The signed-in user.
   * @param changes - The fields to change.
   * @param request - Who is asking (for the audit log).
   * @returns The updated organization.
   * @throws AuthError FORBIDDEN for plain members.
   * @throws AuthError ORGANIZATION_SLUG_TAKEN when the new slug is in use.
   */
  async updateOrganization(organizationId: string, userId: string, changes: OrganizationChanges, request: RequestContext) {
    await this.requireRole(organizationId, userId, ORGANIZATION_ROLE.admin);
    const repository = this.database.getRepository(OrganizationEntity);
    const organization = await repository.findOne({ where: { id: organizationId } });
    if (!organization) throw new AuthError(AUTH_ERRORS.notFound);

    if (changes.name !== undefined) organization.name = changes.name.trim();
    if (changes.slug !== undefined) organization.slug = changes.slug;
    if (changes.metadata !== undefined) organization.metadata = changes.metadata;
    const savedOrganization = await this.translateUniqueViolation(repository.save(organization), AUTH_ERRORS.organizationSlugTaken);
    await this.events.record({ name: AUTH_EVENTS.organizationUpdated, userId, request, details: { organizationId } });
    return savedOrganization;
  }

  /**
   * Deletes the organization. Owners only. Members, invitations and API keys of the organization go with it.
   *
   * @param organizationId - The organization.
   * @param userId - The signed-in user.
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError FORBIDDEN unless the user is an owner.
   */
  async deleteOrganization(organizationId: string, userId: string, request: RequestContext) {
    await this.requireRole(organizationId, userId, ORGANIZATION_ROLE.owner);
    await this.database.getRepository(OrganizationEntity).delete({ id: organizationId });
    await this.events.record({ name: AUTH_EVENTS.organizationDeleted, userId, request, details: { organizationId } });
    return { success: true as const };
  }

  // -------------------------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------------------------

  /**
   * @param organizationId - The organization.
   * @param userId - The signed-in user, who must be a member.
   * @returns The members with their names, emails and roles, oldest first.
   */
  async listMembers(organizationId: string, userId: string) {
    await this.requireRole(organizationId, userId, ORGANIZATION_ROLE.member);
    const rows: Array<Record<string, any>> = await this.database.query(
      `SELECT u.id AS user_id, u.email, u.first_name, u.last_name, m.role, m.created_at AS joined_at
         FROM auth_organization_members m
         JOIN auth_users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY m.created_at`,
      [organizationId],
    );
    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role as OrganizationRole,
      joinedAt: new Date(row.joined_at).toISOString(),
    }));
  }

  /**
   * Changes a member's role. Admins manage members and admins; only owners can make or unmake owners.
   *
   * @param organizationId - The organization.
   * @param actorUserId - The signed-in user doing it.
   * @param targetUserId - The member whose role changes.
   * @param newRole - "owner", "admin" or "member".
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError FORBIDDEN when the actor may not make this change.
   * @throws AuthError LAST_OWNER when this would leave the organization without an owner.
   */
  async changeMemberRole(organizationId: string, actorUserId: string, targetUserId: string, newRole: OrganizationRole, request: RequestContext) {
    const actor = await this.requireRole(organizationId, actorUserId, ORGANIZATION_ROLE.admin);
    const target = await this.findMembership(organizationId, targetUserId);
    if (!target) throw new AuthError(AUTH_ERRORS.notFound);
    this.assertMayManage(actor.role, target.role, newRole);
    if (target.role === ORGANIZATION_ROLE.owner && newRole !== ORGANIZATION_ROLE.owner) await this.assertNotLastOwner(organizationId);

    await this.database.getRepository(OrganizationMemberEntity).update({ id: target.id }, { role: newRole });
    await this.events.record({
      name: AUTH_EVENTS.organizationMemberRoleChanged,
      userId: targetUserId,
      performedBy: PERFORMED_BY.user(actorUserId),
      request,
      details: { organizationId, previousRole: target.role, role: newRole },
    });
    return { success: true as const };
  }

  /**
   * Removes a member. Anyone may leave by removing themselves (unless they are the last owner).
   * The member's devices stop working in this organization.
   *
   * @param organizationId - The organization.
   * @param actorUserId - The signed-in user doing it.
   * @param targetUserId - The member to remove (the actor themselves to leave).
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError FORBIDDEN when the actor may not remove this member.
   * @throws AuthError LAST_OWNER when removing the last owner.
   */
  async removeMember(organizationId: string, actorUserId: string, targetUserId: string, request: RequestContext) {
    const target = await this.findMembership(organizationId, targetUserId);
    if (!target) throw new AuthError(AUTH_ERRORS.notFound);
    if (actorUserId !== targetUserId) {
      const actor = await this.requireRole(organizationId, actorUserId, ORGANIZATION_ROLE.admin);
      this.assertMayManage(actor.role, target.role, target.role);
    }
    if (target.role === ORGANIZATION_ROLE.owner) await this.assertNotLastOwner(organizationId);

    await this.database.getRepository(OrganizationMemberEntity).delete({ id: target.id });
    await this.clearActiveOrganization(targetUserId, organizationId);
    await this.events.record({
      name: AUTH_EVENTS.organizationMemberRemoved,
      userId: targetUserId,
      performedBy: PERFORMED_BY.user(actorUserId),
      request,
      details: { organizationId },
    });
    return { success: true as const };
  }

  // -------------------------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------------------------

  /**
   * Emails an invitation link. The invited person accepts it after signing in with that email.
   * A new invitation replaces any open one for the same email.
   *
   * @param organizationId - The organization.
   * @param actorUserId - The signed-in user doing it.
   * @param typedEmail - Who to invite.
   * @param role - The role they get when they accept.
   * @param request - Who is asking (for the audit log).
   * @returns `{ success: true }`.
   * @throws AuthError FORBIDDEN for plain members, or when an admin tries to invite an owner.
   */
  async inviteMember(organizationId: string, actorUserId: string, typedEmail: unknown, role: OrganizationRole, request: RequestContext) {
    const settings = await this.assertOrganizationsEnabled();
    const actor = await this.requireRole(organizationId, actorUserId, ORGANIZATION_ROLE.admin);
    this.assertMayManage(actor.role, ORGANIZATION_ROLE.member, role);
    const email = normalizeEmail(typedEmail);

    const organization = await this.database.getRepository(OrganizationEntity).findOneOrFail({ where: { id: organizationId } });
    const inviter = await this.database.getRepository(UserEntity).findOne({ where: { id: actorUserId } });
    const { plainToken, tokenHash } = createRandomToken(TOKEN_PREFIX.organizationInvitation);

    await this.database.transaction(async (transaction) => {
      // A new invitation replaces any open one for the same email.
      await transaction.update(
        OrganizationInvitationEntity,
        { organizationId, email, acceptedAt: IsNull(), revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      await transaction.insert(OrganizationInvitationEntity, {
        organizationId,
        email,
        role,
        tokenHash,
        invitedByUserId: actorUserId,
        expiresAt: new Date(Date.now() + settings.organizations.invitationExpiresInDays * DAY_IN_SECONDS * SECOND_IN_MILLISECONDS),
      });
    });

    await this.notifications.sendRequiredEmail({
      type: EMAIL_TYPE.organizationInvitation,
      to: email,
      token: plainToken,
      organizationName: organization.name,
      invitedByName: [inviter?.firstName, inviter?.lastName].filter(Boolean).join(DISPLAY_NAME_SEPARATOR) || null,
    });
    await this.events.record({
      name: AUTH_EVENTS.organizationInvitationSent,
      userId: actorUserId,
      request,
      details: { organizationId, role },
    });
    return { success: true as const };
  }

  /**
   * @param organizationId - The organization.
   * @param actorUserId - The signed-in user, who must be an admin or owner.
   * @returns Open invitations (not accepted or revoked), newest first, without their token hashes.
   */
  async listInvitations(organizationId: string, actorUserId: string) {
    await this.requireRole(organizationId, actorUserId, ORGANIZATION_ROLE.admin);
    const invitations = await this.database.getRepository(OrganizationInvitationEntity).find({
      where: { organizationId, acceptedAt: IsNull(), revokedAt: IsNull() },
      order: { createdAt: SORT_ORDER.newestFirst },
    });
    return invitations.map(({ tokenHash: _hiddenHash, ...invitation }) => invitation);
  }

  /**
   * Cancels an open invitation; its link stops working.
   *
   * @param organizationId - The organization.
   * @param actorUserId - The signed-in user doing it.
   * @param invitationId - The invitation.
   * @returns `{ success: true }`.
   * @throws AuthError NOT_FOUND when there is no open invitation with this id.
   */
  async revokeInvitation(organizationId: string, actorUserId: string, invitationId: string) {
    await this.requireRole(organizationId, actorUserId, ORGANIZATION_ROLE.admin);
    const result = await this.database
      .getRepository(OrganizationInvitationEntity)
      .update({ id: invitationId, organizationId, acceptedAt: IsNull(), revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!result.affected) throw new AuthError(AUTH_ERRORS.notFound);
    return { success: true as const };
  }

  /**
   * Accepts an invitation. The signed-in user's VERIFIED email must be the invited email, so a
   * forwarded or leaked link can't be used by someone else.
   *
   * @param userId - The signed-in user.
   * @param invitationToken - The token from the invitation link.
   * @param request - Who is asking (for the audit log).
   * @returns The organization joined and the role given.
   * @throws AuthError INVALID_TOKEN when the link is unknown, used, expired or for another email.
   * @throws AuthError ALREADY_MEMBER when the user is already in the organization.
   */
  async acceptInvitation(userId: string, invitationToken: unknown, request: RequestContext) {
    await this.assertOrganizationsEnabled();
    if (!hasRandomTokenFormat(invitationToken, TOKEN_PREFIX.organizationInvitation)) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
    const invitations = this.database.getRepository(OrganizationInvitationEntity);
    const invitation = await invitations.findOne({
      where: { tokenHash: sha256Hex(invitationToken), acceptedAt: IsNull(), revokedAt: IsNull() },
    });
    if (!invitation || invitation.expiresAt.getTime() <= Date.now()) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);

    const user = await this.database.getRepository(UserEntity).findOne({ where: { id: userId } });
    if (!user || user.email !== invitation.email || !user.isEmailVerified) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);

    await this.database.transaction(async (transaction) => {
      const claimed = await transaction.update(
        OrganizationInvitationEntity,
        { id: invitation.id, acceptedAt: IsNull() },
        { acceptedAt: new Date() },
      );
      if (!claimed.affected) throw new AuthError(AUTH_ERRORS.invalidOrExpiredLink);
      await this.translateUniqueViolation(
        transaction.insert(OrganizationMemberEntity, { organizationId: invitation.organizationId, userId, role: invitation.role }),
        AUTH_ERRORS.alreadyOrganizationMember,
      );
    });
    await this.events.record({
      name: AUTH_EVENTS.organizationMemberAdded,
      userId,
      request,
      details: { organizationId: invitation.organizationId, role: invitation.role },
    });
    return { success: true as const, organizationId: invitation.organizationId, role: invitation.role };
  }

  // -------------------------------------------------------------------------------------------
  // Active organization
  // -------------------------------------------------------------------------------------------

  /**
   * Picks the organization this device works in. The new access token carries "org_id" and "org_role".
   *
   * @param userId - The signed-in user.
   * @param sessionId - This device's session.
   * @param organizationId - The organization to switch to, or null for none.
   * @returns A new access token and its lifetime.
   * @throws AuthError NOT_FOUND when the user isn't a member of that organization.
   */
  async switchActiveOrganization(userId: string, sessionId: string, organizationId: string | null) {
    const settings = await this.assertOrganizationsEnabled();
    if (organizationId) await this.requireRole(organizationId, userId, ORGANIZATION_ROLE.member);
    const { accessToken, expiresIn } = await this.sessions.switchActiveOrganization(sessionId, organizationId, settings);
    return { success: true as const, accessToken, expiresIn, organizationId };
  }

  // -------------------------------------------------------------------------------------------

  /**
   * @returns The current settings.
   * @throws AuthError FEATURE_DISABLED when organizations are turned off.
   */
  private async assertOrganizationsEnabled() {
    const settings = await this.settingsService.getSettings();
    if (!settings.organizations.enabled) throw new AuthError(AUTH_ERRORS.featureDisabled);
    return settings;
  }

  /**
   * @param organizationId - The organization.
   * @param userId - The user.
   * @returns The membership row, or null if the user isn't a member.
   */
  private findMembership(organizationId: string, userId: string) {
    return this.database.getRepository(OrganizationMemberEntity).findOne({ where: { organizationId, userId } });
  }

  /**
   * Checks that the user is a member with at least `minimumRole` (owner > admin > member).
   *
   * @param organizationId - The organization.
   * @param userId - The user.
   * @param minimumRole - The lowest role allowed.
   * @returns The user's membership.
   * @throws AuthError NOT_FOUND when the user is not a member (so outsiders can't probe which organizations exist).
   * @throws AuthError FORBIDDEN when their role is too low.
   */
  private async requireRole(organizationId: string, userId: string, minimumRole: OrganizationRole) {
    await this.assertOrganizationsEnabled();
    const membership = await this.findMembership(organizationId, userId);
    // "Not found" rather than "forbidden", so outsiders can't probe which organizations exist.
    if (!membership) throw new AuthError(AUTH_ERRORS.notFound);
    if (ORGANIZATION_ROLE_RANK[membership.role] < ORGANIZATION_ROLE_RANK[minimumRole]) throw new AuthError(AUTH_ERRORS.forbidden);
    return membership;
  }

  /**
   * Admins may act on members and admins; anything touching an owner needs an owner.
   *
   * @param actorRole - The role of the user making the change.
   * @param currentRole - The target's role now.
   * @param newRole - The target's role after the change.
   * @throws AuthError FORBIDDEN when the actor may not make this change.
   */
  private assertMayManage(actorRole: OrganizationRole, currentRole: OrganizationRole, newRole: OrganizationRole) {
    const touchesOwner = currentRole === ORGANIZATION_ROLE.owner || newRole === ORGANIZATION_ROLE.owner;
    if (touchesOwner && actorRole !== ORGANIZATION_ROLE.owner) throw new AuthError(AUTH_ERRORS.forbidden);
  }

  /**
   * @param organizationId - The organization.
   * @throws AuthError LAST_OWNER when the organization has only one owner left.
   */
  private async assertNotLastOwner(organizationId: string) {
    const ownerCount = await this.database.getRepository(OrganizationMemberEntity).count({ where: { organizationId, role: ORGANIZATION_ROLE.owner } });
    if (ownerCount <= 1) throw new AuthError(AUTH_ERRORS.lastOrganizationOwner);
  }

  /**
   * A removed member's devices stop working in that organization.
   *
   * @param userId - The removed member.
   * @param organizationId - The organization they left.
   */
  private async clearActiveOrganization(userId: string, organizationId: string) {
    await this.database.query(
      `UPDATE auth_sessions SET active_organization_id = NULL WHERE user_id = $1 AND active_organization_id = $2`,
      [userId, organizationId],
    );
  }

  /**
   * Runs a database write and turns a "duplicate value" error into a friendly AuthError.
   *
   * @param operation - The write to wait for.
   * @param errorOnDuplicate - The error to throw when Postgres refuses a duplicate.
   * @returns What the write returned.
   * @throws AuthError `errorOnDuplicate` on a duplicate; any other error is re-thrown as is.
   */
  private async translateUniqueViolation<T>(operation: Promise<T>, errorOnDuplicate: AuthErrorDefinition): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      const code = (error as QueryFailedError & { code?: string }).code;
      if (error instanceof QueryFailedError && code === POSTGRES_UNIQUE_VIOLATION_CODE) throw new AuthError(errorOnDuplicate);
      throw error;
    }
  }
}
