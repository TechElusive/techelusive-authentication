import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UsePipes } from '@nestjs/common';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { CheckSession, CurrentUserId, Public } from '@/guards/auth.decorators';
import { FinishPasskeyCeremonyInput, RenamePasskeyInput } from './passkeys.dto';
import { PasskeysService } from './passkeys.service';
import { ROUTES, ROUTE_PARAM } from '@/constants';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Passkeys.
 *
 *   POST   /auth/passkeys/register/options   signed in: start adding a passkey
 *   POST   /auth/passkeys/register/verify    signed in: finish adding it
 *   POST   /auth/passkeys/sign-in/options    start signing in with a passkey
 *   POST   /auth/passkeys/sign-in/verify     finish signing in
 *   GET    /auth/passkeys                    list my passkeys
 *   PATCH  /auth/passkeys/:id                rename
 *   DELETE /auth/passkeys/:id                remove
 */
@Controller(ROUTES.passkeys.prefix)
@LibraryController()
@UsePipes(strictValidationPipe)
export class PasskeysController {
  constructor(private readonly passkeys: PasskeysService) {}

  /**
   * POST /auth/passkeys/register/options — Starts adding a passkey.
   *
   * @param userId - From the access token.
   * @returns Options for the device and a challenge token.
   */
  @Post(ROUTES.passkeys.registerOptions)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  startRegistration(@CurrentUserId() userId: string) {
    return this.passkeys.startRegistration(userId);
  }

  /**
   * POST /auth/passkeys/register/verify — Finishes adding a passkey.
   *
   * @param userId - From the access token.
   * @param body - `{ challengeToken, response, name? }`.
   * @param request - Who is asking.
   * @returns The saved passkey.
   */
  @Post(ROUTES.passkeys.registerVerify)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  finishRegistration(@CurrentUserId() userId: string, @Body() body: FinishPasskeyCeremonyInput, @CurrentRequest() request: RequestContext) {
    return this.passkeys.finishRegistration(userId, body.challengeToken, body.response, body.name, request);
  }

  /**
   * POST /auth/passkeys/sign-in/options — Starts signing in with a passkey. Public.
   *
   * @param request - Who is asking.
   * @returns Options for the device and a challenge token.
   */
  @Post(ROUTES.passkeys.signInOptions)
  @Public()
  @HttpCode(HttpStatus.OK)
  startSignIn(@CurrentRequest() request: RequestContext) {
    return this.passkeys.startSignIn(request);
  }

  /**
   * POST /auth/passkeys/sign-in/verify — Finishes signing in with a passkey. Public.
   *
   * @param body - `{ challengeToken, response }`.
   * @param request - Who is asking.
   * @returns Tokens.
   */
  @Post(ROUTES.passkeys.signInVerify)
  @Public()
  @HttpCode(HttpStatus.OK)
  finishSignIn(@Body() body: FinishPasskeyCeremonyInput, @CurrentRequest() request: RequestContext) {
    return this.passkeys.finishSignIn(body.challengeToken, body.response, request);
  }

  /**
   * GET /auth/passkeys — The signed-in user's passkeys.
   *
   * @param userId - From the access token.
   * @returns The passkeys.
   */
  @Get()
  async list(@CurrentUserId() userId: string) {
    return { success: true, passkeys: await this.passkeys.listPasskeys(userId) };
  }

  /**
   * PATCH /auth/passkeys/:passkeyId — Renames a passkey.
   *
   * @param userId - From the access token.
   * @param passkeyId - From the URL.
   * @param body - `{ name }`.
   * @returns `{ success: true }`.
   */
  @Patch(ROUTES.passkeys.passkey)
  rename(@CurrentUserId() userId: string, @Param(ROUTE_PARAM.passkeyId, new ParseUUIDPipe()) passkeyId: string, @Body() body: RenamePasskeyInput) {
    return this.passkeys.renamePasskey(userId, passkeyId, body.name);
  }

  /**
   * DELETE /auth/passkeys/:passkeyId — Removes a passkey.
   *
   * @param userId - From the access token.
   * @param passkeyId - From the URL.
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.passkeys.passkey)
  @CheckSession()
  remove(
    @CurrentUserId() userId: string,
    @Param(ROUTE_PARAM.passkeyId, new ParseUUIDPipe()) passkeyId: string,
    @CurrentRequest() request: RequestContext,
  ) {
    return this.passkeys.removePasskey(userId, passkeyId, request);
  }
}
