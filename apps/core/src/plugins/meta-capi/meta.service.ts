import { findDistrict } from '@ecommbd/bd-geo';
import {
    BROWSER_EVENTS,
    classifyMetaError,
    createHttpClient,
    FBC_PATTERN,
    FBP_PATTERN,
    hashedUserData,
    type HttpClient,
    isPrivateMetaPath,
    META_GRAPH_URL,
    META_GRAPH_VERSION,
    META_LIMITS,
    metaActionSource,
    metaPageUrl,
    type MetaSettings,
    purchaseEventId,
    type PurchaseTrigger,
    redactText,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
    ConfigService,
    type ID,
    Logger,
    Order,
    OrderService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In, LessThan, LessThanOrEqual, Not, type Repository } from 'typeorm';
import { z } from 'zod';
import { CheckoutRateLimiter } from '../bd-checkout';
import {
    BOT_PATTERN,
    EVENT_RATE_LIMIT,
    loggerCtx,
    META_OPTIONS,
    SEND_LIMITS,
    STORE_EVENT_RATE_LIMIT,
} from './constants';
import { BdMetaEvent, type MetaPayload } from './entities';
import { MetaSettingsService } from './meta-settings.service';
import type { MetaCapiPluginOptions } from './types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_ATTEMPTS = 8;
const UNIQUE_VIOLATION = '23505';
/** Raw IP addresses and browsers on orders are kept this long (the privacy rule). */
const ORDER_CONTEXT_DAYS = 90;

/**
 * Our own reasons in an event's `error` (Meta's messages are stored as Meta wrote them). The admin
 * shows them in Bangla or English.
 */
export const META_EVENT_ERRORS = {
    /** Older than Meta's 7 days. */
    tooOld: 'tooOld',
    /** Dropped from a large backlog of browser events. */
    backlog: 'backlog',
} as const;

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

type PostResult =
    | { ok: true; body: MetaPayload }
    | { ok: false; kind: 'token' | 'pixel' | 'invalid' | 'retry'; message: string };

/** What one batch did: how many went, and whether to stop sending this Pixel in this run. */
interface BatchOutcome {
    sent: number;
    stop: boolean;
}

/**
 * Meta Conversions API (roadmap phase 20). Every event is a `bd_meta_event` row per Pixel (the
 * outbox); a task sends them every minute in batches of up to 1,000, Purchase first, with Meta's own
 * answer kept. Busy answers are retried with backoff; a refused token or Pixel holds that Pixel's
 * events (with a warning for the merchant) until a new token is saved; events wait up to 7 days.
 * Personal data goes to Meta hashed, except what Meta needs as it is for matching (its own cookie
 * IDs, the shopper's IP and browser, which we keep only until the event is sent).
 */
@Injectable()
export class MetaService implements OnApplicationShutdown {
    private readonly http: HttpClient;
    /** Meta's deprecation and other warnings already logged by this process (each once). */
    private readonly warned = new Set<string>();

    constructor(
        @Inject(META_OPTIONS) private options: MetaCapiPluginOptions,
        private connection: TransactionalConnection,
        private settings: MetaSettingsService,
        private orderService: OrderService,
        private requestContextService: RequestContextService,
        private rateLimiter: CheckoutRateLimiter,
        private configService: ConfigService,
    ) {
        this.http = createHttpClient({
            timeoutMs: 20_000,
            maxRetries: 1,
            ssrfProtection: !options.graphUrl,
            // Meta down or rate-limiting: calls fail fast for a while (the events wait). Not against
            // the tests' mock Graph API, where one test's "outage" would carry into the next.
            circuitBreaker: options.graphUrl ? false : undefined,
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

    /** An ID as the Shop API shows it, so server and browser events name products the same way. */
    private publicId(id: ID): string {
        return String(this.configService.entityOptions.entityIdStrategy?.encodeId(id) ?? id);
    }

    // ── From the storefront ──────────────────────────────────────────────────────────────────

    /**
     * `POST /bd-events`: one browser event (PageView, ViewContent, AddToCart, InitiateCheckout) with
     * its event ID, the Meta cookies and product data. Checked, rate-limited per address and for the
     * whole store, bots dropped, the page address cleaned of secrets, then queued for each Pixel.
     * Purchase never comes from here: the server makes it.
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
        // The storefront already cleans the address; this is the same rule again, so nothing with a
        // secret (a tracking token, a payment attempt, an order code) is stored or sent even if an
        // old or modified script sends it. Private pages aren't tracked at all.
        const url = metaPageUrl(event.url);
        if (!url || !this.sameStore(url) || isPrivateMetaPath(new URL(url).pathname)) return 'invalid';
        const ctx = await this.background();
        const settings = await this.settings.get(ctx);
        if (!settings.enabled || !settings.pixelIds.length) return 'off';
        if (input.ip && (await this.rateLimiter.hit(`meta:${input.ip}`, EVENT_RATE_LIMIT)) > 0)
            return 'limited';
        if ((await this.rateLimiter.hit('meta:store', STORE_EVENT_RATE_LIMIT)) > 0) return 'limited';
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
                event_source_url: url,
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
        return !this.publicUrl || new URL(url).host === new URL(this.publicUrl).host;
    }

    /**
     * Saved on the order at checkout: the Meta cookies, IP and browser, so a Purchase sent days later
     * (on confirm or delivery) still matches the shopper. The IP and browser are cleared after 90 days.
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
     * only when the store says so, with the `action_source` of how the shopper ordered.
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
        const source = (fields.source as string | null) ?? 'web';
        if (source !== 'web' && !settings.sendManualOrders) return 0;
        const actionSource = metaActionSource(source);
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
        // The product IDs as the storefront shows them (its ViewContent and AddToCart use the same).
        const ids = lines.map(line => this.publicId(line.productVariantId));
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
                action_source: actionSource,
                // A page address only for website orders (Meta requires it there, and only there).
                ...(actionSource === 'website'
                    ? { event_source_url: `${this.publicUrl ?? ''}/checkout/thank-you/` }
                    : {}),
                user_data: userData,
                custom_data: {
                    currency: 'BDT',
                    value: Math.round(Math.max(0, total) / 100),
                    content_type: 'product',
                    content_ids: ids,
                    contents: lines.map((line, index) => ({
                        id: ids[index],
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
                // The same event again (a retried request, a repeated trigger, a reloaded checkout): sent once.
                if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
            }
        }
    }

    // ── Sending ──────────────────────────────────────────────────────────────────────────────

    /**
     * The sending task (every minute): each Pixel's due events, Purchase first, in batches. Bounded
     * (`SEND_LIMITS`), and every event it takes is leased first, so an overlapping run never sends
     * or updates the same event. Held Pixels are skipped. Returns how many were sent.
     */
    async send(): Promise<number> {
        const started = Date.now();
        const ctx = await this.background();
        const repository = this.connection.getRepository(ctx, BdMetaEvent);
        // Too old for Meta (website events: 7 days): recorded as skipped.
        await repository.update(
            { status: 'queued', eventTime: LessThan(new Date(Date.now() - META_LIMITS.maxAgeDays * DAY)) },
            { status: 'skipped', error: META_EVENT_ERRORS.tooOld, clientIp: null, userAgent: null },
        );
        const settings = await this.settings.get(ctx);
        const held = new Set((await this.settings.status(ctx)).holds.map(hold => hold.pixelId));
        let sent = 0;
        const pixels = await repository
            .createQueryBuilder('event')
            .select('DISTINCT event.pixelId', 'pixelId')
            .where('event.status = :status', { status: 'queued' })
            .getRawMany<{ pixelId: string }>();
        for (const { pixelId } of pixels) {
            await this.pruneBacklog(repository, pixelId);
            // Held until a new token is saved: nothing goes, new events wait with the rest.
            if (held.has(pixelId)) continue;
            const token = await this.settings.token(ctx, pixelId);
            if (!token) continue;
            const budget = { requests: SEND_LIMITS.requestsPerPixel };
            for (let batch = 0; batch < SEND_LIMITS.batchesPerPixel; batch++) {
                if (Date.now() - started > SEND_LIMITS.runBudgetMs) return sent;
                const due = await this.claim(repository, pixelId);
                if (!due.length) break;
                const outcome = await this.sendBatch(
                    ctx,
                    pixelId,
                    token,
                    due,
                    settings.testEventCode,
                    budget,
                );
                sent += outcome.sent;
                if (outcome.stop || due.length < META_LIMITS.batch) break;
            }
        }
        return sent;
    }

    /**
     * Takes the next batch of a Pixel's due events: server events (Purchase) before browser events,
     * then oldest first. Each is leased (not due again for `leaseMs`) in the same statement that
     * checks it's still queued and due, so two runs never take the same event.
     */
    private async claim(repository: Repository<BdMetaEvent>, pixelId: string): Promise<BdMetaEvent[]> {
        const now = new Date();
        const candidates = await repository
            .createQueryBuilder('event')
            .select('event.id', 'id')
            .where('event.pixelId = :pixelId', { pixelId })
            .andWhere('event.status = :status', { status: 'queued' })
            .andWhere('event.nextAttemptAt <= :now', { now })
            .orderBy(`CASE WHEN event.source = 'server' THEN 0 ELSE 1 END`, 'ASC')
            .addOrderBy('event.id', 'ASC')
            .limit(META_LIMITS.batch)
            .getRawMany<{ id: number }>();
        if (!candidates.length) return [];
        const leased = await repository
            .createQueryBuilder()
            .update(BdMetaEvent)
            .set({ nextAttemptAt: new Date(now.getTime() + SEND_LIMITS.leaseMs) })
            .where({
                id: In(candidates.map(row => row.id)),
                status: 'queued',
                nextAttemptAt: LessThanOrEqual(now),
            })
            .returning(['id'])
            .execute();
        const ids = (leased.raw as Array<{ id: number }>).map(row => row.id);
        if (!ids.length) return [];
        const rank = (event: BdMetaEvent) => (event.source === 'server' ? 0 : 1);
        return (await repository.find({ where: { id: In(ids) } })).sort(
            (a, b) => rank(a) - rank(b) || Number(a.id) - Number(b.id),
        );
    }

    /**
     * A large backlog of browser events (Meta down for hours, or a flood) mustn't grow without end:
     * the newest `browserBacklog` are kept and older ones skipped. Purchases are never skipped.
     */
    private async pruneBacklog(repository: Repository<BdMetaEvent>, pixelId: string) {
        const [edge] = await repository
            .createQueryBuilder('event')
            .select('event.id', 'id')
            .where('event.pixelId = :pixelId', { pixelId })
            .andWhere('event.status = :status', { status: 'queued' })
            .andWhere('event.source = :source', { source: 'browser' })
            .orderBy('event.id', 'DESC')
            .offset(SEND_LIMITS.browserBacklog)
            .limit(1)
            .getRawMany<{ id: number }>();
        if (!edge) return;
        const skipped = await repository.update(
            { pixelId, status: 'queued', source: 'browser', id: LessThanOrEqual(edge.id) },
            { status: 'skipped', error: META_EVENT_ERRORS.backlog, clientIp: null, userAgent: null },
        );
        Logger.warn(
            `Skipped ${skipped.affected ?? 0} old browser events of Pixel ${pixelId}: too many waiting`,
            loggerCtx,
        );
    }

    /** Puts leased events back: due after `delayMs` (now by default), still queued. */
    private async unlease(repository: Repository<BdMetaEvent>, events: BdMetaEvent[], delayMs = 0) {
        if (!events.length) return;
        await repository.update(
            { id: In(events.map(event => event.id)), status: 'queued' },
            { nextAttemptAt: new Date(Date.now() + delayMs) },
        );
    }

    private async sendBatch(
        ctx: RequestContext,
        pixelId: string,
        token: string,
        events: BdMetaEvent[],
        testCode: string,
        budget: { requests: number },
    ): Promise<BatchOutcome> {
        const repository = this.connection.getRepository(ctx, BdMetaEvent);
        budget.requests -= 1;
        const result = await this.post(pixelId, token, events, testCode);
        if (result.ok) {
            // Meta answers per request: `batch_size` says how many events that request carried.
            const response: MetaPayload = { ...result.body, batch_size: events.length };
            await repository.update(
                { id: In(events.map(event => event.id)), status: 'queued' },
                {
                    status: 'sent',
                    sentAt: new Date(),
                    response,
                    error: null,
                    clientIp: null,
                    userAgent: null,
                },
            );
            return { sent: events.length, stop: false };
        }
        if (result.kind === 'token' || result.kind === 'pixel') {
            // A refused token or Pixel: hold all of this Pixel's events (these too, untouched) and warn
            // the merchant. Saving a new token, or a test event that works, releases them.
            await this.settings.hold(ctx, {
                pixelId,
                kind: result.kind,
                message: result.message,
                at: new Date().toISOString(),
            });
            Logger.error(`Meta refused Pixel ${pixelId} (${result.kind}): ${result.message}`, loggerCtx);
            await this.unlease(repository, events);
            return { sent: 0, stop: true };
        }
        if (result.kind === 'invalid' && events.length > 1) {
            // Meta refuses the whole batch for one bad event: split it in halves to find it, a few
            // requests instead of one per event. Out of requests: the rest waits for the next run.
            if (budget.requests < 2) {
                await this.unlease(repository, events, MINUTE);
                return { sent: 0, stop: true };
            }
            const middle = Math.ceil(events.length / 2);
            const first = await this.sendBatch(
                ctx,
                pixelId,
                token,
                events.slice(0, middle),
                testCode,
                budget,
            );
            if (first.stop) {
                await this.unlease(repository, events.slice(middle), MINUTE);
                return first;
            }
            const second = await this.sendBatch(ctx, pixelId, token, events.slice(middle), testCode, budget);
            return { sent: first.sent + second.sent, stop: second.stop };
        }
        for (const event of events) {
            const attempts = event.attempts + 1;
            const give = result.kind === 'invalid' || attempts >= MAX_ATTEMPTS;
            await repository.update(
                { id: event.id, status: 'queued' },
                {
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
                },
            );
        }
        // Meta is busy: leave this Pixel alone until the next run.
        return { sent: 0, stop: result.kind === 'retry' };
    }

    private async post(
        pixelId: string,
        token: string,
        events: BdMetaEvent[],
        testCode: string,
    ): Promise<PostResult> {
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
            this.noticeWarnings(response.headers, body.messages);
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
            const error = (body.error ?? {}) as { code?: number; error_subcode?: number; message?: string };
            const message = redactText(
                `${error.code ?? response.status}: ${error.message ?? 'no message'}`,
            ).slice(0, 400);
            return {
                ok: false,
                kind: classifyMetaError(response.status, error.code, error.error_subcode),
                message,
            };
        } catch (error) {
            return { ok: false, kind: 'retry', message: String(error).slice(0, 400) };
        }
    }

    /**
     * Meta says when our Graph API version is going away: a version header that isn't ours (Meta
     * moved the call to a newer version) or a `…warning` header, and sometimes `messages` in the
     * answer. The platform team needs to know (META_GRAPH_VERSION): logged once per process, as a
     * warning. Header names from memory of Meta's docs, so any header naming a warning counts.
     */
    private noticeWarnings(headers: Headers, messages: unknown) {
        const notes: string[] = [];
        const version = headers.get('facebook-api-version');
        if (version && version !== META_GRAPH_VERSION)
            notes.push(`Meta answered with Graph API ${version}, not ${META_GRAPH_VERSION}`);
        headers.forEach((value, name) => {
            if (/warning|deprecat/i.test(name)) notes.push(`${name}: ${value}`);
        });
        if (Array.isArray(messages))
            for (const message of messages) notes.push(`message: ${JSON.stringify(message)}`);
        for (const note of notes) {
            const text = redactText(note).slice(0, 400);
            if (this.warned.has(text) || this.warned.size >= 100) continue;
            this.warned.add(text);
            Logger.warn(`Meta warning (check META_GRAPH_VERSION and Meta's changelog): ${text}`, loggerCtx);
        }
    }

    /**
     * "Send test event": a PageView straight to Meta, only with a test event code (so it shows in
     * Test Events and never counts in the live dataset), and Meta's answer. If it works for a held
     * Pixel, the hold ends: the merchant fixed the cause in Meta. `code` is ours, for the admin's
     * bilingual text; `message` is Meta's own.
     */
    async sendTest(ctx: RequestContext, pixelId: string) {
        const fail = (code: 'noToken' | 'noTestCode' | 'refused', message: string | null = null) => ({
            ok: false,
            code,
            message,
            eventsReceived: null,
            fbtraceId: null,
        });
        const token = await this.settings.token(ctx, pixelId);
        if (!token) return fail('noToken');
        const settings = await this.settings.get(ctx);
        if (!settings.testEventCode) return fail('noTestCode');
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
            // Never due for the sending task: this event is sent right here.
            nextAttemptAt: null,
        });
        event.payload.event_id = event.eventId;
        const repository = this.connection.getRepository(ctx, BdMetaEvent);
        const saved = await repository.save(event);
        const result = await this.post(pixelId, token, [saved], settings.testEventCode);
        const response: MetaPayload | null = result.ok ? { ...result.body, batch_size: 1 } : null;
        await repository.update(saved.id, {
            status: result.ok ? 'sent' : 'failed',
            sentAt: result.ok ? new Date() : null,
            response,
            error: result.ok ? null : result.message,
            userAgent: null,
        });
        if (!result.ok) return fail('refused', result.message);
        await this.settings.release(ctx, pixelId);
        return {
            ok: true,
            code: null,
            message: null,
            eventsReceived: Number(result.body.events_received),
            fbtraceId: String(result.body.fbtrace_id ?? ''),
        };
    }

    // ── Staff and housekeeping ───────────────────────────────────────────────────────────────

    /**
     * The event log, newest first, a page at a time: by event, status and order (its code or
     * number). Browser events stay 7 days and Purchases 90 (`retention`).
     */
    async events(
        ctx: RequestContext,
        filter: {
            eventName?: string | null;
            status?: string | null;
            order?: string | null;
            skip?: number | null;
            take?: number | null;
        },
    ) {
        let orderId: ID | undefined;
        const order = filter.order?.trim();
        if (order) {
            const found = await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder('order')
                .select('order.id', 'id')
                .where('order.code = :order', { order })
                .orWhere('order.customFieldsOrdernumber = :order', { order })
                .limit(1)
                .getRawOne<{ id: ID }>();
            if (!found) return { items: [], totalItems: 0 };
            orderId = found.id;
        }
        const [items, totalItems] = await this.connection.getRepository(ctx, BdMetaEvent).findAndCount({
            where: {
                ...(filter.eventName ? { eventName: filter.eventName } : {}),
                ...(filter.status ? { status: filter.status as BdMetaEvent['status'] } : {}),
                ...(orderId !== undefined ? { orderId } : {}),
            },
            order: { id: 'DESC' },
            skip: Math.max(0, filter.skip ?? 0),
            take: Math.min(100, Math.max(1, filter.take ?? 50)),
        });
        return { items, totalItems };
    }

    /**
     * Retention (daily): browser and test events are kept 7 days and Purchases 90 for the log; the
     * shopper's raw IP and browser on orders 90 days from when the order was created, placed or not
     * (an abandoned or failed checkout too). Returns how many event rows were removed.
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
            .set({ customFields: { metaClientIp: null, metaUserAgent: null } } as never)
            .where('"createdAt" < :before', { before: new Date(Date.now() - ORDER_CONTEXT_DAYS * DAY) })
            .andWhere('("customFieldsMetaclientip" IS NOT NULL OR "customFieldsMetauseragent" IS NOT NULL)')
            .execute();
        return (browser.affected ?? 0) + (server.affected ?? 0);
    }
}
