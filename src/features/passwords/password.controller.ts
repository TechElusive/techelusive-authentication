import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from '@nestjs/common';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { CurrentUser, Public } from '@/guards/auth.decorators';
import { EmailVerificationService } from '@/features/email-links/email-verification.service';
import { AccessTokenClaims } from '@/features/sessions/session.types';
import { PasswordAuthService } from './password-auth.service';
import {
  ChangePasswordInput,
  EmailOnlyInput,
  RegisterInput,
  ResetPasswordInput,
  SignInWithPasswordInput,
  TokenInput,
} from './password.dto';
import { ROUTES } from '@/constants';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Email + password and email verification.
 *
 *   POST /auth/register                  create an account
 *   POST /auth/login                     sign in
 *   POST /auth/email/send-verification   (re)send the verification link
 *   POST /auth/email/verify              use the token from the link
 *   POST /auth/password/forgot           email a reset link
 *   POST /auth/password/reset            set a new password with the token from the link
 *   POST /auth/password/change           signed in: change (or first set) the password
 */
@Controller(ROUTES.auth.prefix)
@LibraryController()
@UsePipes(strictValidationPipe)
export class PasswordController {
  constructor(
    private readonly passwordAuth: PasswordAuthService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  /**
   * POST /auth/register — Creates an account. Public.
   *
   * @param body - The sign-up form.
   * @param request - Who is asking.
   * @returns See `PasswordAuthService.register`.
   */
  @Post(ROUTES.auth.register)
  @Public()
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: RegisterInput, @CurrentRequest() request: RequestContext) {
    return this.passwordAuth.register(body, request);
  }

  /**
   * POST /auth/login — Signs in with email + password. Public.
   *
   * @param body - `{ email, password }`.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   */
  @Post(ROUTES.auth.login)
  @Public()
  @HttpCode(HttpStatus.OK)
  login(@Body() body: SignInWithPasswordInput, @CurrentRequest() request: RequestContext) {
    return this.passwordAuth.signInWithPassword(body.email, body.password, request);
  }

  /**
   * POST /auth/email/send-verification — (Re)sends the email verification link. Public.
   *
   * @param body - `{ email }`.
   * @param request - Who is asking.
   * @returns A generic success message.
   */
  @Post(ROUTES.auth.emailSendVerification)
  @Public()
  @HttpCode(HttpStatus.OK)
  sendVerificationEmail(@Body() body: EmailOnlyInput, @CurrentRequest() request: RequestContext) {
    return this.emailVerification.sendVerificationEmail(body.email, request);
  }

  /**
   * POST /auth/email/verify — Verifies the email with the token from the link. Public.
   *
   * @param body - `{ token }`.
   * @param request - Who is asking.
   * @returns See `EmailVerificationService.verifyEmail`.
   */
  @Post(ROUTES.auth.emailVerify)
  @Public()
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() body: TokenInput, @CurrentRequest() request: RequestContext) {
    return this.emailVerification.verifyEmail(body.token, request);
  }

  /**
   * POST /auth/password/forgot — Emails a password reset link. Public.
   *
   * @param body - `{ email }`.
   * @param request - Who is asking.
   * @returns A generic success message.
   */
  @Post(ROUTES.auth.passwordForgot)
  @Public()
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: EmailOnlyInput, @CurrentRequest() request: RequestContext) {
    return this.passwordAuth.requestPasswordReset(body.email, request);
  }

  /**
   * POST /auth/password/reset — Sets a new password with the token from the link. Public.
   *
   * @param body - `{ token, newPassword }`.
   * @param request - Who is asking.
   * @returns A success message.
   */
  @Post(ROUTES.auth.passwordReset)
  @Public()
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordInput, @CurrentRequest() request: RequestContext) {
    return this.passwordAuth.resetPassword(body.token, body.newPassword, request);
  }

  /**
   * POST /auth/password/change — Changes (or first sets) the signed-in user's password.
   *
   * @param user - The access token's claims (user id and session id).
   * @param body - `{ currentPassword, newPassword }`.
   * @param request - Who is asking.
   * @returns A success message.
   */
  @Post(ROUTES.auth.passwordChange)
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: AccessTokenClaims, @Body() body: ChangePasswordInput, @CurrentRequest() request: RequestContext) {
    return this.passwordAuth.changePassword(user.sub, user.sid, body.currentPassword, body.newPassword, request);
  }
}
