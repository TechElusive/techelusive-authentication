import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UsePipes } from '@nestjs/common';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { CheckSession, CurrentUser, CurrentUserId } from '@/guards/auth.decorators';
import { AccessTokenClaims } from '@/features/sessions/session.types';
import { SettingsService } from '@/features/settings/settings.service';
import {
  AcceptInvitationInput,
  ChangeMemberRoleInput,
  CreateOrganizationInput,
  InviteMemberInput,
  SwitchOrganizationInput,
  UpdateOrganizationInput,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';
import { ROUTES, ROUTE_PARAM } from '@/constants';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Shorthand for the pipe that rejects route ids that aren't UUIDs (with a 400, before any query runs).
 *
 * @returns A new ParseUUIDPipe.
 */
const uuid = () => new ParseUUIDPipe();

/**
 * Organizations / teams. Every route needs a signed-in user; roles are checked per organization.
 *
 *   GET    /auth/organizations                                   mine, with my role
 *   POST   /auth/organizations                                   create (I become owner)
 *   POST   /auth/organizations/switch                            work in an organization -> new access token
 *   POST   /auth/organizations/invitations/accept                accept an emailed invitation
 *   GET    /auth/organizations/:id                               details
 *   PATCH  /auth/organizations/:id                               rename etc. (admin+)
 *   DELETE /auth/organizations/:id                               delete (owner)
 *   GET    /auth/organizations/:id/members                       members
 *   PATCH  /auth/organizations/:id/members/:userId               change role (admin+)
 *   DELETE /auth/organizations/:id/members/:userId               remove member, or leave (own id)
 *   GET    /auth/organizations/:id/invitations                   open invitations (admin+)
 *   POST   /auth/organizations/:id/invitations                   invite by email (admin+)
 *   DELETE /auth/organizations/:id/invitations/:invitationId     cancel invitation (admin+)
 */
@Controller(ROUTES.organizations.prefix)
@LibraryController()
@UsePipes(strictValidationPipe)
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * GET /auth/organizations — The organizations the signed-in user belongs to, with their role.
   *
   * @param userId - From the access token.
   * @returns The organizations.
   */
  @Get()
  async listMine(@CurrentUserId() userId: string) {
    return { success: true, organizations: await this.organizations.listMyOrganizations(userId) };
  }

  /**
   * POST /auth/organizations — Creates an organization; the user becomes its owner.
   * App admins may create one even when `allowUsersToCreate` is off.
   *
   * @param user - The access token's claims (user id and roles).
   * @param body - `{ name, slug }`.
   * @param request - Who is asking.
   * @returns The new organization.
   */
  @Post()
  @CheckSession()
  async create(@CurrentUser() user: AccessTokenClaims, @Body() body: CreateOrganizationInput, @CurrentRequest() request: RequestContext) {
    const { adminRoles } = (await this.settingsService.getSettings()).admin;
    const isAppAdmin = adminRoles.some((role) => user.roles.includes(role));
    return { success: true, organization: await this.organizations.createOrganization(user.sub, body, isAppAdmin, request) };
  }

  /**
   * POST /auth/organizations/switch — Works in an organization from now on (or none).
   *
   * @param user - The access token's claims (user id and session id).
   * @param body - `{ organizationId }`, or null for none.
   * @returns A new access token carrying "org_id" and "org_role".
   */
  @Post(ROUTES.organizations.switch)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  switch(@CurrentUser() user: AccessTokenClaims, @Body() body: SwitchOrganizationInput) {
    return this.organizations.switchActiveOrganization(user.sub, user.sid, body.organizationId);
  }

  /**
   * POST /auth/organizations/invitations/accept — Accepts an emailed invitation.
   *
   * @param userId - From the access token.
   * @param body - `{ token }` from the invitation link.
   * @param request - Who is asking.
   * @returns The organization joined and the role given.
   */
  @Post(ROUTES.organizations.acceptInvitation)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@CurrentUserId() userId: string, @Body() body: AcceptInvitationInput, @CurrentRequest() request: RequestContext) {
    return this.organizations.acceptInvitation(userId, body.token, request);
  }

  /**
   * GET /auth/organizations/:organizationId — Details of one organization. Members only.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @returns The organization plus `myRole`.
   */
  @Get(ROUTES.organizations.organization)
  async get(@CurrentUserId() userId: string, @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string) {
    return { success: true, organization: await this.organizations.getOrganization(organizationId, userId) };
  }

  /**
   * PATCH /auth/organizations/:organizationId — Renames it, changes its slug or metadata. Admins and owners.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @param body - The fields to change.
   * @param request - Who is asking.
   * @returns The updated organization.
   */
  @Patch(ROUTES.organizations.organization)
  @CheckSession()
  async update(
    @CurrentUserId() userId: string,
    @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string,
    @Body() body: UpdateOrganizationInput,
    @CurrentRequest() request: RequestContext,
  ) {
    return { success: true, organization: await this.organizations.updateOrganization(organizationId, userId, body, request) };
  }

  /**
   * DELETE /auth/organizations/:organizationId — Deletes the organization. Owners only.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.organizations.organization)
  @CheckSession()
  delete(@CurrentUserId() userId: string, @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string, @CurrentRequest() request: RequestContext) {
    return this.organizations.deleteOrganization(organizationId, userId, request);
  }

  /**
   * GET /auth/organizations/:organizationId/members — Lists members. Members only.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @returns The members.
   */
  @Get(ROUTES.organizations.members)
  async listMembers(@CurrentUserId() userId: string, @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string) {
    return { success: true, members: await this.organizations.listMembers(organizationId, userId) };
  }

  /**
   * PATCH /auth/organizations/:organizationId/members/:memberUserId — Changes a member's role.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @param memberUserId - The member whose role changes (from the URL).
   * @param body - `{ role }`.
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Patch(ROUTES.organizations.member)
  @CheckSession()
  changeRole(
    @CurrentUserId() userId: string,
    @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string,
    @Param(ROUTE_PARAM.memberUserId, uuid()) memberUserId: string,
    @Body() body: ChangeMemberRoleInput,
    @CurrentRequest() request: RequestContext,
  ) {
    return this.organizations.changeMemberRole(organizationId, userId, memberUserId, body.role, request);
  }

  /**
   * DELETE /auth/organizations/:organizationId/members/:memberUserId — Removes a member,
   * or leaves when `memberUserId` is the signed-in user.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @param memberUserId - The member to remove (from the URL).
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.organizations.member)
  @CheckSession()
  removeMember(
    @CurrentUserId() userId: string,
    @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string,
    @Param(ROUTE_PARAM.memberUserId, uuid()) memberUserId: string,
    @CurrentRequest() request: RequestContext,
  ) {
    return this.organizations.removeMember(organizationId, userId, memberUserId, request);
  }

  /**
   * GET /auth/organizations/:organizationId/invitations — Open invitations. Admins and owners.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @returns The invitations.
   */
  @Get(ROUTES.organizations.invitations)
  async listInvitations(@CurrentUserId() userId: string, @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string) {
    return { success: true, invitations: await this.organizations.listInvitations(organizationId, userId) };
  }

  /**
   * POST /auth/organizations/:organizationId/invitations — Emails an invitation. Admins and owners.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @param body - `{ email, role }`.
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Post(ROUTES.organizations.invitations)
  @CheckSession()
  invite(
    @CurrentUserId() userId: string,
    @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string,
    @Body() body: InviteMemberInput,
    @CurrentRequest() request: RequestContext,
  ) {
    return this.organizations.inviteMember(organizationId, userId, body.email, body.role, request);
  }

  /**
   * DELETE /auth/organizations/:organizationId/invitations/:invitationId — Cancels an invitation.
   *
   * @param userId - From the access token.
   * @param organizationId - From the URL.
   * @param invitationId - From the URL.
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.organizations.invitation)
  @CheckSession()
  revokeInvitation(
    @CurrentUserId() userId: string,
    @Param(ROUTE_PARAM.organizationId, uuid()) organizationId: string,
    @Param(ROUTE_PARAM.invitationId, uuid()) invitationId: string,
  ) {
    return this.organizations.revokeInvitation(organizationId, userId, invitationId);
  }
}
