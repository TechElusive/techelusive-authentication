import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PHONE_NUMBER_INPUT_MAX_LENGTH,
  RANDOM_TOKEN_INPUT_MAX_LENGTH,
} from '@/constants';

/*
 * Request bodies. These check the SHAPE of the input (types and lengths); the services check the
 * MEANING (valid email, password rules, settings). Unknown fields are rejected by the validation pipe.
 */

/** POST /auth/register */
export class RegisterInput {
  @IsString() @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @IsString() @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  lastName?: string;

  /** International format, e.g. +919876543210. */
  @IsOptional() @IsString() @MaxLength(PHONE_NUMBER_INPUT_MAX_LENGTH)
  phoneNumber?: string;

  @IsOptional() @IsBoolean()
  acceptTerms?: boolean;

  @IsOptional() @IsBoolean()
  acceptPrivacyPolicy?: boolean;
}

/** POST /auth/login */
export class SignInWithPasswordInput {
  @IsString() @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @IsString() @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

/** POST /auth/password/forgot, /auth/email/send-verification, /auth/email/send-otp, magic link */
export class EmailOnlyInput {
  @IsString() @MaxLength(EMAIL_MAX_LENGTH)
  email: string;
}

/** POST /auth/password/reset */
export class ResetPasswordInput {
  /** The token from the reset link. */
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  token: string;

  @IsString() @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

/** POST /auth/password/change */
export class ChangePasswordInput {
  /** Leave out only if the account has no password yet (signed up with Google etc.). */
  @IsOptional() @IsString() @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword?: string;

  @IsString() @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

/** Any endpoint that receives a single token: verify email, magic link, refresh, reactivate... */
export class TokenInput {
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  token: string;
}
