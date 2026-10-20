import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { DISPLAY_NAME_MAX_LENGTH, RANDOM_TOKEN_INPUT_MAX_LENGTH } from '@/constants';
import type { JsonObject } from '@/database/entities/json-object';

/** POST /auth/refresh. Leave refreshToken out when it lives in the cookie (AuthOptions.refreshTokenCookie). */
export class RefreshTokenInput {
  @IsOptional() @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  refreshToken?: string;
}

/** POST /auth/reactivate */
export class ReactivateAccountInput {
  /** The reactivationToken from the ACCOUNT_DEACTIVATED sign-in response. */
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  reactivationToken: string;
}

/** PATCH /auth/me. Users may change their name and app fields, never their roles or status. */
export class UpdateMyProfileInput {
  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  lastName?: string;

  @IsOptional() @IsObject()
  metadata?: JsonObject;
}
