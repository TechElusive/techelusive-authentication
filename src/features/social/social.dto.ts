import { IsOptional, IsString, MaxLength } from 'class-validator';
import { NONCE_INPUT_MAX_LENGTH, SOCIAL_TOKEN_INPUT_MAX_LENGTH } from '@/constants';
import { SignUpDetailsInput } from '@/features/passwordless/passwordless.dto';

/**
 * POST /auth/social/google | apple | facebook
 * (and POST /auth/social/:provider/link for a signed-in user)
 */
export class SocialSignInInput extends SignUpDetailsInput {
  /** Google / Apple: the ID token. Facebook: the user access token. */
  @IsString() @MaxLength(SOCIAL_TOKEN_INPUT_MAX_LENGTH)
  token: string;

  /** The raw nonce your app used in the provider request, if any. */
  @IsOptional() @IsString() @MaxLength(NONCE_INPUT_MAX_LENGTH)
  nonce?: string;
}
