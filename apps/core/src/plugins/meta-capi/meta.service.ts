import { findDistrict } from '@ecommbd/bd-geo';
import {
    BROWSER_EVENTS,
    createHttpClient,
    FBC_PATTERN,
    FBP_PATTERN,
    hashedUserData,
    type HttpClient,
    META_GRAPH_URL,
    META_GRAPH_VERSION,
    META_LIMITS,
    type MetaSettings,
    purchaseEventId,
    type PurchaseTrigger,
    redactText,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
    type ID,
    Logger,
    Order,
    OrderService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In, LessThan, LessThanOrEqual, Not } from 'typeorm';
import { z } from 'zod';
import { CheckoutRateLimiter } from '../bd-checkout';
import { BOT_PATTERN, EVENT_RATE_LIMIT, loggerCtx, META_OPTIONS } from './constants';
import { BdMetaEvent, type MetaPayload } from './entities';
import { MetaSettingsService } from './meta-settings.service';
import type { MetaCapiPluginOptions } from './types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_ATTEMPTS = 8;
const UNIQUE_VIOLATION = '23505';

const contentId = z.string().trim().min(1).max(40);
const browserEventSchema = z.object({
    event: z.enum(BROWSER_EVENTS),
    eventId: z.string().regex(/^[\w-]{8,80}$/),
    url: z.string().max(2000),
    fbp: z.string().regex(FBP_PATTERN).optional(),
    fbc: z.string().regex(FBC_PATTERN).optional(),
    data: z
        .object({
            content_ids: z.array(contentId).max(50).optional(),
            contents: z
                .array(
                    z.object({
                        id: contentId,
                        quantity: z.number().int().min(1).max(1000),
                        item_price: z.number().min(0).max(10_000_000).optional(),
                    }),
                )
                .max(50)
                .optional(),
            value: z.number().min(0).max(100_000_000).optional(),
            currency: z.literal('BDT').optional(),
            content_type: z.literal('product').optional(),
            num_items: z.number().int().min(0).max(10_000).optional(),
        })
        .strict()
        .optional(),
});

export type BrowserEventResult = 'queued' | 'off' | 'invalid' | 'bot' | 'limited';

/**
 * Meta Conversions API (roadmap phase 20). Every event is a `bd_meta_event` row per Pixel (the
 * outbox); a task sends them in batches of up to 1,000 with Meta's own answer kept, retries with
 * backoff, pauses on a revoked token (alerting staff) and keeps events queued for up to 7 days.
 * Only hashed personal data goes to Meta; the shopper's IP and browser are kept only until sent.
 */
@Injectable()
export class MetaService implements OnApplicationShutdown {
    private readonly http: HttpClient;

    constructor(
        @Inject(META_OPTIONS) private options: MetaCapiPluginOptions,
        private connection: TransactionalConnection,
        private settings: MetaSettingsService,
        private orderService: OrderService,
        private requestContextService: RequestContextService,
        private rateLimiter: CheckoutRateLimiter,
    ) {
        this.http = createHttpClient({
            timeoutMs: 20_000,
            maxRetries: 1,
            ssrfProtection: !options.graphUrl,
            userAgent: 'EcommBD-Meta',
        });
    }

    async onApplicationShutdown() {
        await this.http.close();
    }

    background(): Promise<RequestContext> {
        return this.requestContextService.create({ apiType: 'admin' });
    }

    private get publicUrl(): string | null {
        return this.options.publicUrl ? this.options.publicUrl.replace(/\/$/, '') : null;
    }

    // ── From the storefront ──────────────────────────────────────────────────────────────────

    /**
     * `POST /bd-events`: one browser event (PageView, ViewContent, AddToCart, InitiateCheckout) with
     * its event ID, the Meta cookies and product data. Checked, rate-limited per address, bots
     * dropped, then queued for each Pixel. Purchase never comes from here: the server makes it.
     */
    async browserEvent(input: {
        body: unknown;
        ip: string | null;
        userAgent: string | null;
    }): Promise<BrowserEventResult> {
        if (!input.userAgent || BOT_PATTERN.test(input.userAgent)) return 'bot';
        const parsed = browserEventSchema.safeParse(input.body);
        if (!parsed.success) return 'invalid';
        const event = parsed.data;
        if (!this.sameStore(event.url)) return 'invalid';
        const ctx = await this.background();
        const settings = await this.settings.get(ctx);
        if (!settings.enabled || !settings.pixelIds.length) return 'off';
        if (input.ip && (await this.rateLimiter.hit(`meta:${input.ip}`, EVENT_RATE_LIMIT)) > 0)
            return 'limited';
        const userData: Record<string, unknown> = {};
        if (event.fbp) userData.fbp = event.fbp;
        if (event.fbc) userData.fbc = event.fbc;
        await this.queue(ctx, settings, {
            eventName: event.event,
            eventId: event.eventId,
            source: 'browser',
            orderId: null,
            eventTime: new Date(),
            payload: {
                event_name: event.event,
                event_id: event.eventId,
                action_source: 'website',
                event_source_url: event.url,
                user_data: userData,
                ...(event.data ? { custom_data: event.data } : {}),
            },
            clientIp: input.ip,
            userAgent: input.userAgent.slice(0, 400),
        });
        return 'queued';
    }

    /** Only pages of this store (the storefront's address) are reported. */
    private sameStore(url: string): boolean {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
            return !this.publicUrl || parsed.host === new URL(this.publicUrl).host;
        } catch {
            return false;
        }
    }

    /**
     * Saved on the order at checkout: the Meta cookies, IP and browser, so a Purchase sent days later
     * (on confirm or delivery) still matches the shopper.
     */
    async saveCheckoutContext(
        ctx: RequestContext,
        order: Order,
        input: { fbp?: string | null; fbc?: string | null; userAgent?: string | null },
    ): Promise<void> {
        await this.connection.getRepository(ctx, Order).update(order.id, {
            customFields: {
                metaFbp: input.fbp && FBP_PATTERN.test(input.fbp) ? input.fbp : null,
                metaFbc: input.fbc && FBC_PATTERN.test(input.fbc) ? input.fbc : null,
                metaClientIp: (ctx.req?.ip ?? '').slice(0, 64) || null,
                metaUserAgent: input.userAgent ? input.userAgent.slice(0, 400) : null,
            },
        });
    }

    // ── Purchase ─────────────────────────────────────────────────────────────────────────────

    /**
     * Purchase when the order reaches the store's trigger: one event per order and Pixel (its ID is
     * the same as the thank-you page's, when that fires it). Never for imported orders; manual orders
     * only when the store says so.
     */
    async purchase(ctx: RequestContext, orderId: ID, trigger: PurchaseTrigger): Promise<number> {
        const settings = await this.settings.get(ctx);
        if (!settings.enabled || settings.purchaseTrigger !== trigger || !settings.pixelIds.length) return 0;
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'lines',
            'lines.productVariant',
        ]);
        if (!order?.orderPlacedAt) return 0;
        const fields = order.customFields as Record<string, unknown>;
        if (fields.imported) return 0;
        if ((fields.source ?? 'web') !== 'web' && !settings.sendManualOrders) return 0;
        const address = order.shippingAddress ?? {};
        const districtId = (address.customFields as { districtId?: string } | undefined)?.districtId;
        const lines = order.lines.filter(line => line.quantity > 0);
        const total =
            settings.purchaseValue === 'withDelivery'
                ? order.totalWithTax
                : order.totalWithTax - order.shippingWithTax;
        const userData: Record<string, unknown> = hashedUserData({
            phone:
                address.phoneNumber ||
                (order.customer?.customFields as { phone?: string } | undefined)?.phone,
            email: order.customer?.emailAddress,
            fullName: address.fullName,
            city: districtId ? findDistrict(districtId)?.en : null,
            externalId: order.customerId ? String(order.customerId) : null,
        });
        if (fields.metaFbp) userData.fbp = fields.metaFbp;
        if (fields.metaFbc) userData.fbc = fields.metaFbc;
        await this.queue(ctx, settings, {
            eventName: 'Purchase',
            eventId: purchaseEventId(order.code),
            source: 'server',
            orderId: order.id,
            // When it reached the trigger: delivery days later still counts (Meta's 7 days).
            eventTime: new Date(),
            payload: {
                event_name: 'Purchase',
                event_id: purchaseEventId(order.code),
                action_source: 'website',
                event_source_url: `${this.publicUrl ?? ''}/checkout/thank-you/`,
                user_data: userData,
                custom_data: {
                    currency: 'BDT',
                    value: Math.round(Math.max(0, total) / 100),
                    content_type: 'product',
                    content_ids: lines.map(line => String(line.productVariantId)),
                    contents: lines.map(line => ({
                        id: String(line.productVariantId),
                        quantity: line.quantity,
                        item_price: Math.round(line.unitPriceWithTax / 100),
                    })),
                    num_items: lines.reduce((sum, line) => sum + line.quantity, 0),
                    order_id: String((fields.orderNumber as string | null) ?? order.code),
                },
            },
            clientIp: (fields.metaClientIp as string | null) ?? null,
            userAgent: (fields.metaUserAgent as string | null) ?? null,
        });
        return settings.pixelIds.length;
    }

    private async queue(
        ctx: RequestContext,
        settings: MetaSettings,
        event: Pick<
            BdMetaEvent,
            | 'eventName'
            | 'eventId'
            | 'source'
            | 'orderId'
            | 'eventTime'
            | 'payload'
            | 'clientIp'
            | 'userAgent'
        >,
    ) {
        const repository = this.connection.getRepository(ctx, BdMetaEvent);
        for (const pixelId of settings.pixelIds) {
            try {
                await repository.insert(
                    new BdMetaEvent({
                        ...event,
                        pixelId,
                        status: 'queued',
                        attempts: 0,
                        nextAttemptAt: new Date(),
                    }),
                );
            } catch (error) {
                // The same event again (a retried request, a repeated trigger): sent once.
                if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
            }
        }
    }

    // ── Sending ──────────────────────────────────────────────────────────────────────────────

    /** The sending task: each Pixel's due events, in batches. Returns how many were sent. */
    async send(): Promise<number> {
        const ctx = await this.background();
        const repository = this.connection.getRepository(ctx, BdMetaEvent);
        // Too old for Meta (website events: 7 days): recorded as skipped.
        await repository.update(
            { status: 'queued', eventTime: LessThan(new Date(Date.now() - META_LIMITS.maxAgeDays * DAY)) },
            {
                status: 'skipped',
                error: 'Older than 7 days: Meta no longer accepts it',
                clientIp: null,
                userAgent: null,
            },
        );
        const settings = await this.settings.get(ctx);
        let sent = 0;
        const pixels = await repository
            .createQueryBuilder('event')
            .select('DISTINCT event.pixelId', 'pixelId')
            .where('event.status = :status', { status: 'queued' })
            .getRawMany<{ pixelId: string }>();
        for (const { pixelId } of pixels) {
            const token = await this.settings.token(ctx, pixelId);
            if (!token) continue;
            const due = await repository.find({
                where: { pixelId, status: 'queued', nextAttemptAt: LessThanOrEqual(new Date()) },
                order: { id: 'ASC' },
                take: META_LIMITS.batch,
            });
            if (!due.length) continue;
            sent += await this.sendBatch(ctx, pixelId, token, due, settings.testEventCode);
        }
        return sent;
    }

    private async sendBatch(
        ctx: RequestContext,
        pixelId: string,
        token: string,
        events: BdMetaEvent[],
        testCode: string,
    ) {
        const repository = this.connection.getRepository(ctx, BdMetaEvent);
        const result = await this.post(pixelId, token, events, testCode);
        if (result.ok) {
            await repository.update(
                { id: In(events.map(event => event.id)) },
                {
                    status: 'sent',
                    sentAt: new Date(),
                    response: result.body,
                    error: null,
                    clientIp: null,
                    userAgent: null,
                },
            );
            const status = await this.settings.status(ctx);
            if (status.tokenProblem?.pixelId === pixelId)
                await this.settings.setStatus(ctx, { tokenProblem: null });
            return events.length;
        }
        if (result.kind === 'token') {
            // A revoked or expired token: stop, tell staff, keep the events (up to 7 days).
            await this.settings.setStatus(ctx, {
                tokenProblem: { pixelId, message: result.message, at: new Date().toISOString() },
            });
            Logger.error(`Meta refused the token of Pixel ${pixelId}: ${result.message}`, loggerCtx);
            await repository.update(
                { id: In(events.map(event => event.id)) },
                { nextAttemptAt: new Date(Date.now() + 30 * MINUTE), error: result.message },
            );
            return 0;
        }
        if (result.kind === 'invalid' && events.length > 1) {
            // Meta refuses the whole batch for one bad event: send them one by one to find it.
            let sent = 0;
            for (const event of events) sent += await this.sendBatch(ctx, pixelId, token, [event], testCode);
            return sent;
        }
        for (const event of events) {
            const attempts = event.attempts + 1;
            const give = result.kind === 'invalid' || attempts >= MAX_ATTEMPTS;
            await repository.update(event.id, {
                attempts,
                error: result.message.slice(0, 500),
                status: give ? 'failed' : 'queued',
                // Backoff with jitter: 1, 2, 4… minutes, at most an hour.
                nextAttemptAt: give
                    ? null
                    : new Date(
                          Date.now() +
                              Math.min(60, 2 ** (attempts - 1)) * MINUTE * (0.8 + Math.random() * 0.4),
                      ),
                ...(give ? { clientIp: null, userAgent: null } : {}),
            });
        }
        return 0;
    }

    private async post(
        pixelId: string,
        token: string,
        events: BdMetaEvent[],
        testCode: string,
    ): Promise<
        { ok: true; body: MetaPayload } | { ok: false; kind: 'token' | 'invalid' | 'retry'; message: string }
    > {
        const data = events.map(event => {
            const payload = event.payload as Record<string, unknown> & {
                user_data?: Record<string, unknown>;
            };
            return {
                ...payload,
                event_time: Math.floor(event.eventTime.getTime() / 1000),
                user_data: {
                    ...payload.user_data,
                    ...(event.clientIp ? { client_ip_address: event.clientIp } : {}),
                    ...(event.userAgent ? { client_user_agent: event.userAgent } : {}),
                },
            };
        });
        const base = (this.options.graphUrl ?? META_GRAPH_URL).replace(/\/$/, '');
        try {
            const response = await this.http.request(`${base}/${META_GRAPH_VERSION}/${pixelId}/events`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // The token in the body, never in a URL that could be logged.
                body: JSON.stringify({
                    data,
                    access_token: token,
                    ...(testCode ? { test_event_code: testCode } : {}),
                }),
                // Meta deduplicates by event_id: sending twice is harmless.
                idempotent: true,
            });
            let body: Record<string, unknown> = {};
            try {
                body = response.json<Record<string, unknown>>();
            } catch {
                /* not JSON */
            }
            if (response.status === 200 && typeof body.events_received === 'number') {
                return {
                    ok: true,
                    body: {
                        events_received: body.events_received,
                        fbtrace_id: body.fbtrace_id,
                        messages: body.messages,
                    },
                };
            }
            const error = (body.error ?? {}) as { code?: number; message?: string; fbtrace_id?: string };
            const message = redactText(
                `${error.code ?? response.status}: ${error.message ?? 'no message'}`,
            ).slice(0, 400);
            if (error.code === 190 || response.status === 401) return { ok: false, kind: 'token', message };
            if (
                response.status === 429 ||
                response.status >= 500 ||
                [1, 2, 4, 17, 32, 613].includes(error.code ?? -1)
            ) {
                return { ok: false, kind: 'retry', message };
            }
            return { ok: false, kind: 'invalid', message };
        } catch (error) {
            return { ok: false, kind: 'retry', message: String(error).slice(0, 400) };
        }
    }

    /** "Send test event": a PageView straight to Meta with the test code, and Meta's answer. */
    async sendTest(ctx: RequestContext, pixelId: string) {
        const token = await this.settings.token(ctx, pixelId);
        if (!token)
            return {
                ok: false,
                message: 'Save the Conversions API token first',
                eventsReceived: null,
                fbtraceId: null,
            };
        const settings = await this.settings.get(ctx);
        const event = new BdMetaEvent({
            pixelId,
            eventName: 'PageView',
            eventId: `test-${randomBytes(8).toString('hex')}`,
            source: 'test',
            orderId: null,
            status: 'queued',
            eventTime: new Date(),
            payload: {
                event_name: 'PageView',
                event_id: '',
                action_source: 'website',
                event_source_url: `${this.publicUrl ?? ''}/`,
                user_data: { country: hashedUserData({}).country },
            } as MetaPayload,
            clientIp: null,
            userAgent: 'EcommBD test event',
            attempts: 0,
        });
        event.payload.event_id = event.eventId;
        const saved = await this.connection.getRepository(ctx, BdMetaEvent).save(event);
        const result = await this.post(pixelId, token, [saved], settings.testEventCode);
        await this.connection.getRepository(ctx, BdMetaEvent).update(saved.id, {
            status: result.ok ? 'sent' : 'failed',
            sentAt: result.ok ? new Date() : null,
            response: result.ok ? result.body : null,
            error: result.ok ? null : result.message,
            userAgent: null,
        });
        return result.ok
            ? {
                  ok: true,
                  message: null,
                  eventsReceived: Number(result.body.events_received),
                  fbtraceId: String(result.body.fbtrace_id ?? ''),
              }
            : { ok: false, message: result.message, eventsReceived: null, fbtraceId: null };
    }

    // ── Staff and housekeeping ───────────────────────────────────────────────────────────────

    async events(
        ctx: RequestContext,
        filter: {
            eventName?: string | null;
            status?: string | null;
            skip?: number | null;
            take?: number | null;
        },
    ) {
        const [items, totalItems] = await this.connection.getRepository(ctx, BdMetaEvent).findAndCount({
            where: {
                ...(filter.eventName ? { eventName: filter.eventName } : {}),
                ...(filter.status ? { status: filter.status as BdMetaEvent['status'] } : {}),
            },
            order: { id: 'DESC' },
            skip: Math.max(0, filter.skip ?? 0),
            take: Math.min(100, Math.max(1, filter.take ?? 50)),
        });
        return { items, totalItems };
    }

    /**
     * Retention: browser events are kept 7 days and Purchases 90 for the log; raw IP addresses on
     * orders 90 days (the privacy rule). Returns how many rows were removed.
     */
    async retention(): Promise<number> {
        const ctx = await this.background();
        const repository = this.connection.getRepository(ctx, BdMetaEvent);
        const browser = await repository.delete({
            source: Not('server'),
            createdAt: LessThan(new Date(Date.now() - 7 * DAY)),
        });
        const server = await repository.delete({
            source: 'server',
            createdAt: LessThan(new Date(Date.now() - 90 * DAY)),
        });
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .update(Order)
            .set({ customFields: { metaClientIp: null } } as never)
            .where('"orderPlacedAt" < :before', { before: new Date(Date.now() - 90 * DAY) })
            .andWhere('"customFieldsMetaclientip" IS NOT NULL')
            .execute();
        return (browser.affected ?? 0) + (server.affected ?? 0);
    }
}
