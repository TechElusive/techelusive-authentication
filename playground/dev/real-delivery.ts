import { Logger } from '@nestjs/common';
import { AuthEmail, EmailSender, Msg91SmsSender, SmsSender } from '@/index';
import { HTTP_HEADER, HTTP_METHOD, JSON_CONTENT_TYPE } from '@/constants';
import {
  BEARER_PREFIX,
  PLAYGROUND_LOG_CONTEXT,
  REAL_EMAIL_FOOTER,
  REAL_EMAIL_LINK_BASE,
  REAL_EMAIL_SUBJECT,
  RESEND_API,
  UNKNOWN_VALUE_LABEL,
} from '../playground.constants';

const logger = new Logger(PLAYGROUND_LOG_CONTEXT);

/** Plain-text body: the code, or the token with a link to the dashboard, plus any details. */
function emailText(email: AuthEmail): string {
  const lines = [REAL_EMAIL_SUBJECT[email.type] ?? email.type, ''];
  if ('code' in email) lines.push(`Code: ${email.code}`);
  if ('token' in email) lines.push(`Token: ${email.token}`, `Link: ${REAL_EMAIL_LINK_BASE}${encodeURIComponent(email.token)}`);
  if ('organizationName' in email) lines.push(`Organization: ${email.organizationName}`);
  if ('ipAddress' in email) lines.push(`IP address: ${email.ipAddress ?? UNKNOWN_VALUE_LABEL}`, `Device: ${email.userAgent ?? UNKNOWN_VALUE_LABEL}`);
  lines.push('', REAL_EMAIL_FOOTER);
  return lines.join('\n');
}

/** Sends playground emails for real through Resend's HTTP API (no extra package needed). */
export class ResendEmailSender implements EmailSender {
  constructor(private readonly apiKey: string, private readonly fromAddress: string) {}

  async send(email: AuthEmail): Promise<void> {
    const response = await fetch(RESEND_API.url, {
      method: HTTP_METHOD.post,
      signal: AbortSignal.timeout(RESEND_API.requestTimeoutMs),
      headers: { [HTTP_HEADER.authorization]: `${BEARER_PREFIX}${this.apiKey}`, [HTTP_HEADER.contentType]: JSON_CONTENT_TYPE },
      body: JSON.stringify({ from: this.fromAddress, to: [email.to], subject: REAL_EMAIL_SUBJECT[email.type] ?? email.type, text: emailText(email) }),
    });
    if (!response.ok) throw new Error(`Resend refused the email (${response.status}): ${await response.text()}`);
  }
}

/**
 * Every message always lands in the dev inbox. When a real sender is configured, it is also sent
 * for real; a failure there is logged and doesn't break the flow (the inbox still has the code).
 */
export function alsoSendEmailsForReal(inbox: EmailSender, real: EmailSender | undefined): EmailSender {
  if (!real) return inbox;
  return {
    send: async (email) => {
      await inbox.send(email);
      await real.send(email).then(
        () => logger.log(`Email "${email.type}" sent for real to ${email.to}`),
        (error: Error) => logger.warn(`Real email to ${email.to} failed: ${error.message}`),
      );
    },
  };
}

export function alsoSendSmsForReal(inbox: SmsSender, real: SmsSender | undefined): SmsSender {
  if (!real) return inbox;
  return {
    sendCode: async (phoneNumber, code) => {
      await inbox.sendCode(phoneNumber, code);
      await real.sendCode(phoneNumber, code).then(
        () => logger.log(`SMS sent for real to ${phoneNumber}`),
        (error: Error) => logger.warn(`Real SMS to ${phoneNumber} failed: ${error.message}`),
      );
    },
  };
}

/** Real senders from playground/.env (each is optional). */
export function realSendersFromEnvironment() {
  const resendApiKey = process.env.RESEND_API_KEY;
  const msg91AuthKey = process.env.MSG91_AUTH_KEY;
  const msg91TemplateId = process.env.MSG91_TEMPLATE_ID;
  return {
    email: resendApiKey ? new ResendEmailSender(resendApiKey, process.env.EMAIL_FROM ?? RESEND_API.defaultFromAddress) : undefined,
    sms:
      msg91AuthKey && msg91TemplateId
        ? new Msg91SmsSender({ authKey: msg91AuthKey, templateId: msg91TemplateId, codeVariableName: process.env.MSG91_CODE_VARIABLE })
        : undefined,
  };
}
