import { IsOptional, IsString, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, RANDOM_TOKEN_INPUT_MAX_LENGTH } from '@/constants';

/** POST /auth/email/change */
export class RequestEmailChangeInput {
  @IsString() @MaxLength(EMAIL_MAX_LENGTH)
  newEmail: string;

  /** Required when the account has a password. Accounts without one must have signed in recently. */
  @IsOptional() @IsString() @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword?: string;
}

/** POST /auth/email/change/confirm */
export class ConfirmEmailChangeInput {
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  token: string;
}
