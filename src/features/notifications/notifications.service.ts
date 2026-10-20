import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthEmail, AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import { maskPhoneNumber } from '@/common/identifiers';
import { AUTH_ERRORS, AUTH_OPTIONS_TOKEN, LOG_CONTEXT } from '@/constants';

/**
 * Sends emails and SMS through the senders your app provides in AuthOptions.
 *
 * Two kinds of message:
 * - Required (a code or link the user is waiting for): if sending fails, the request fails, so the
 *   user knows to try again.
 * - Notices (password changed, new sign-in): sending failures are logged and the action still succeeds.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(LOG_CONTEXT.notifications);

  constructor(@Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions) {}

  /**
   * @returns True when an SMS sender is configured (phone OTP needs one).
   */
  get canSendSms(): boolean {
    return this.options.smsSender !== undefined;
  }

  /**
   * Sends an email the user is waiting for (a code or link).
   *
   * @param email - The email to send; its `type` says which template your sender should use.
   * @throws AuthError INTERNAL_SERVER_ERROR if it could not be sent, so the user knows to try again.
   */
  async sendRequiredEmail(email: AuthEmail): Promise<void> {
    try {
      await this.options.emailSender.send(email);
    } catch (error) {
      this.logger.error(`Could not send "${email.type}" email: ${(error as Error).message}`);
      throw new AuthError(AUTH_ERRORS.internalError);
    }
  }

  /**
   * Sends an informational email (password changed, new sign-in). Never throws; failures are logged.
   *
   * @param email - The email to send.
   */
  async sendNoticeEmail(email: AuthEmail): Promise<void> {
    try {
      await this.options.emailSender.send(email);
    } catch (error) {
      this.logger.warn(`Could not send "${email.type}" notice email: ${(error as Error).message}`);
    }
  }

  /**
   * Sends a one-time code by SMS.
   *
   * @param phoneNumber - The E.164 phone number.
   * @param code - The code to send.
   * @throws AuthError NOT_CONFIGURED when no SMS sender is configured.
   * @throws AuthError INTERNAL_SERVER_ERROR when sending failed.
   */
  async sendSmsCode(phoneNumber: string, code: string): Promise<void> {
    if (!this.options.smsSender) throw new AuthError(AUTH_ERRORS.notConfigured);
    try {
      await this.options.smsSender.sendCode(phoneNumber, code);
    } catch (error) {
      this.logger.error(`Could not send SMS to ${maskPhoneNumber(phoneNumber)}: ${(error as Error).message}`);
      throw new AuthError(AUTH_ERRORS.internalError);
    }
  }
}
