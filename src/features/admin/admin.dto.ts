import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACCOUNT_STATUSES,
  AccountStatus,
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_SCOPE_PATTERN,
  DISPLAY_NAME_MAX_LENGTH,
  MAXIMUM_API_KEY_SCOPES,
  MAXIMUM_PAGE_SIZE,
  MAXIMUM_ROLES_PER_USER,
  ROLE_NAME_PATTERN,
  SUSPENSION_REASON_MAX_LENGTH,
  WEBHOOK_DESCRIPTION_MAX_LENGTH,
  WEBHOOK_URL_MAX_LENGTH,
} from '@/constants';
import type { JsonObject } from '@/database/entities/json-object';

/** Query string of GET /auth/admin/users */
export class SearchUsersQuery {
  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  search?: string;

  @IsOptional() @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatus;

  @IsOptional() @IsString() @Matches(ROLE_NAME_PATTERN)
  role?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAXIMUM_PAGE_SIZE)
  pageSize?: number;
}

/** Query string of GET /auth/admin/audit-log */
export class SearchAuditLogQuery {
  @IsOptional() @IsUUID()
  userId?: string;

  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  eventName?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAXIMUM_PAGE_SIZE)
  pageSize?: number;
}

/** Query string for paged lists (webhook deliveries). */
export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAXIMUM_PAGE_SIZE)
  pageSize?: number;
}

/** PATCH /auth/admin/users/:userId */
export class AdminUpdateUserInput {
  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  lastName?: string;

  @IsOptional() @IsObject()
  metadata?: JsonObject;
}

/** PUT /auth/admin/users/:userId/roles */
export class SetRolesInput {
  @IsArray() @ArrayMaxSize(MAXIMUM_ROLES_PER_USER) @IsString({ each: true }) @Matches(ROLE_NAME_PATTERN, { each: true })
  roles: string[];
}

/** POST /auth/admin/users/:userId/suspend */
export class SuspendUserInput {
  /** Kept for support staff; not shown to the user. */
  @IsString() @MaxLength(SUSPENSION_REASON_MAX_LENGTH)
  reason: string;
}

/** POST /auth/admin/api-keys */
export class CreateApiKeyInput {
  @IsString() @MaxLength(API_KEY_NAME_MAX_LENGTH)
  name: string;

  /** What the key may do, e.g. ["rides:read"]. Your routes check them with @ApiKeyScopes(). */
  @IsArray() @ArrayMaxSize(MAXIMUM_API_KEY_SCOPES) @IsString({ each: true }) @Matches(API_KEY_SCOPE_PATTERN, { each: true })
  scopes: string[];

  @IsOptional() @IsUUID()
  organizationId?: string;

  /** Optional expiry, ISO 8601, e.g. "2027-01-01T00:00:00Z". */
  @IsOptional() @IsDateString()
  expiresAt?: string;
}

/** POST /auth/admin/webhooks */
export class CreateWebhookInput {
  @IsString() @MaxLength(WEBHOOK_URL_MAX_LENGTH)
  url: string;

  /** Events to receive, e.g. ["user.created"]. Leave empty for all events. */
  @IsOptional() @IsArray() @IsString({ each: true })
  eventNames?: string[];

  @IsOptional() @IsString() @MaxLength(WEBHOOK_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional() @IsBoolean()
  isEnabled?: boolean;
}

/** PATCH /auth/admin/webhooks/:webhookId */
export class UpdateWebhookInput {
  @IsOptional() @IsString() @MaxLength(WEBHOOK_URL_MAX_LENGTH)
  url?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  eventNames?: string[];

  @IsOptional() @IsString() @MaxLength(WEBHOOK_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional() @IsBoolean()
  isEnabled?: boolean;
}
