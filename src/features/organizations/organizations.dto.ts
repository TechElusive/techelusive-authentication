import { IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_ROLES,
  ORGANIZATION_SLUG_PATTERN,
  OrganizationRole,
  RANDOM_TOKEN_INPUT_MAX_LENGTH,
} from '@/constants';
import type { JsonObject } from '@/database/entities/json-object';

/** POST /auth/organizations */
export class CreateOrganizationInput {
  @IsString() @MaxLength(ORGANIZATION_NAME_MAX_LENGTH)
  name: string;

  /** Unique handle: lowercase letters, digits and dashes, e.g. "acme-india". */
  @IsString() @Matches(ORGANIZATION_SLUG_PATTERN)
  slug: string;
}

/** PATCH /auth/organizations/:organizationId */
export class UpdateOrganizationInput {
  @IsOptional() @IsString() @MaxLength(ORGANIZATION_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional() @IsString() @Matches(ORGANIZATION_SLUG_PATTERN)
  slug?: string;

  @IsOptional() @IsObject()
  metadata?: JsonObject;
}

/** POST /auth/organizations/:organizationId/invitations */
export class InviteMemberInput {
  @IsString() @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @IsIn(ORGANIZATION_ROLES)
  role: OrganizationRole;
}

/** PATCH /auth/organizations/:organizationId/members/:userId */
export class ChangeMemberRoleInput {
  @IsIn(ORGANIZATION_ROLES)
  role: OrganizationRole;
}

/** POST /auth/organizations/invitations/accept */
export class AcceptInvitationInput {
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  token: string;
}

/** POST /auth/organizations/switch. Send null to work outside any organization. */
export class SwitchOrganizationInput {
  @ValidateIf((input: SwitchOrganizationInput) => input.organizationId !== null)
  @IsUUID()
  organizationId: string | null;
}
