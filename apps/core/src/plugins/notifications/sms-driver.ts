import { maskPhone } from '@ecommbd/shared';
import { Logger } from '@vendure/core';
import { loggerCtx } from './constants';

export interface SmsSendRequest {
    /** E.164 Bangladeshi mobile number. */
    to: string;
    text: string;
    /** The approved sender ID (masking), or empty for the provider's number. */
    senderId: string;
    /** Unicode (Bangla) or GSM-7: providers need to know. */
    unicode: boolean;
}

export interface SmsSendResult {
    /** The provider's ID for the message, for delivery reports. */
    providerMessageId: string;
    /** Accepted by the provider (`sent`), or delivered already (`delivered`). */
    status: 'sent' | 'delivered';
}

export type SmsDeliveryStatus = 'sent' | 'delivered' | 'failed';

/**
 * An SMS provider (roadmap phase 10). The provider is chosen later; until then the `log` driver
 * records messages instead of sending them. A real driver is added here, and later the central
 * SMS gateway (phase 38) is one more driver, so nothing that sends SMS changes.
 */
export interface SmsDriver {
    readonly code: string;
    send(request: SmsSendRequest): Promise<SmsSendResult>;
    /** Asks the provider how a message is doing (optional). */
    getStatus?(providerMessageId: string): Promise<SmsDeliveryStatus>;
    /** Reads the provider's delivery report callback (optional). */
    parseDeliveryReport?(body: unknown): { providerMessageId: string; status: SmsDeliveryStatus } | null;
}

export interface SentSms extends SmsSendRequest {
    providerMessageId: string;
    at: Date;
}

/**
 * Development and tests: nothing is sent. Messages are kept in memory (tests read them) and logged
 * with the phone masked. `failNext` makes the next sends fail, to test retries.
 */
export class LogSmsDriver implements SmsDriver {
    readonly code = 'log';
    readonly sent: SentSms[] = [];
    failNext = 0;
    private counter = 0;

    async send(request: SmsSendRequest): Promise<SmsSendResult> {
        if (this.failNext > 0) {
            this.failNext -= 1;
            throw new Error('Test SMS provider is down');
        }
        this.counter += 1;
        const providerMessageId = `log-${Date.now()}-${this.counter}`;
        this.sent.push({ ...request, providerMessageId, at: new Date() });
        Logger.info(`SMS (not sent: log driver) to ${maskPhone(request.to)}: ${request.text.length} characters`, loggerCtx);
        return { providerMessageId, status: 'sent' };
    }
}

/** Production until a provider is set up: every SMS is recorded as skipped, nothing is sent. */
export class NoSmsDriver implements SmsDriver {
    readonly code = 'none';

    async send(): Promise<SmsSendResult> {
        throw new NoProviderError();
    }
}

export class NoProviderError extends Error {
    constructor() {
        super('No SMS provider is set up (SMS_DRIVER=none)');
    }
}
