import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from '@nestjs/common';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { Public } from '@/guards/auth.decorators';
import { EmailOnlyInput } from '@/features/passwords/password.dto';
import { PhoneNumberInput, VerifyEmailCodeInput, VerifyMagicLinkInput, VerifyPhoneCodeInput } from './passwordless.dto';
import { PasswordlessAuthService } from './passwordless-auth.service';
import { ROUTES } from '@/constants';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Sign in (or verify) without a password.
 *
 *   POST /auth/email/send-otp        email a 6-digit code
 *   POST /auth/email/verify-otp      sign in with it (also verifies the email)
 *   POST /auth/magic-link/send       email a sign-in link
 *   POST /auth/magic-link/verify     sign in with the token from the link
 *   POST /auth/phone/send-otp        SMS a 6-digit code
 *   POST /auth/phone/verify-otp      sign in with it (also verifies the phone)
 */
@Controller(ROUTES.auth.prefix)
@LibraryController()
@Public()
@UsePipes(strictValidationPipe)
export class PasswordlessController {
  constructor(private readonly passwordless: PasswordlessAuthService) {}

  /**
   * POST /auth/email/send-otp — Emails a 6-digit code.
   *
   * @param body - `{ email }`.
   * @param request - Who is asking.
   * @returns A generic success message.
   */
  @Post(ROUTES.auth.emailSendOtp)
  @HttpCode(HttpStatus.OK)
  sendEmailCode(@Body() body: EmailOnlyInput, @CurrentRequest() request: RequestContext) {
    return this.passwordless.sendEmailCode(body.email, request);
  }

  /**
   * POST /auth/email/verify-otp — Signs in with the email code (and verifies the email).
   *
   * @param body - `{ email, code }`, plus sign-up details for new accounts.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   */
  @Post(ROUTES.auth.emailVerifyOtp)
  @HttpCode(HttpStatus.OK)
  verifyEmailCode(@Body() body: VerifyEmailCodeInput, @CurrentRequest() request: RequestContext) {
    return this.passwordless.verifyEmailCode(body.email, body.code, body, request);
  }

  /**
   * POST /auth/magic-link/send — Emails a sign-in link.
   *
   * @param body - `{ email }`.
   * @param request - Who is asking.
   * @returns A generic success message.
   */
  @Post(ROUTES.auth.magicLinkSend)
  @HttpCode(HttpStatus.OK)
  sendMagicLink(@Body() body: EmailOnlyInput, @CurrentRequest() request: RequestContext) {
    return this.passwordless.sendMagicLink(body.email, request);
  }

  /**
   * POST /auth/magic-link/verify — Signs in with the token from the link.
   *
   * @param body - `{ token }`, plus sign-up details for new accounts.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   */
  @Post(ROUTES.auth.magicLinkVerify)
  @HttpCode(HttpStatus.OK)
  verifyMagicLink(@Body() body: VerifyMagicLinkInput, @CurrentRequest() request: RequestContext) {
    return this.passwordless.verifyMagicLink(body.token, body, request);
  }

  /**
   * POST /auth/phone/send-otp — Sends a 6-digit code by SMS.
   *
   * @param body - `{ phoneNumber }`.
   * @param request - Who is asking.
   * @returns A generic success message.
   */
  @Post(ROUTES.auth.phoneSendOtp)
  @HttpCode(HttpStatus.OK)
  sendPhoneCode(@Body() body: PhoneNumberInput, @CurrentRequest() request: RequestContext) {
    return this.passwordless.sendPhoneCode(body.phoneNumber, request);
  }

  /**
   * POST /auth/phone/verify-otp — Signs in with the SMS code (and verifies the phone).
   *
   * @param body - `{ phoneNumber, code }`, plus sign-up details for new accounts.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   */
  @Post(ROUTES.auth.phoneVerifyOtp)
  @HttpCode(HttpStatus.OK)
  verifyPhoneCode(@Body() body: VerifyPhoneCodeInput, @CurrentRequest() request: RequestContext) {
    return this.passwordless.verifyPhoneCode(body.phoneNumber, body.code, body, request);
  }
}
