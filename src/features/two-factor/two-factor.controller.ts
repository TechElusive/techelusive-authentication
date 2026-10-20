import { Body, Controller, Get, HttpCode, HttpStatus, Post, UsePipes } from '@nestjs/common';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { CheckSession, CurrentUser, CurrentUserId, Public } from '@/guards/auth.decorators';
import { AccessTokenClaims } from '@/features/sessions/session.types';
import { UsersService } from '@/features/users/users.service';
import { TwoFactorCodeInput, VerifyTwoFactorChallengeInput } from './two-factor.dto';
import { TwoFactorService } from './two-factor.service';
import { ROUTES } from '@/constants';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Two-factor authentication (authenticator app + backup codes).
 *
 *   GET  /auth/2fa                 is it on? how many backup codes are left?
 *   POST /auth/2fa/setup           start: get the secret and QR-code URL
 *   POST /auth/2fa/enable          finish: first code -> backup codes
 *   POST /auth/2fa/disable         turn off (needs a code)
 *   POST /auth/2fa/backup-codes    new backup codes (needs a code)
 *   POST /auth/2fa/verify          second step of sign-in
 */
@Controller(ROUTES.twoFactor.prefix)
@LibraryController()
@UsePipes(strictValidationPipe)
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly users: UsersService,
  ) {}

  /**
   * GET /auth/2fa — Is 2FA on for the signed-in user, and how many backup codes are left?
   *
   * @param userId - From the access token.
   * @returns `{ isEnabled, remainingBackupCodes }`.
   */
  @Get()
  async getStatus(@CurrentUserId() userId: string) {
    const user = await this.users.getUserOrThrow(userId);
    return {
      success: true,
      isEnabled: user.isTwoFactorEnabled,
      remainingBackupCodes: user.isTwoFactorEnabled ? await this.twoFactor.countRemainingBackupCodes(userId) : 0,
    };
  }

  /**
   * POST /auth/2fa/setup — Starts setup and returns the secret and QR-code URL.
   *
   * @param userId - From the access token.
   * @returns See `TwoFactorService.startSetup`.
   */
  @Post(ROUTES.twoFactor.setup)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  startSetup(@CurrentUserId() userId: string) {
    return this.twoFactor.startSetup(userId);
  }

  /**
   * POST /auth/2fa/enable — Confirms setup with the first code and returns backup codes.
   *
   * @param user - The access token's claims (user id and session id).
   * @param body - `{ code }`.
   * @param request - Who is asking.
   * @returns See `TwoFactorService.confirmSetup`.
   */
  @Post(ROUTES.twoFactor.enable)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  enable(@CurrentUser() user: AccessTokenClaims, @Body() body: TwoFactorCodeInput, @CurrentRequest() request: RequestContext) {
    return this.twoFactor.confirmSetup(user.sub, user.sid, body.code, request);
  }

  /**
   * POST /auth/2fa/disable — Turns 2FA off.
   *
   * @param userId - From the access token.
   * @param body - `{ code }`: an authenticator or backup code.
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Post(ROUTES.twoFactor.disable)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  disable(@CurrentUserId() userId: string, @Body() body: TwoFactorCodeInput, @CurrentRequest() request: RequestContext) {
    return this.twoFactor.disable(userId, body.code, request);
  }

  /**
   * POST /auth/2fa/backup-codes — Replaces all backup codes.
   *
   * @param userId - From the access token.
   * @param body - `{ code }`: an authenticator or backup code.
   * @returns The new backup codes.
   */
  @Post(ROUTES.twoFactor.backupCodes)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  regenerateBackupCodes(@CurrentUserId() userId: string, @Body() body: TwoFactorCodeInput) {
    return this.twoFactor.regenerateBackupCodes(userId, body.code);
  }

  /**
   * POST /auth/2fa/verify — The second step of sign-in. Public: the caller has no tokens yet.
   *
   * @param body - `{ challengeToken, code }`.
   * @param request - Who is asking.
   * @returns Access and refresh tokens.
   */
  @Post(ROUTES.twoFactor.verify)
  @Public()
  @HttpCode(HttpStatus.OK)
  verify(@Body() body: VerifyTwoFactorChallengeInput, @CurrentRequest() request: RequestContext) {
    return this.twoFactor.verifySignInChallenge(body.challengeToken, body.code, request);
  }
}
