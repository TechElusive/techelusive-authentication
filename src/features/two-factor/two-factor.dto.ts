import { IsString, MaxLength } from 'class-validator';
import { CODE_INPUT_MAX_LENGTH, RANDOM_TOKEN_INPUT_MAX_LENGTH } from '@/constants';

/** POST /auth/2fa/enable, /auth/2fa/disable, /auth/2fa/backup-codes */
export class TwoFactorCodeInput {
  /** The 6-digit code from the authenticator app, or a backup code such as "k7m2-x9p4". */
  @IsString() @MaxLength(CODE_INPUT_MAX_LENGTH)
  code: string;
}

/** POST /auth/2fa/verify (second step of sign-in) */
export class VerifyTwoFactorChallengeInput extends TwoFactorCodeInput {
  /** The challengeToken from the sign-in response. */
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  challengeToken: string;
}
