import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { AUTH_ERRORS, ERROR_CODE_BY_HTTP_STATUS, HTTP_HEADER, LOG_CONTEXT } from '@/constants';

/**
 * Turns every error into one response format:
 *   { "success": false, "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." }
 *
 * - AuthError: sent as is (plus extra fields such as retryAfterSeconds).
 * - Validation errors from DTOs: code VALIDATION_ERROR with the list of problems.
 * - Other Nest HTTP errors (404 route not found...): their status with a generic code.
 * - Anything unexpected: logged on the server, and only "INTERNAL_SERVER_ERROR" is sent back,
 *   so stack traces and internal details never reach the client.
 *
 * AuthModule registers it app-wide (APP_FILTER), so your own routes get the same error format.
 * Throw AuthError or any Nest HttpException from your code and it is formatted the same way.
 */
@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(LOG_CONTEXT.exceptionFilter);

  /**
   * Formats any thrown error into the library's response shape and sends it.
   *
   * @param exception - Whatever was thrown.
   * @param host - Gives access to the HTTP response.
   */
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as string | Record<string, any>;

      if (typeof body === 'object' && typeof body.code === 'string') {
        const { statusCode: _statusCode, ...rest } = body;
        if (typeof rest.retryAfterSeconds === 'number') response.setHeader(HTTP_HEADER.retryAfter, String(rest.retryAfterSeconds));
        return response.status(status).json({ success: false, ...rest });
      }

      // ValidationPipe puts its list of problems in `message` as an array.
      if (status === HttpStatus.BAD_REQUEST && typeof body === 'object' && Array.isArray(body.message)) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          code: AUTH_ERRORS.validationFailed.code,
          message: AUTH_ERRORS.validationFailed.message,
          problems: body.message,
        });
      }

      const message = typeof body === 'string' ? body : (body.message ?? exception.message);
      return response.status(status).json({ success: false, code: ERROR_CODE_BY_HTTP_STATUS[status] ?? AUTH_ERRORS.internalError.code, message: String(message) });
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return response
      .status(AUTH_ERRORS.internalError.status)
      .json({ success: false, code: AUTH_ERRORS.internalError.code, message: AUTH_ERRORS.internalError.message });
  }
}
