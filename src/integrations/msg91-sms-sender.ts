import { SmsSender } from '@/auth-options';
import {
  HTTP_HEADER,
  HTTP_METHOD,
  JSON_CONTENT_TYPE,
  LEADING_PLUS_PATTERN,
  MSG91_API,
  MSG91_FLOW_API_URL,
  MSG91_REQUEST_TIMEOUT_MS,
} from '@/constants';

export interface Msg91Options {
  /** Your MSG91 auth key (Dashboard -> API -> Configure). Keep it in an environment variable. */
  authKey: string;
  /** The DLT-approved SMS template id from MSG91 (Flow / template id). */
  templateId: string;
  /** The variable your template uses for the code, e.g. "otp" for "Your code is ##otp##". Default "otp". */
  codeVariableName?: string;
}

/**
 * Ready-made SMS sender for MSG91 (cheapest for Indian numbers). Plug it in with:
 *
 *   smsSender: new Msg91SmsSender({ authKey: process.env.MSG91_AUTH_KEY!, templateId: '...' })
 *
 * For any other provider (Twilio, AWS SNS...), write a class with the same `sendCode` method.
 */
export class Msg91SmsSender implements SmsSender {
  constructor(private readonly msg91: Msg91Options) {}

  /**
   * Sends a one-time code through MSG91's Flow API.
   *
   * @param phoneNumber - The E.164 phone number, e.g. "+919876543210".
   * @param code - The code to send.
   * @throws When MSG91 refuses the request or doesn't answer in time.
   */
  async sendCode(phoneNumber: string, code: string): Promise<void> {
    const response = await fetch(MSG91_FLOW_API_URL, {
      method: HTTP_METHOD.post,
      signal: AbortSignal.timeout(MSG91_REQUEST_TIMEOUT_MS),
      headers: {
        [MSG91_API.authKeyHeader]: this.msg91.authKey,
        [HTTP_HEADER.contentType]: JSON_CONTENT_TYPE,
        [HTTP_HEADER.accept]: JSON_CONTENT_TYPE,
      },
      body: JSON.stringify({
        template_id: this.msg91.templateId,
        // MSG91 wants the number with country code but without "+", e.g. 919876543210.
        recipients: [{ mobiles: phoneNumber.replace(LEADING_PLUS_PATTERN, ''), [this.msg91.codeVariableName ?? MSG91_API.defaultCodeVariableName]: code }],
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!response.ok || result.type === MSG91_API.errorResponseType) {
      throw new Error(`MSG91 refused the SMS: ${result.message ?? `HTTP ${response.status}`}`);
    }
  }
}
