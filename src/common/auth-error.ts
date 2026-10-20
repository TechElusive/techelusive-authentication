import { HttpException } from '@nestjs/common';
import { AuthErrorDefinition } from '@/constants';

/**
 * The one error type the library throws for expected problems (wrong password, expired code...).
 * Every error is defined once, in AUTH_ERRORS (constants.ts), with its HTTP status, code and message.
 *
 * Sent to the client as:
 *   { "success": false, "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." }
 *
 * Usage: throw new AuthError(AUTH_ERRORS.invalidCredentials)
 *        throw new AuthError(AUTH_ERRORS.tooManyRequests, { retryAfterSeconds: 60 })
 */
export class AuthError extends HttpException {
  readonly code: string;

  constructor(error: AuthErrorDefinition, extraDetails: Record<string, unknown> = {}) {
    super({ statusCode: error.status, code: error.code, message: error.message, ...extraDetails }, error.status);
    this.code = error.code;
  }
}
