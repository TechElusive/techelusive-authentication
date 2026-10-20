import { Logger } from '@nestjs/common';
import { AuthEmail, EmailSender } from '@/auth-options';
import { LOG_CONTEXT, PRODUCTION_ENVIRONMENT } from '@/constants';

/**
 * Development only: prints emails to the console instead of sending them, so you can copy
 * codes and links while building your app. Use a real sender (SES, Resend, SMTP...) in production.
 */
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger(LOG_CONTEXT.consoleEmailSender);

  /**
   * Prints the email to the console.
   *
   * @param email - The email the library wants to send.
   * @throws When NODE_ENV is "production", so it can't be shipped by accident.
   */
  async send(email: AuthEmail): Promise<void> {
    if (process.env.NODE_ENV === PRODUCTION_ENVIRONMENT) {
      throw new Error('ConsoleEmailSender must not be used in production');
    }
    this.logger.log(`[${email.type}] to ${email.to}: ${JSON.stringify(email)}`);
  }
}
