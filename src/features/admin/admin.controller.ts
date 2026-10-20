import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UsePipes } from '@nestjs/common';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { AdminOnly, CurrentUserId } from '@/guards/auth.decorators';
import { ApiKeysService } from '@/features/api-keys/api-keys.service';
import { DataRetentionService } from '@/features/maintenance/data-retention.service';
import { SessionService } from '@/features/sessions/session.service';
import { SettingsService } from '@/features/settings/settings.service';
import { SettingsChanges } from '@/features/settings/settings.types';
import { SigningKeysService } from '@/features/signing-keys/signing-keys.service';
import { TwoFactorService } from '@/features/two-factor/two-factor.service';
import { UsersService } from '@/features/users/users.service';
import { WebhooksService } from '@/features/webhooks/webhooks.service';
import {
  AdminUpdateUserInput,
  CreateApiKeyInput,
  CreateWebhookInput,
  PageQuery,
  SearchAuditLogQuery,
  SearchUsersQuery,
  SetRolesInput,
  SuspendUserInput,
  UpdateWebhookInput,
} from './admin.dto';
import { AdminService } from './admin.service';
import { PERFORMED_BY, ROUTES, ROUTE_PARAM, SESSION_END_REASON } from '@/constants';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Shorthand for the pipe that rejects route ids that aren't UUIDs (with a 400, before any query runs).
 *
 * @returns A new ParseUUIDPipe.
 */
const uuid = () => new ParseUUIDPipe();

/**
 * Admin API. Every route needs a user with one of settings.admin.adminRoles, and checks the
 * session live, so a demoted or signed-out admin loses access at once.
 *
 * Users
 *   GET    /auth/admin/users                      search (?search=&status=&role=&page=&pageSize=)
 *   GET    /auth/admin/users/:id                  details, sign-in methods, devices
 *   PATCH  /auth/admin/users/:id                  change name / app fields
 *   PUT    /auth/admin/users/:id/roles            replace roles
 *   POST   /auth/admin/users/:id/suspend          suspend with a reason (signs out everywhere)
 *   POST   /auth/admin/users/:id/unsuspend        lift a suspension
 *   POST   /auth/admin/users/:id/verify-email     mark email verified (support case)
 *   POST   /auth/admin/users/:id/reset-2fa        turn off 2FA (lost phone)
 *   POST   /auth/admin/users/:id/logout-all       sign out every device
 *   DELETE /auth/admin/users/:id                  delete account (permanent)
 * Settings
 *   GET    /auth/admin/settings                   settings in force
 *   PATCH  /auth/admin/settings                   change some settings at runtime
 *   DELETE /auth/admin/settings                   back to the settings in code
 * Security and operations
 *   GET    /auth/admin/audit-log                  security history (?userId=&eventName=)
 *   GET    /auth/admin/stats                      accounts by status, devices, last 24 hours
 *   POST   /auth/admin/maintenance/cleanup        delete old rows now (also runs hourly)
 *   POST   /auth/admin/signing-keys/rotate        new token signing key
 * API keys and webhooks
 *   GET/POST /auth/admin/api-keys, DELETE /auth/admin/api-keys/:id
 *   GET/POST /auth/admin/webhooks, PATCH/DELETE /auth/admin/webhooks/:id,
 *   POST /auth/admin/webhooks/:id/rotate-secret, POST /auth/admin/webhooks/:id/test,
 *   GET /auth/admin/webhooks/:id/deliveries, POST /auth/admin/webhooks/:id/deliveries/:deliveryId/retry
 */
@Controller(ROUTES.admin.prefix)
@LibraryController()
@AdminOnly()
@UsePipes(strictValidationPipe)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly settingsService: SettingsService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly signingKeys: SigningKeysService,
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: WebhooksService,
    private readonly dataRetention: DataRetentionService,
  ) {}

  // ---- Users ----------------------------------------------------------------------------------

  /**
   * GET /auth/admin/users — Searches users.
   *
   * @param query - `?search=&status=&role=&page=&pageSize=`.
   * @returns One page of users.
   */
  @Get(ROUTES.admin.users)
  searchUsers(@Query() query: SearchUsersQuery) {
    return this.admin.searchUsers(query);
  }

  /**
   * GET /auth/admin/users/:id — Details, sign-in methods and devices of one user.
   *
   * @param userId - The user to act on (from the URL).
   * @returns See `AdminService.getUserDetails`.
   */
  @Get(ROUTES.admin.user)
  getUser(@Param(ROUTE_PARAM.userId, uuid()) userId: string) {
    return this.admin.getUserDetails(userId);
  }

  /**
   * PATCH /auth/admin/users/:id — Changes the user's names or app fields.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param userId - The user to act on (from the URL).
   * @param body - The fields to change.
   * @param request - Who is asking.
   * @returns The user's updated public profile.
   */
  @Patch(ROUTES.admin.user)
  async updateUser(
    @CurrentUserId() adminUserId: string,
    @Param(ROUTE_PARAM.userId, uuid()) userId: string,
    @Body() body: AdminUpdateUserInput,
    @CurrentRequest() request: RequestContext,
  ) {
    const user = await this.users.updateProfile(userId, body, PERFORMED_BY.admin(adminUserId), request);
    return { success: true, user: this.users.toPublicProfile(user, await this.settingsService.getSettings()) };
  }

  /**
   * PUT /auth/admin/users/:id/roles — Replaces the user's roles.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param userId - The user to act on (from the URL).
   * @param body - `{ roles }`: the full new list.
   * @param request - Who is asking.
   * @returns The user's updated public profile.
   */
  @Put(ROUTES.admin.userRoles)
  async setRoles(
    @CurrentUserId() adminUserId: string,
    @Param(ROUTE_PARAM.userId, uuid()) userId: string,
    @Body() body: SetRolesInput,
    @CurrentRequest() request: RequestContext,
  ) {
    const user = await this.users.setRoles(userId, body.roles, adminUserId, request);
    return { success: true, user: this.users.toPublicProfile(user, await this.settingsService.getSettings()) };
  }

  /**
   * POST /auth/admin/users/:id/suspend — Suspends the account and signs the user out everywhere.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param userId - The user to act on (from the URL).
   * @param body - `{ reason }`.
   * @param request - Who is asking.
   * @returns The user's updated public profile.
   */
  @Post(ROUTES.admin.userSuspend)
  @HttpCode(HttpStatus.OK)
  async suspendUser(
    @CurrentUserId() adminUserId: string,
    @Param(ROUTE_PARAM.userId, uuid()) userId: string,
    @Body() body: SuspendUserInput,
    @CurrentRequest() request: RequestContext,
  ) {
    const user = await this.users.suspendUser(userId, body.reason, adminUserId, request);
    return { success: true, user: this.users.toPublicProfile(user, await this.settingsService.getSettings()) };
  }

  /**
   * POST /auth/admin/users/:id/unsuspend — Lifts a suspension.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param userId - The user to act on (from the URL).
   * @param request - Who is asking.
   * @returns The user's updated public profile.
   */
  @Post(ROUTES.admin.userUnsuspend)
  @HttpCode(HttpStatus.OK)
  async unsuspendUser(@CurrentUserId() adminUserId: string, @Param(ROUTE_PARAM.userId, uuid()) userId: string, @CurrentRequest() request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const user = await this.users.liftSuspension(userId, adminUserId, settings, request);
    return { success: true, user: this.users.toPublicProfile(user, settings) };
  }

  /**
   * POST /auth/admin/users/:id/verify-email — Marks the email verified (support case).
   *
   * @param userId - The user to act on (from the URL).
   * @param request - Who is asking.
   * @returns The user's updated public profile.
   */
  @Post(ROUTES.admin.userVerifyEmail)
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Param(ROUTE_PARAM.userId, uuid()) userId: string, @CurrentRequest() request: RequestContext) {
    const settings = await this.settingsService.getSettings();
    const user = await this.users.markEmailVerified(await this.users.getUserOrThrow(userId), settings, request);
    return { success: true, user: this.users.toPublicProfile(user, settings) };
  }

  /**
   * POST /auth/admin/users/:id/reset-2fa — Turns off 2FA for a user who lost their phone.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param userId - The user to act on (from the URL).
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Post(ROUTES.admin.userResetTwoFactor)
  @HttpCode(HttpStatus.OK)
  resetTwoFactor(@CurrentUserId() adminUserId: string, @Param(ROUTE_PARAM.userId, uuid()) userId: string, @CurrentRequest() request: RequestContext) {
    return this.twoFactor.resetForUser(userId, adminUserId, request);
  }

  /**
   * POST /auth/admin/users/:id/logout-all — Signs the user out on every device.
   *
   * @param userId - The user to act on (from the URL).
   * @returns How many sessions were ended.
   */
  @Post(ROUTES.admin.userLogoutAll)
  @HttpCode(HttpStatus.OK)
  async signOutUserEverywhere(@Param(ROUTE_PARAM.userId, uuid()) userId: string) {
    return { success: true, endedSessions: await this.sessions.revokeAllSessions(userId, SESSION_END_REASON.signedOutByAdmin) };
  }

  /**
   * DELETE /auth/admin/users/:id — Deletes the account. This cannot be undone.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param userId - The user to act on (from the URL).
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.admin.user)
  async deleteUser(@CurrentUserId() adminUserId: string, @Param(ROUTE_PARAM.userId, uuid()) userId: string, @CurrentRequest() request: RequestContext) {
    await this.users.deleteUser(userId, PERFORMED_BY.admin(adminUserId), request);
    return { success: true };
  }

  // ---- Settings -------------------------------------------------------------------------------

  /**
   * GET /auth/admin/settings — The settings in force.
   *
   * @returns The full settings.
   */
  @Get(ROUTES.admin.settings)
  getSettings() {
    return this.admin.getSettings();
  }

  /**
   * PATCH /auth/admin/settings — Changes some settings at runtime.
   * The body is checked against the settings rules by SettingsService (unknown fields are refused there).
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param body - Only the sections and fields to change.
   * @param request - Who is asking.
   * @returns The settings now in force.
   */
  @Patch(ROUTES.admin.settings)
  changeSettings(@CurrentUserId() adminUserId: string, @Body() body: SettingsChanges, @CurrentRequest() request: RequestContext) {
    return this.admin.changeSettings(body, adminUserId, request);
  }

  /**
   * DELETE /auth/admin/settings — Discards admin changes, back to the settings in code.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param request - Who is asking.
   * @returns The settings now in force.
   */
  @Delete(ROUTES.admin.settings)
  resetSettings(@CurrentUserId() adminUserId: string, @CurrentRequest() request: RequestContext) {
    return this.admin.resetSettings(adminUserId, request);
  }

  // ---- Security -------------------------------------------------------------------------------

  /**
   * GET /auth/admin/audit-log — Security history, newest first.
   *
   * @param query - `?userId=&eventName=&page=&pageSize=`.
   * @returns One page of entries.
   */
  @Get(ROUTES.admin.auditLog)
  searchAuditLog(@Query() query: SearchAuditLogQuery) {
    return this.admin.searchAuditLog(query);
  }

  /**
   * GET /auth/admin/stats — Accounts by status, signed-in devices, last 24 hours.
   *
   * @returns See `AdminService.getStats`.
   */
  @Get(ROUTES.admin.stats)
  getStats() {
    return this.admin.getStats();
  }

  /**
   * POST /auth/admin/maintenance/cleanup — Runs the data-retention cleanup now
   * (it also runs every hour by itself).
   *
   * @returns How many rows were removed from each table.
   */
  @Post(ROUTES.admin.runCleanup)
  @HttpCode(HttpStatus.OK)
  async runCleanup() {
    return { success: true, removed: await this.dataRetention.runCleanup() };
  }

  /**
   * POST /auth/admin/signing-keys/rotate — Creates a new token signing key.
   * Tokens signed with the old key keep working until they expire.
   *
   * @returns `{ success: true }`.
   */
  @Post(ROUTES.admin.rotateSigningKey)
  @HttpCode(HttpStatus.OK)
  async rotateSigningKey() {
    await this.signingKeys.rotateSigningKey();
    return { success: true };
  }

  // ---- API keys -------------------------------------------------------------------------------

  /**
   * GET /auth/admin/api-keys — Lists API keys (never the secret part).
   *
   * @returns The API keys.
   */
  @Get(ROUTES.admin.apiKeys)
  async listApiKeys() {
    return { success: true, apiKeys: await this.apiKeys.listApiKeys() };
  }

  /**
   * POST /auth/admin/api-keys — Creates an API key. The key itself is shown only in this response.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param body - Name, scopes and optional expiry date.
   * @param request - Who is asking.
   * @returns The new key's details and the plain key.
   */
  @Post(ROUTES.admin.apiKeys)
  async createApiKey(@CurrentUserId() adminUserId: string, @Body() body: CreateApiKeyInput, @CurrentRequest() request: RequestContext) {
    const created = await this.apiKeys.createApiKey(
      { ...body, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null },
      adminUserId,
      request,
    );
    return { success: true, ...created };
  }

  /**
   * DELETE /auth/admin/api-keys/:id — Revokes an API key; it stops working at once.
   *
   * @param adminUserId - The signed-in admin (for the audit log).
   * @param apiKeyId - The key (from the URL).
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.admin.apiKey)
  async revokeApiKey(@CurrentUserId() adminUserId: string, @Param(ROUTE_PARAM.apiKeyId, uuid()) apiKeyId: string, @CurrentRequest() request: RequestContext) {
    await this.apiKeys.revokeApiKey(apiKeyId, adminUserId, request);
    return { success: true };
  }

  // ---- Webhooks -------------------------------------------------------------------------------

  /**
   * GET /auth/admin/webhooks — Lists webhooks.
   *
   * @returns The webhooks.
   */
  @Get(ROUTES.admin.webhooks)
  async listWebhooks() {
    return { success: true, webhooks: await this.webhooks.listWebhooks() };
  }

  /**
   * POST /auth/admin/webhooks — Adds a webhook. The signing secret is shown only in this response.
   *
   * @param body - URL, events, description and whether it is on.
   * @returns The webhook and its signing secret.
   */
  @Post(ROUTES.admin.webhooks)
  createWebhook(@Body() body: CreateWebhookInput) {
    return this.webhooks.createWebhook(body);
  }

  /**
   * PATCH /auth/admin/webhooks/:id — Changes a webhook's URL, events, description or on/off state.
   *
   * @param webhookId - The webhook (from the URL).
   * @param body - The fields to change.
   * @returns The updated webhook.
   */
  @Patch(ROUTES.admin.webhook)
  updateWebhook(@Param(ROUTE_PARAM.webhookId, uuid()) webhookId: string, @Body() body: UpdateWebhookInput) {
    return this.webhooks.updateWebhook(webhookId, body);
  }

  /**
   * DELETE /auth/admin/webhooks/:id — Deletes a webhook and its delivery history.
   *
   * @param webhookId - The webhook (from the URL).
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.admin.webhook)
  deleteWebhook(@Param(ROUTE_PARAM.webhookId, uuid()) webhookId: string) {
    return this.webhooks.deleteWebhook(webhookId);
  }

  /**
   * POST /auth/admin/webhooks/:id/rotate-secret — Replaces the signing secret.
   *
   * @param webhookId - The webhook (from the URL).
   * @returns The new signing secret (shown only once).
   */
  @Post(ROUTES.admin.webhookRotateSecret)
  @HttpCode(HttpStatus.OK)
  rotateWebhookSecret(@Param(ROUTE_PARAM.webhookId, uuid()) webhookId: string) {
    return this.webhooks.rotateSigningSecret(webhookId);
  }

  /**
   * POST /auth/admin/webhooks/:id/test — Sends a test event to the webhook.
   *
   * @param webhookId - The webhook (from the URL).
   * @returns `{ success: true }`; the worker sends it within seconds.
   */
  @Post(ROUTES.admin.webhookTest)
  @HttpCode(HttpStatus.OK)
  sendTestDelivery(@Param(ROUTE_PARAM.webhookId, uuid()) webhookId: string) {
    return this.webhooks.sendTestDelivery(webhookId);
  }

  /**
   * GET /auth/admin/webhooks/:id/deliveries — Delivery history, newest first.
   *
   * @param webhookId - The webhook (from the URL).
   * @param query - `?page=&pageSize=`.
   * @returns One page of deliveries.
   */
  @Get(ROUTES.admin.webhookDeliveries)
  listDeliveries(@Param(ROUTE_PARAM.webhookId, uuid()) webhookId: string, @Query() query: PageQuery) {
    return this.webhooks.listDeliveries(webhookId, query.page, query.pageSize);
  }

  /**
   * POST /auth/admin/webhooks/:id/deliveries/:deliveryId/retry — Sends a failed delivery again.
   *
   * @param webhookId - The webhook (from the URL).
   * @param deliveryId - The delivery (from the URL).
   * @returns `{ success: true }`; the worker sends it within seconds.
   */
  @Post(ROUTES.admin.webhookRetryDelivery)
  @HttpCode(HttpStatus.OK)
  retryDelivery(@Param(ROUTE_PARAM.webhookId, uuid()) webhookId: string, @Param(ROUTE_PARAM.deliveryId, uuid()) deliveryId: string) {
    return this.webhooks.retryDelivery(webhookId, deliveryId);
  }
}
