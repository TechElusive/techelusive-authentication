import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CODE_INPUT_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PHONE_NUMBER_INPUT_MAX_LENGTH,
  RANDOM_TOKEN_INPUT_MAX_LENGTH,
} from '@/constants';

/**
 * Optional details for someone signing up with a code, link or social account. Only used when
 * the sign-in creates a NEW account; ignored for existing users. If your settings require names
 * or consent and they are missing, the response is VALIDATION_ERROR with `missingSignUpDetails`.
 */
export class SignUpDetailsInput {
  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  lastName?: string;

  @IsOptional() @IsBoolean()
  acceptTerms?: boolean;

  @IsOptional() @IsBoolean()
  acceptPrivacyPolicy?: boolean;
}

/** POST /auth/email/verify-otp */
export class VerifyEmailCodeInput extends SignUpDetailsInput {
  @IsString() @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @IsString() @MaxLength(CODE_INPUT_MAX_LENGTH)
  code: string;
}

/** POST /auth/phone/send-otp */
export class PhoneNumberInput {
  @IsString() @MaxLength(PHONE_NUMBER_INPUT_MAX_LENGTH)
  phoneNumber: string;
}

/** POST /auth/phone/verify-otp */
export class VerifyPhoneCodeInput extends SignUpDetailsInput {
  @IsString() @MaxLength(PHONE_NUMBER_INPUT_MAX_LENGTH)
  phoneNumber: string;

  @IsString() @MaxLength(CODE_INPUT_MAX_LENGTH)
  code: string;
}

/** POST /auth/magic-link/verify */
export class VerifyMagicLinkInput extends SignUpDetailsInput {
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  token: string;
}
