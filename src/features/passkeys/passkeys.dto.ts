import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PASSKEY_NAME_MAX_LENGTH, RANDOM_TOKEN_INPUT_MAX_LENGTH } from '@/constants';

/** POST /auth/passkeys/register/verify and POST /auth/passkeys/sign-in/verify */
export class FinishPasskeyCeremonyInput {
  /** The challengeToken returned by the matching ".../options" call. */
  @IsString() @MaxLength(RANDOM_TOKEN_INPUT_MAX_LENGTH)
  challengeToken: string;

  /** The object returned by the browser (navigator.credentials.*) or the native passkey API, as JSON. */
  @IsObject()
  response: Record<string, unknown>;

  /** Only when registering: a name for the passkey, e.g. "My iPhone". */
  @IsOptional() @IsString() @MaxLength(PASSKEY_NAME_MAX_LENGTH)
  name?: string;
}

/** PATCH /auth/passkeys/:id */
export class RenamePasskeyInput {
  @IsString() @MaxLength(PASSKEY_NAME_MAX_LENGTH)
  name: string;
}
