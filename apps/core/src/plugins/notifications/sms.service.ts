import {
    dhakaParts,
    fromDhaka,
    nextAllowedSendTime,
    isWithinQuietHours,
    maskPhone,
    parseBdMobile,
    renderSmsTemplate,
    type SmsEvent,
    type SmsLanguage,
    smsSegments,
    type SmsVariable,
    startOfDhakaDay,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
    Customer,
    type ID,
    type JobQueue,
    JobQueueService,
    Logger,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In, IsNull, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { loggerCtx, NOTIFICATIONS_PLUGIN_OPTIONS, SMS_RETRIES } from './constants';
import { NoProviderError } from './sms-driver';
import { BdSmsMessage } from './sms-message.entity';
import { SmsSettingsService } from './sms-settings.service';
import type { NotificationsPluginOptions } from './types';

export interface QueueSmsInput {
    event: SmsEvent;
    to: string;
    language: SmsLanguage;
    values: Partial<Record<SmsVariable, string | null>>;
    /** Same key, same SMS: e.g. `order:12:confirmed:+8801712345678`. */
    key: string;
    orderId?: ID | null;
    /** OTPs: never delayed by quiet hours. */
    urgent?: boolean;
}

const COUNTED = ['queued', 'scheduled', 'sent', 'delivered'];
const UNIQUE_VIOLATION = '23505';

/**
 * Order SMS (roadmap phase 10). `queue` writes the message (or why it was skipped) and hands it to
 * a job that sends it with retries. Only Bangladeshi mobiles; customers who opted out get only the
 * events the merchant marked as required; a cap per phone and per store a day stops SMS pumping;
 * ordinary SMS wait for the morning during quiet hours. Nothing here can make an order fail.
 */
@Injectable()
export class SmsService implements OnModuleInit {
    private queue: JobQueue<{ messageId: ID }> | undefined;

    constructor(
        @Inject(NOTIFICATIONS_PLUGIN_OPTIONS) private options: NotificationsPluginOptions,
        private connection: TransactionalConnection,
        private jobQueueService: JobQueueService,
        private settings: SmsSettingsService,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: 'bd-send-sms',
            process: async job => {
                await this.send(job.data.messageId, job.attempts >= SMS_RETRIES);
            },
        });
    }

    async queueSms(ctx: RequestContext, input: QueueSmsInput): Promise<BdSmsMessage | null> {
        try {
            return await this.write(ctx, input);
        } catch (error) {
            // SMS must never break an order: log and move on.
            Logger.error(`Could not queue SMS (${input.event}): ${String(error)}`, loggerCtx);
            return null;
        }
    }

    private async write(ctx: RequestContext, input: QueueSmsInput): Promise<BdSmsMessage | null> {
        const settings = await this.settings.get(ctx);
        const event = settings.events[input.event];
        if (!event.enabled) return null;
        const repository = this.connection.getRepository(ctx, BdSmsMessage);
        const existing = await repository.findOne({ where: { idempotencyKey: input.key } });
        if (existing) return existing;

        const parsed = parseBdMobile(input.to);
        const text = renderSmsTemplate(event[input.language], input.values, input.language);
        const counted = smsSegments(text);
        const message = new BdSmsMessage({
            idempotencyKey: input.key,
            orderId: input.orderId ?? null,
            event: input.event,
            to: parsed.ok ? parsed.phone.e164 : input.to.slice(0, 20),
            body: text,
            language: input.language,
            unicode: counted.encoding === 'ucs2',
            segments: counted.segments,
            status: 'queued',
            reason: '',
            sendAfter: null,
        });
        const skip = await this.skipReason(ctx, input, event.required, parsed.ok ? parsed.phone.e164 : null, settings.caps);
        if (skip) {
            message.status = 'skipped';
            message.reason = skip;
        } else if (!input.urgent && settings.quietHours.enabled) {
            const { startHour, endHour } = settings.quietHours;
            const now = new Date();
            if (isWithinQuietHours(now, startHour, endHour)) {
                message.status = 'scheduled';
                message.sendAfter = nextAllowedSendTime(now, startHour, endHour);
            }
        }
        let saved: BdSmsMessage;
        try {
            saved = await repository.save(message);
        } catch (error) {
            // The same event at the same moment (a retry): the other one wins.
            if ((error as { code?: string; driverError?: { code?: string } }).driverError?.code === UNIQUE_VIOLATION) {
                return repository.findOne({ where: { idempotencyKey: input.key } });
            }
            throw error;
        }
        if (saved.status === 'queued') {
            await this.queue?.add({ messageId: saved.id }, { retries: SMS_RETRIES });
        }
        return saved;
    }

    private async skipReason(
        ctx: RequestContext,
        input: QueueSmsInput,
        required: boolean,
        phone: string | null,
        caps: { perPhonePerDay: number; perStorePerDay: number },
    ): Promise<string | null> {
        // Foreign and landline numbers are never sent SMS (pumping protection, and couriers call them).
        if (!phone) return 'not a Bangladeshi mobile number';
        if (!required && !input.urgent) {
            const customer = await this.connection
                .getRepository(ctx, Customer)
                .findOne({ where: { customFields: { phone }, deletedAt: IsNull() }, select: { id: true, customFields: { smsOptOut: true } } as never });
            if (customer?.customFields.smsOptOut) return 'the customer opted out of SMS';
        }
        const today = startOfDhakaDay(new Date());
        const repository = this.connection.getRepository(ctx, BdSmsMessage);
        const forPhone = await repository.count({ where: { to: phone, status: In(COUNTED), createdAt: MoreThanOrEqual(today) } });
        if (forPhone >= caps.perPhonePerDay) return 'daily limit for this phone';
        if (!input.urgent) {
            const forStore = await repository.count({ where: { status: In(COUNTED), createdAt: MoreThanOrEqual(today) } });
            if (forStore >= caps.perStorePerDay) {
                Logger.warn(`The store reached its daily SMS limit (${caps.perStorePerDay}); SMS are skipped until tomorrow`, loggerCtx);
                return 'daily limit for the store';
            }
        }
        return null;
    }

    /** The job: hands the SMS to the provider. Throws to retry; after the last try it's marked failed. */
    async send(messageId: ID, lastTry: boolean): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(BdSmsMessage);
        const message = await repository.findOne({ where: { id: messageId } });
        if (!message || message.status !== 'queued') return;
        const settings = await this.settings.get(RequestContext.empty());
        message.attempts += 1;
        try {
            const result = await this.options.driver.send({
                to: message.to,
                text: message.body,
                senderId: settings.senderId,
                unicode: message.unicode,
            });
            message.status = result.status;
            message.providerMessageId = result.providerMessageId;
            message.sentAt = new Date();
            message.reason = '';
            await repository.save(message);
        } catch (error) {
            if (error instanceof NoProviderError) {
                message.status = 'skipped';
                message.reason = 'no SMS provider set up';
                await repository.save(message);
                return;
            }
            message.reason = String(error instanceof Error ? error.message : error).slice(0, 200);
            if (lastTry) {
                message.status = 'failed';
                Logger.error(`SMS to ${maskPhone(message.to)} failed after ${message.attempts} tries: ${message.reason}`, loggerCtx);
            }
            await repository.save(message);
            if (!lastTry) throw error;
        }
    }

    /** Every few minutes: SMS held back by quiet hours whose time has come. */
    async releaseScheduled(): Promise<number> {
        const repository = this.connection.rawConnection.getRepository(BdSmsMessage);
        const due = await repository.find({
            where: { status: 'scheduled', sendAfter: LessThanOrEqual(new Date()) },
            take: 500,
            order: { sendAfter: 'ASC' },
        });
        for (const message of due) {
            await repository.update(message.id, { status: 'queued' });
            await this.queue?.add({ messageId: message.id }, { retries: SMS_RETRIES });
        }
        return due.length;
    }

    /** A provider's delivery report updates the status. */
    async deliveryReport(providerMessageId: string, status: 'sent' | 'delivered' | 'failed') {
        await this.connection.rawConnection
            .getRepository(BdSmsMessage)
            .update({ providerMessageId }, { status });
    }

    /** SMS parts sent today and this month (Dhaka time), for the merchant's usage counter. */
    async usage(ctx: RequestContext) {
        const now = new Date();
        const today = startOfDhakaDay(now);
        const { year, month: monthNumber } = dhakaParts(now);
        const month = fromDhaka(year, monthNumber, 1);
        const sum = async (from: Date) => {
            const [row] = await this.connection.getRepository(ctx, BdSmsMessage).query(
                `SELECT COUNT(*)::int AS messages, COALESCE(SUM("segments"), 0)::int AS segments
                 FROM "bd_sms_message" WHERE "status" IN ('sent', 'delivered') AND "sentAt" >= $1`,
                [from],
            );
            return row as { messages: number; segments: number };
        };
        return { today: await sum(today), month: await sum(month), provider: this.options.driver.code };
    }

    forOrder(ctx: RequestContext, orderId: ID) {
        return this.connection.getRepository(ctx, BdSmsMessage).find({ where: { orderId }, order: { createdAt: 'DESC' } });
    }
}
