import { AuthEmail, AuthEvent, EmailSender, SmsSender } from '@/index';
import { ADDRESS_FORMATTING_CHARACTERS_PATTERN, DEV_INBOX_LIMIT, SMS_MESSAGE_TYPE } from '../playground.constants';

/** One email or SMS the library asked the app to send. */
export interface InboxMessage {
  id: number;
  type: string;
  to: string;
  /** The code or link token inside the message, if any (what a tester needs). */
  code?: string;
  token?: string;
  details: Record<string, unknown>;
  sentAt: string;
}

/** A webhook delivery the playground's receiver got. */
export interface ReceivedWebhook {
  id: number;
  eventName: string | undefined;
  isSignatureValid: boolean;
  body: unknown;
  receivedAt: string;
}

/**
 * Catches everything the playground "sends", so testers can see it on the dashboard and Postman
 * can read codes automatically. Nothing leaves the machine.
 */
export class DevInbox {
  readonly messages: InboxMessage[] = [];
  readonly events: AuthEvent[] = [];
  readonly webhooks: ReceivedWebhook[] = [];
  private nextId = 1;

  readonly emailSender: EmailSender = {
    send: async (email: AuthEmail) => {
      const { type, to, ...details } = email;
      this.addMessage({ type, to, details, code: 'code' in email ? email.code : undefined, token: 'token' in email ? email.token : undefined });
    },
  };

  readonly smsSender: SmsSender = {
    sendCode: async (phoneNumber: string, code: string) => {
      this.addMessage({ type: SMS_MESSAGE_TYPE, to: phoneNumber, code, details: {} });
    },
  };

  recordEvent(event: AuthEvent) {
    this.keepLatest(this.events, event);
  }

  recordWebhook(webhook: Omit<ReceivedWebhook, 'id' | 'receivedAt'>) {
    this.keepLatest(this.webhooks, { ...webhook, id: this.nextId++, receivedAt: new Date().toISOString() });
  }

  /** The newest message to `to` of `type`, e.g. the last sign-in code sent to an email. */
  findLatest(to: string, type: string): InboxMessage | undefined {
    // Compare both sides in the same simplified form, so "+91 98765-43210" matches "+919876543210"
    // and "Asha@Example.com" matches "asha@example.com".
    const simplify = (address: string) => address.trim().toLowerCase().replace(ADDRESS_FORMATTING_CHARACTERS_PATTERN, '');
    const wanted = simplify(to);
    return this.messages.find((message) => simplify(message.to) === wanted && message.type === type);
  }

  clear() {
    this.messages.length = 0;
    this.events.length = 0;
    this.webhooks.length = 0;
  }

  private addMessage(message: Omit<InboxMessage, 'id' | 'sentAt'>) {
    this.keepLatest(this.messages, { ...message, id: this.nextId++, sentAt: new Date().toISOString() });
  }

  /** Newest first, at most DEV_INBOX_LIMIT entries. */
  private keepLatest<T>(list: T[], item: T) {
    list.unshift(item);
    if (list.length > DEV_INBOX_LIMIT) list.length = DEV_INBOX_LIMIT;
  }
}

/** One inbox for the whole playground process. */
export const devInbox = new DevInbox();
