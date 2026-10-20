import { ValidationPipe } from '@nestjs/common';

/**
 * Checks request bodies against their DTO class.
 * - whitelist + forbidNonWhitelisted: unknown fields are rejected, so a client cannot sneak in
 *   fields such as "roles" or "status".
 * - transform: the body becomes an instance of the DTO, so @Transform (e.g. trimming) runs.
 */
export const strictValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
