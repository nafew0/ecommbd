import { findDistrict, findThana } from '@ecommbd/bd-geo';
import {
    CircuitBreaker,
    COURIER_BASE_URLS,
    COURIERS,
    courierCod,
    type Courier,
    type CourierMode,
    courierOutcome,
    courierPhone,
    courierTrackingUrl,
    createHttpClient,
    startOfDhakaDay,
    type HttpClient,
    isCourier,
    matchPlace,
    outcomeMovesOn,
    redactObject,
    type ShippingZone,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
    AdministratorService,
    HistoryService,
    type ID,
    isGraphQlErrorResult,
    type JobQueue,
    JobQueueService,
    Logger,
    Order,
    OrderService,
    ProductVariant,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { timingSafeEqual } from 'node:crypto';
import { In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not } from 'typeorm';
import { OrderActionsService, settledAmount } from '../bd-orders';
import type { ShipmentInfo } from '../bd-orders/shipment-info';
import {
    BOOK_JOB,
    COURIER_HISTORY_TYPE,
    COURIER_NAMES,
    COURIER_ROUTE,
    COURIERS_OPTIONS,
    loggerCtx,
} from './constants';
import { CourierSettingsService } from './courier-settings.service';
import { pathaoDriver } from './drivers/pathao';
import { steadfastDriver } from './drivers/steadfast';
import { type CourierCall, type CourierDriver, CourierError, type ParcelInput } from './drivers/types';
import { BdCourierBooking, BdCourierLocation, BdCourierLocationMap, type CourierEvent } from './entities';
import type { CouriersPluginOptions } from './types';

const DRIVERS: Record<Courier, CourierDriver> = { steadfast: steadfastDriver, pathao: pathaoDriver };

export type CourierErrorCode =
    | 'ORDER_NOT_FOUND'
    | 'NOT_READY'
    | 'NO_COURIER'
    | 'COURIER_OFF'
    | 'UNMAPPED_ADDRESS'
    | 'NO_PHONE'
    | 'NO_PATHAO_STORE'
    | 'COURIER_REFUSED'
    | 'COURIER_UNAVAILABLE'
    | 'ALREADY_BOOKED'
    | 'NOT_BOOKED'
    | 'ALREADY_PICKED_UP'
    | 'INVALID_INPUT';

export class CourierActionError extends Error {
    constructor(
        readonly code: CourierErrorCode,
        readonly detail?: string,
    ) {
        super(code);
    }
}

const MINUTE = 60_000;
/** Active parcels are asked about every 30 minutes, for 30 days at most. */
const POLL_EVERY_MS = 30 * MINUTE;
const POLL_FOR_MS = 30 * 24 * 60 * MINUTE;
const MAX_EVENTS = 40;
const UNIQUE_VIOLATION = '23505';

/**
 * Couriers (roadmap phase 19). Booking writes the booking row first (the order's one live booking:
 * a unique key), then asks the courier; a refused or failed booking is kept with its reason. Status
 * updates come by webhook and polling and move the order through our own order actions: picked up →
 * Shipped, delivered → Delivered (COD settles), returned → Returned. Never backwards.
 */
@Injectable()
export class CourierService implements OnModuleInit, OnApplicationShutdown {
    private readonly http: HttpClient;
    private readonly breaker = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 3 * MINUTE });
    private queue: JobQueue<{ orderId: string; courier: string | null; by: string | null }> | undefined;

    constructor(
        @Inject(COURIERS_OPTIONS) private options: CouriersPluginOptions,
        private connection: TransactionalConnection,
        private settings: CourierSettingsService,
        private orderService: OrderService,
        private orderActions: OrderActionsService,
        private historyService: HistoryService,
        private requestContextService: RequestContextService,
        private administrators: AdministratorService,
        private jobQueueService: JobQueueService,
    ) {
        this.http = createHttpClient({
            timeoutMs: 20_000,
            circuitBreaker: this.breaker,
            ssrfProtection: !options.baseUrls,
            userAgent: 'EcommBD-Couriers',
        });
    }

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: BOOK_JOB,
            process: async job => {
                const ctx = await this.background();
                const result = await this.book(ctx, job.data.orderId, job.data.courier, job.data.by);
                if (result instanceof CourierActionError && result.code !== 'ALREADY_BOOKED') {
                    Logger.warn(`Bulk booking skipped order ${job.data.orderId}: ${result.code}`, loggerCtx);
                }
            },
        });
    }

    async onApplicationShutdown() {
        await this.http.close();
    }

    background(): Promise<RequestContext> {
        return this.requestContextService.create({ apiType: 'admin' });
    }

    get publicUrl(): string | null {
        return this.options.publicUrl ? this.options.publicUrl.replace(/\/$/, '') : null;
    }

    /** The courier, ready to call: on, with complete credentials for its mode. */
    async handle(ctx: RequestContext, courier: Courier, mode?: CourierMode) {
        const settings = await this.settings.get(ctx);
        if (!mode && !settings[courier].enabled) return null;
        const useMode = mode ?? (await this.settings.mode(ctx, courier));
        const credentials = await this.settings.credentials(ctx, courier, useMode);
        if (!this.settings.complete(courier, credentials)) return null;
        const call: CourierCall = {
            http: this.http,
            baseUrl: this.options.baseUrls?.[courier] ?? COURIER_BASE_URLS[courier][useMode],
            credentials: credentials!,
        };
        return { courier, mode: useMode, driver: DRIVERS[courier], call };
    }

    paused(courier: Courier, mode: CourierMode): boolean {
        const base = this.options.baseUrls?.[courier] ?? COURIER_BASE_URLS[courier][mode];
        return this.breaker.state(new URL(base).host) === 'open';
    }

    async testConnection(ctx: RequestContext, courier: Courier, mode: CourierMode) {
        const handle = await this.handle(ctx, courier, mode);
        if (!handle) return { ok: false, message: 'Save all the credentials for this mode first' };
        return handle.driver.testConnection(handle.call);
    }

    // ── Booking ──────────────────────────────────────────────────────────────────────────────

    /** The order's live booking, else its latest one. */
    async bookingFor(ctx: RequestContext, orderId: ID): Promise<BdCourierBooking | null> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        return (
            (await repository.findOne({ where: { activeKey: String(orderId) } })) ??
            (await repository.findOne({ where: { orderId }, order: { id: 'DESC' } }))
        );
    }

    /**
     * Books one order. A Confirmed order is packed first (stores that skip packing). Idempotent: an
     * order that already has a live booking gets it back.
     */
    async book(
        ctx: RequestContext,
        orderId: ID,
        chosen?: string | null,
        by?: string | null,
    ): Promise<BdCourierBooking | CourierActionError> {
        const existing = await this.connection
            .getRepository(ctx, BdCourierBooking)
            .findOne({ where: { activeKey: String(orderId) } });
        if (existing) return existing;
        let order = await this.orderService.findOne(ctx, orderId);
        if (!order) return new CourierActionError('ORDER_NOT_FOUND');
        if (order.state === 'Confirmed') {
            const packed = await this.orderActions.pack(ctx, { orderId, expectedStatus: 'confirmed' });
            if (isGraphQlErrorResult(packed)) return new CourierActionError('NOT_READY', packed.message);
            order = (await this.orderService.findOne(ctx, orderId))!;
        }
        if (order.state !== 'Packed') return new CourierActionError('NOT_READY');
        const courier = chosen ?? (await this.defaultCourier(ctx, order));
        if (!courier) return new CourierActionError('NO_COURIER');
        if (!isCourier(courier)) return new CourierActionError('INVALID_INPUT');
        const handle = await this.handle(ctx, courier);
        if (!handle) return new CourierActionError('COURIER_OFF');

        const parcel = await this.parcel(ctx, order, courier);
        if (parcel instanceof CourierActionError) {
            // Kept (not live) so the unmapped addresses screen can list it.
            await this.failed(ctx, order, courier, handle.mode, parcel, null, by ?? null);
            return parcel;
        }
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        let booking: BdCourierBooking;
        try {
            booking = await repository.save(
                new BdCourierBooking({
                    orderId: order.id,
                    activeKey: String(order.id),
                    courier,
                    mode: handle.mode,
                    status: 'booking',
                    codAmount: parcel.codAmount * 100,
                    weightGrams: Math.round(parcel.weightKg * 1000),
                    outcome: 'booked',
                    bookedBy: by ?? (await this.staffName(ctx)),
                    events: [],
                }),
            );
        } catch (error) {
            // A double click or a retry: the other request is booking it.
            if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
                return (await this.bookingFor(ctx, order.id)) ?? new CourierActionError('ALREADY_BOOKED');
            }
            throw error;
        }
        try {
            const booked = await handle.driver.createParcel(handle.call, parcel);
            await repository.update(booking.id, {
                status: 'booked',
                consignmentId: booked.consignmentId,
                trackingCode: booked.trackingCode,
                courierStatus: booked.status,
                deliveryFee: booked.deliveryFee,
                nextPollAt: new Date(Date.now() + POLL_EVERY_MS),
                events: withEvent(booking.events, 'book', booked.status, booked.raw),
            });
            await this.history(ctx, order.id, courier, 'booked', { consignmentId: booked.consignmentId });
        } catch (error) {
            const refused = error instanceof CourierError && error.refused;
            if (!refused)
                Logger.warn(`${courier} booking failed for order ${order.id}: ${String(error)}`, loggerCtx);
            const reason = new CourierActionError(
                refused ? 'COURIER_REFUSED' : 'COURIER_UNAVAILABLE',
                error instanceof Error ? error.message : String(error),
            );
            await repository.update(booking.id, {
                status: 'failed',
                activeKey: null,
                errorCode: reason.code,
                errorMessage: (reason.detail ?? '').slice(0, 500),
                events: withEvent(
                    booking.events,
                    'book',
                    'error',
                    error instanceof CourierError ? error.raw : null,
                ),
            });
            await this.history(ctx, order.id, courier, 'booking-failed', {
                message: reason.detail?.slice(0, 200),
            });
            return reason;
        }
        return (await repository.findOne({ where: { id: booking.id } }))!;
    }

    /** Bulk booking: each order is a job (one courier call each), so 50 orders never hold a request open. */
    async bookMany(ctx: RequestContext, orderIds: ID[], courier?: string | null): Promise<number> {
        if (courier && !isCourier(courier)) throw new CourierActionError('INVALID_INPUT');
        const by = await this.staffName(ctx);
        for (const orderId of orderIds) {
            await this.queue!.add({ orderId: String(orderId), courier: courier ?? null, by }, { retries: 0 });
        }
        return orderIds.length;
    }

    /** The manual fallback: the parcel was booked outside (a courier's panel, a phone call). */
    async markBookedManually(
        ctx: RequestContext,
        input: { orderId: ID; courierName: string; trackingCode: string },
    ): Promise<BdCourierBooking | CourierActionError> {
        const name = input.courierName.trim().slice(0, 40);
        const code = input.trackingCode.trim().slice(0, 60);
        if (!name || !code) return new CourierActionError('INVALID_INPUT');
        const order = await this.orderService.findOne(ctx, input.orderId);
        if (!order) return new CourierActionError('ORDER_NOT_FOUND');
        if (order.state !== 'Packed' && order.state !== 'Confirmed')
            return new CourierActionError('NOT_READY');
        const known = COURIERS.find(courier => COURIER_NAMES[courier].toLowerCase() === name.toLowerCase());
        try {
            const booking = await this.connection.getRepository(ctx, BdCourierBooking).save(
                new BdCourierBooking({
                    orderId: order.id,
                    activeKey: String(order.id),
                    courier: (known ?? name.toLowerCase()) as Courier,
                    mode: 'live',
                    status: 'manual',
                    consignmentId: code,
                    trackingCode: code,
                    codAmount: Math.max(0, order.totalWithTax - settledAmount(order)),
                    outcome: 'booked',
                    bookedBy: await this.staffName(ctx),
                    events: withEvent([], 'manual', 'booked', { courier: name }),
                }),
            );
            await this.history(ctx, order.id, name, 'manual', { consignmentId: code });
            return booking;
        } catch (error) {
            if ((error as { code?: string }).code === UNIQUE_VIOLATION)
                return new CourierActionError('ALREADY_BOOKED');
            throw error;
        }
    }

    /**
     * The booking is cancelled (staff cancelled it in the courier's panel), only before pickup. A
     * picked-up parcel can't be cancelled: it comes back as a return.
     */
    async cancelBooking(ctx: RequestContext, orderId: ID): Promise<BdCourierBooking | CourierActionError> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const booking = await repository.findOne({ where: { activeKey: String(orderId) } });
        if (!booking) return new CourierActionError('NOT_BOOKED');
        if (booking.outcome !== 'booked') return new CourierActionError('ALREADY_PICKED_UP');
        await repository.update(booking.id, {
            status: 'cancelled',
            activeKey: null,
            outcome: 'cancelled',
            nextPollAt: null,
            events: withEvent(booking.events, 'cancel', 'cancelled', { by: await this.staffName(ctx) }),
        });
        await this.history(ctx, orderId, booking.courier, 'cancelled', {
            consignmentId: booking.consignmentId ?? undefined,
        });
        return (await repository.findOne({ where: { id: booking.id } }))!;
    }

    private async defaultCourier(ctx: RequestContext, order: Order): Promise<Courier | null> {
        const settings = await this.settings.get(ctx);
        const thana = findThana(String(order.shippingAddress?.customFields?.thanaId ?? ''));
        const zone = (thana?.zone ?? 'outside_dhaka') as ShippingZone;
        const byZone = settings.defaultByZone[zone];
        if (byZone && settings[byZone].enabled) return byZone;
        const enabled = COURIERS.filter(courier => settings[courier].enabled);
        return enabled.length === 1 ? enabled[0]! : null;
    }

    /** What the courier gets: name, phone, address, COD, item description and weight. Nothing more. */
    private async parcel(
        ctx: RequestContext,
        order: Order,
        courier: Courier,
    ): Promise<ParcelInput | CourierActionError> {
        const settings = await this.settings.get(ctx);
        const address = order.shippingAddress ?? {};
        const fields = (address.customFields ?? {}) as {
            districtId?: string;
            thanaId?: string;
            area?: string;
            landmark?: string;
        };
        const phone = address.phoneNumber || order.customer?.phoneNumber;
        if (!phone) return new CourierActionError('NO_PHONE');
        const district = fields.districtId ? findDistrict(fields.districtId) : undefined;
        const thana = fields.thanaId ? findThana(fields.thanaId) : undefined;
        const lines = order.lines.filter(line => line.quantity > 0);
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(lines.map(line => line.productVariantId)) },
            withDeleted: true,
        });
        const grams = lines.reduce((sum, line) => {
            const variant = variants.find(item => String(item.id) === String(line.productVariantId));
            const weight = (variant?.customFields as { weightGrams?: number | null } | undefined)
                ?.weightGrams;
            return sum + (weight || settings.defaultWeightGrams) * line.quantity;
        }, 0);
        const parcel: ParcelInput = {
            invoice: order.customFields.orderNumber ?? order.code,
            recipientName: address.fullName || order.customer?.firstName || 'Customer',
            recipientPhone: courierPhone(phone),
            recipientAddress: [address.streetLine1, fields.area, fields.landmark, thana?.en, district?.en]
                .filter(Boolean)
                .join(', '),
            codAmount: courierCod(Math.max(0, order.totalWithTax - settledAmount(order))),
            note: order.customFields.customerNote ?? '',
            itemDescription: lines
                .map(line => `${line.productVariant?.name ?? 'Item'} x${line.quantity}`)
                .join(', '),
            itemQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
            // Pathao takes 0.5–10 kg, in tenths.
            weightKg: Math.min(10, Math.max(0.5, Math.round(grams / 100) / 10)),
        };
        if (courier === 'pathao') {
            if (!settings.pathao.storeId) return new CourierActionError('NO_PATHAO_STORE');
            const place = await this.pathaoPlace(ctx, fields.districtId ?? '', fields.thanaId ?? '');
            if (!place) return new CourierActionError('UNMAPPED_ADDRESS');
            parcel.pathao = {
                storeId: settings.pathao.storeId,
                cityId: place.cityId,
                zoneId: place.zoneId,
                areaId: place.areaId,
                deliveryType: settings.pathao.deliveryType,
                itemType: settings.pathao.itemType,
            };
        }
        return parcel;
    }

    private async failed(
        ctx: RequestContext,
        order: Order,
        courier: Courier,
        mode: CourierMode,
        reason: CourierActionError,
        detail: string | null,
        by: string | null,
    ) {
        await this.connection.getRepository(ctx, BdCourierBooking).save(
            new BdCourierBooking({
                orderId: order.id,
                activeKey: null,
                courier,
                mode,
                status: 'failed',
                codAmount: 0,
                outcome: 'note',
                errorCode: reason.code,
                errorMessage: detail,
                bookedBy: by ?? (await this.staffName(ctx)),
                events: [],
            }),
        );
    }

    // ── Pathao places ─────────────────────────────────────────────────────────────────────────

    /**
     * Our district and thana as Pathao's city and zone: a saved map first; else matched by name and
     * aliases from the cached location list (and saved as `auto`); else null (unmapped).
     */
    async pathaoPlace(ctx: RequestContext, districtId: string, thanaId: string) {
        if (!districtId || !thanaId) return null;
        const maps = this.connection.getRepository(ctx, BdCourierLocationMap);
        const saved = await maps.findOne({ where: { courier: 'pathao', districtId, thanaId } });
        if (saved) return saved;
        const district = findDistrict(districtId);
        const thana = findThana(thanaId);
        if (!district || !thana) return null;
        const locations = this.connection.getRepository(ctx, BdCourierLocation);
        const cities = await locations.find({ where: { courier: 'pathao', kind: 'city' } });
        const city = matchPlace(
            [district.en, ...district.aliases],
            cities.map(c => ({ id: c.externalId, name: c.name })),
        );
        if (!city) return null;
        const zones = await locations.find({ where: { courier: 'pathao', kind: 'zone', parentId: city.id } });
        const zone = matchPlace(
            [thana.en, ...thana.aliases],
            zones.map(z => ({ id: z.externalId, name: z.name })),
        );
        if (!zone) return null;
        return maps.save(
            new BdCourierLocationMap({
                courier: 'pathao',
                districtId,
                thanaId,
                cityId: city.id,
                zoneId: zone.id,
                areaId: null,
                source: 'auto',
            }),
        );
    }

    /** Fetches Pathao's cities and zones (weekly, or "Sync now"). Returns how many of each. */
    async syncPathaoLocations(ctx: RequestContext): Promise<{ cities: number; zones: number }> {
        const handle = await this.handle(ctx, 'pathao', await this.settings.mode(ctx, 'pathao'));
        if (!handle) throw new CourierActionError('COURIER_OFF');
        const cities = await pathaoDriver.cities(handle.call);
        const repository = this.connection.getRepository(ctx, BdCourierLocation);
        let zones = 0;
        for (const city of cities) {
            await repository.upsert(
                { courier: 'pathao', kind: 'city', externalId: city.id, parentId: null, name: city.name },
                ['courier', 'kind', 'externalId'],
            );
            for (const zone of await pathaoDriver.zones(handle.call, city.id)) {
                zones++;
                await repository.upsert(
                    {
                        courier: 'pathao',
                        kind: 'zone',
                        externalId: zone.id,
                        parentId: city.id,
                        name: zone.name,
                    },
                    ['courier', 'kind', 'externalId'],
                );
            }
        }
        return { cities: cities.length, zones };
    }

    locations(ctx: RequestContext, kind: 'city' | 'zone', parentId?: number | null) {
        return this.connection.getRepository(ctx, BdCourierLocation).find({
            where: { courier: 'pathao', kind, ...(parentId ? { parentId } : {}) },
            order: { name: 'ASC' },
        });
    }

    /**
     * Addresses Pathao couldn't place: the latest failed booking of each order still waiting to be
     * booked, by district and thana, with how many orders wait.
     */
    async unmapped(ctx: RequestContext) {
        const rows: Array<{ orderId: number; districtId: string | null; thanaId: string | null }> =
            await this.connection.getRepository(ctx, BdCourierBooking).query(
                // Vendure keeps the shipping address as JSON text.
                `SELECT DISTINCT ON (b."orderId") b."orderId",
                        o."shippingAddress"::jsonb -> 'customFields' ->> 'districtId' AS "districtId",
                        o."shippingAddress"::jsonb -> 'customFields' ->> 'thanaId' AS "thanaId"
                 FROM bd_courier_booking b
                 JOIN "order" o ON o.id = b."orderId"
                 WHERE b."errorCode" = 'UNMAPPED_ADDRESS'
                   AND o.state IN ('Confirmed', 'Packed')
                   AND NOT EXISTS (SELECT 1 FROM bd_courier_booking live WHERE live."activeKey" = b."orderId"::text)
                 ORDER BY b."orderId", b.id DESC`,
            );
        const groups = new Map<string, { districtId: string; thanaId: string; orderIds: number[] }>();
        for (const row of rows) {
            if (!row.districtId || !row.thanaId) continue;
            const mapped = await this.connection
                .getRepository(ctx, BdCourierLocationMap)
                .count({ where: { courier: 'pathao', districtId: row.districtId, thanaId: row.thanaId } });
            if (mapped) continue;
            const key = `${row.districtId}|${row.thanaId}`;
            const group = groups.get(key) ?? {
                districtId: row.districtId,
                thanaId: row.thanaId,
                orderIds: [],
            };
            group.orderIds.push(row.orderId);
            groups.set(key, group);
        }
        return [...groups.values()];
    }

    async setPathaoMapping(
        ctx: RequestContext,
        input: {
            districtId: string;
            thanaId: string;
            cityId: number;
            zoneId: number;
            areaId?: number | null;
        },
    ) {
        if (!findDistrict(input.districtId) || (!findThana(input.thanaId) && input.thanaId !== 'other')) {
            throw new CourierActionError('INVALID_INPUT');
        }
        const zone = await this.connection.getRepository(ctx, BdCourierLocation).findOne({
            where: { courier: 'pathao', kind: 'zone', externalId: input.zoneId, parentId: input.cityId },
        });
        if (!zone) throw new CourierActionError('INVALID_INPUT');
        const repository = this.connection.getRepository(ctx, BdCourierLocationMap);
        await repository.upsert(
            {
                courier: 'pathao',
                districtId: input.districtId,
                thanaId: input.thanaId,
                cityId: input.cityId,
                zoneId: input.zoneId,
                areaId: input.areaId ?? null,
                source: 'manual',
            },
            ['courier', 'districtId', 'thanaId'],
        );
        return repository.findOne({
            where: { courier: 'pathao', districtId: input.districtId, thanaId: input.thanaId },
        });
    }

    // ── Status sync ───────────────────────────────────────────────────────────────────────────

    /**
     * `/bd-courier/webhook/<courier>/<secret>`: checks the secret in the URL and the courier's own
     * header, then applies the status. An unknown consignment is logged and ignored (never an error,
     * so the courier doesn't retry forever). Returns what to answer.
     */
    async webhook(
        courier: string,
        secret: string,
        headers: Record<string, string | undefined>,
        body: unknown,
    ): Promise<{ status: number; headers?: Record<string, string> }> {
        if (!isCourier(courier)) return { status: 404 };
        const ctx = await this.background();
        const expected = await this.settings.webhookSecret(ctx, courier);
        const header =
            courier === 'pathao'
                ? headers['x-pathao-signature']
                : (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const reading = DRIVERS[courier].readWebhook(body);
        if (!expected || !same(secret, expected)) return { status: 401 };
        if (reading.kind === 'handshake') {
            // Pathao checks the URL by asking us to echo its integration secret.
            const echo = headers['x-pathao-merchant-webhook-integration-secret'] ?? expected;
            return { status: 202, headers: { 'X-Pathao-Merchant-Webhook-Integration-Secret': echo } };
        }
        if (!header || !same(header, expected)) return { status: 401 };
        if (reading.kind === 'ignored') return { status: 202 };
        const booking = await this.connection
            .getRepository(ctx, BdCourierBooking)
            .findOne({
                where: { courier, consignmentId: reading.consignmentId, status: In(['booked', 'cancelled']) },
            });
        if (!booking) {
            Logger.warn(`${courier} webhook for an unknown consignment, ignored`, loggerCtx);
            return { status: 202 };
        }
        await this.applyStatus(ctx, booking.id, reading.status, reading.at, 'webhook', reading.raw);
        return { status: 202 };
    }

    /** The polling task: asks about every active parcel that's due. Returns how many were asked. */
    async poll(limit = 100): Promise<number> {
        const ctx = await this.background();
        const due = await this.connection.getRepository(ctx, BdCourierBooking).find({
            where: {
                status: 'booked',
                outcome: In(['booked', 'pickedUp', 'partiallyDelivered', 'note']),
                nextPollAt: LessThanOrEqual(new Date()),
            },
            order: { nextPollAt: 'ASC' },
            take: limit,
        });
        for (const booking of due) {
            await this.check(ctx, booking.id).catch(error =>
                Logger.error(`Polling booking ${booking.id} failed: ${String(error)}`, loggerCtx),
            );
        }
        return due.length;
    }

    /** "Check status now" and polling: asks the courier, applies the answer. */
    async check(ctx: RequestContext, bookingId: ID): Promise<BdCourierBooking | null> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const booking = await repository.findOne({ where: { id: bookingId } });
        if (!booking?.consignmentId || booking.status !== 'booked') return booking;
        const handle = await this.handle(ctx, booking.courier, booking.mode);
        const old = Date.now() - booking.createdAt.getTime() > POLL_FOR_MS;
        const next = old ? null : new Date(Date.now() + POLL_EVERY_MS);
        if (!handle) {
            await repository.update(booking.id, { nextPollAt: next });
            return booking;
        }
        try {
            const status = await handle.driver.getStatus(handle.call, booking.consignmentId);
            await this.applyStatus(ctx, booking.id, status.status, status.at, 'poll', status.raw);
        } catch (error) {
            Logger.warn(`${booking.courier} status check failed: ${String(error)}`, loggerCtx);
        }
        await repository.update({ id: booking.id, status: 'booked' }, { nextPollAt: next });
        return repository.findOne({ where: { id: booking.id } });
    }

    /**
     * Applies a courier status once, in order: the booking row is locked; a status older than the
     * last applied one, or one that would move backwards, is only recorded. Then the order follows.
     */
    async applyStatus(
        ctx: RequestContext,
        bookingId: ID,
        status: string,
        at: Date | null,
        source: string,
        raw: unknown,
    ) {
        const result = await this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, BdCourierBooking);
            const booking = await repository
                .createQueryBuilder('booking')
                .setLock('pessimistic_write')
                .where('booking.id = :id', { id: bookingId })
                .getOne();
            if (!booking) return null;
            const outcome = courierOutcome(booking.courier, status);
            const events = withEvent(booking.events, source, status, raw);
            const stale = !!at && !!booking.statusAt && at < booking.statusAt;
            if (stale || !outcomeMovesOn(booking.outcome, outcome)) {
                await repository.update(booking.id, {
                    events,
                    ...(stale ? {} : { courierStatus: status.slice(0, 60) }),
                });
                return null;
            }
            const final = outcome === 'delivered' || outcome === 'returned' || outcome === 'cancelled';
            await repository.update(booking.id, {
                events,
                outcome,
                courierStatus: status.slice(0, 60),
                // Only the courier's own times order updates (one without a time keeps the last).
                statusAt: at ?? booking.statusAt,
                outcomeAt: new Date(),
                ...(final ? { nextPollAt: null } : {}),
                ...(outcome === 'cancelled' ? { status: 'cancelled' as const, activeKey: null } : {}),
            });
            return { booking, outcome };
        });
        if (!result) return;
        const { booking, outcome } = result;
        await this.history(ctx, booking.orderId, booking.courier, 'status', {
            consignmentId: booking.consignmentId ?? undefined,
            status: status.slice(0, 60),
            outcome,
        });
        await this.moveOrder(ctx, booking, outcome);
    }

    /** The order follows the parcel, through the same actions staff use (a missed pickup is filled in). */
    private async moveOrder(ctx: RequestContext, booking: BdCourierBooking, outcome: string) {
        const ship = async () => {
            const order = await this.orderService.findOne(ctx, booking.orderId);
            if (order?.state !== 'Packed') return;
            const result = await this.orderActions.markShipped(ctx, {
                orderId: booking.orderId,
                expectedStatus: 'packed',
                shipment: {
                    method: COURIER_NAMES[booking.courier] ?? booking.courier,
                    trackingCode: booking.consignmentId ?? '',
                },
            });
            if (isGraphQlErrorResult(result))
                Logger.warn(`Couldn't mark order ${booking.orderId} shipped: ${result.message}`, loggerCtx);
        };
        if (outcome === 'pickedUp') await ship();
        if (outcome === 'delivered') {
            await ship();
            const result = await this.orderActions.markDelivered(ctx, {
                orderId: booking.orderId,
                expectedStatus: 'shipped',
            });
            if (isGraphQlErrorResult(result))
                Logger.warn(`Couldn't mark order ${booking.orderId} delivered: ${result.message}`, loggerCtx);
        }
        if (outcome === 'returned') {
            await ship();
            const result = await this.orderActions.markReturned(ctx, {
                orderId: booking.orderId,
                note: `Returned by ${COURIER_NAMES[booking.courier] ?? booking.courier} (${booking.courierStatus ?? ''})`,
            });
            if (isGraphQlErrorResult(result))
                Logger.warn(`Couldn't mark order ${booking.orderId} returned: ${result.message}`, loggerCtx);
        }
    }

    // ── For other plugins and the home page ─────────────────────────────────────────────────

    /** The parcel for stickers, invoices and tracking (a live or finished booking with a consignment). */
    async shipmentInfo(ctx: RequestContext, orderId: ID): Promise<ShipmentInfo | null> {
        const booking = await this.connection.getRepository(ctx, BdCourierBooking).findOne({
            where: { orderId, status: In(['booked', 'manual']), consignmentId: Not(IsNull()) },
            order: { id: 'DESC' },
        });
        if (!booking?.consignmentId) return null;
        const known = isCourier(booking.courier);
        return {
            courier: known ? COURIER_NAMES[booking.courier] : booking.courier,
            consignmentId: booking.consignmentId,
            trackingCode: booking.trackingCode,
            trackingUrl:
                known && booking.status === 'booked'
                    ? courierTrackingUrl(booking.courier, {
                          consignmentId: booking.consignmentId,
                          trackingCode: booking.trackingCode,
                      })
                    : null,
        };
    }

    /** Whether the order has a live booking (editing and cancelling need it cancelled first). */
    async hasLiveBooking(ctx: RequestContext, orderId: ID): Promise<boolean> {
        return (
            (await this.connection
                .getRepository(ctx, BdCourierBooking)
                .count({ where: { activeKey: String(orderId) } })) > 0
        );
    }

    /** The home widget: in transit now, delivered today (Dhaka), returned this week. */
    async counts(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const startOfToday = startOfDhakaDay(new Date());
        const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * MINUTE);
        return {
            inTransit: await repository.count({ where: { status: 'booked', outcome: 'pickedUp' } }),
            deliveredToday: await repository.count({
                where: { outcome: 'delivered', outcomeAt: MoreThanOrEqual(startOfToday) },
            }),
            returnedThisWeek: await repository.count({
                where: { outcome: 'returned', outcomeAt: MoreThanOrEqual(startOfWeek) },
            }),
        };
    }

    webhookUrl(courier: Courier, secret: string | null): string | null {
        return this.publicUrl && secret
            ? `${this.publicUrl}/${COURIER_ROUTE}/webhook/${courier}/${secret}`
            : null;
    }

    private async history(
        ctx: RequestContext,
        orderId: ID,
        courier: string,
        event: string,
        extra: Record<string, string | undefined> = {},
    ) {
        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId,
            type: COURIER_HISTORY_TYPE,
            data: { courier, event, ...extra },
        });
    }

    private async staffName(ctx: RequestContext): Promise<string> {
        const administrator = ctx.activeUserId
            ? await this.administrators.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        return administrator ? `${administrator.firstName} ${administrator.lastName}`.trim() : 'system';
    }
}

/** Constant-time comparison of two secrets. */
function same(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

function withEvent(
    events: CourierEvent[] | null | undefined,
    source: string,
    status: string,
    data: unknown,
): CourierEvent[] {
    const event: CourierEvent = {
        at: new Date().toISOString(),
        source,
        status: status.slice(0, 60),
        data: JSON.stringify(redactObject(data) ?? null).slice(0, 4000),
    };
    return [...(events ?? []), event].slice(-MAX_EVENTS);
}
