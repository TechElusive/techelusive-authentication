import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from '@nestjs/common';
import { LibraryController } from '@/common/refresh-token-cookie';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { ROUTES } from '@/constants';
import { CheckSession, CurrentUser, Public } from '@/guards/auth.decorators';
import { AccessTokenClaims } from '@/features/sessions/session.types';
import { ConfirmEmailChangeInput, RequestEmailChangeInput } from './email-change.dto';
import { EmailChangeService } from './email-change.service';

/**
 * Changing the account's email:
 *
 *   POST /auth/email/change           (signed in) send a confirmation link to the new address
 *   POST /auth/email/change/confirm   (the link)  switch to the new address
 */
@Controller(ROUTES.auth.prefix)
@LibraryController()
@UsePipes(strictValidationPipe)
export class EmailChangeController {
  constructor(private readonly emailChange: EmailChangeService) {}

  /**
   * POST /auth/email/change — Sends a confirmation link to the new address.
   *
   * @param user - The access token's claims (user id and session id).
   * @param body - `{ newEmail, currentPassword? }`.
   * @param request - Who is asking.
   * @returns A generic success message.
   */
  @Post(ROUTES.auth.emailChange)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  requestEmailChange(@CurrentUser() user: AccessTokenClaims, @Body() body: RequestEmailChangeInput, @CurrentRequest() request: RequestContext) {
    return this.emailChange.requestEmailChange(user.sub, user.sid, body.newEmail, body.currentPassword, request);
  }

  /**
   * POST /auth/email/change/confirm — Switches to the new address using the token from the link. Public.
   *
   * @param body - `{ token }`.
   * @param request - Who is asking.
   * @returns A success message and the updated profile.
   */
  @Post(ROUTES.auth.emailChangeConfirm)
  @Public()
  @HttpCode(HttpStatus.OK)
  confirmEmailChange(@Body() body: ConfirmEmailChangeInput, @CurrentRequest() request: RequestContext) {
    return this.emailChange.confirmEmailChange(body.token, request);
  }
}
