import { findDistrict, findThana } from '@ecommbd/bd-geo';
import {
    cleanText,
    COURIERS,
    courierCod,
    type Courier,
    type CourierMode,
    courierOutcome,
    type CourierOutcome,
    courierPhone,
    courierTrackingUrl,
    HttpError,
    isCourier,
    LIVE_BOOKING_STATUSES,
    MANUAL_COURIER,
    outcomeMovesOn,
    redactObject,
    type ShippingZone,
    startOfDhakaDay,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
    AdministratorService,
    EventBus,
    HistoryService,
    type ID,
    isGraphQlErrorResult,
    type JobQueue,
    JobQueueService,
    Logger,
    Order,
    OrderService,
    PaymentStateTransitionEvent,
    ProductVariant,
    RefundStateTransitionEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { timingSafeEqual } from 'node:crypto';
import { In, IsNull, LessThan, LessThanOrEqual, MoreThanOrEqual, Not } from 'typeorm';
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
import { CourierClients, type CourierHandle } from './courier-clients.service';
import { CourierSettingsService } from './courier-settings.service';
import { pathaoDriver } from './drivers/pathao';
import { steadfastDriver } from './drivers/steadfast';
import { type CourierFailure, CourierError, type ParcelInput } from './drivers/types';
import { BdCourierBooking, type CourierEvent } from './entities';
import { CourierActionError } from './errors';
import { PathaoPlacesService } from './pathao-places.service';
import type { CouriersPluginOptions } from './types';

export { CourierActionError, type CourierErrorCode } from './errors';

const MINUTE = 60_000;
/** Active parcels are asked about every 30 minutes, for 30 days at most. */
const POLL_EVERY_MS = 30 * MINUTE;
const POLL_FOR_MS = 30 * 24 * 60 * MINUTE;
/** An unconfirmed booking, or an order that didn't follow its parcel, is tried again every 10 minutes. */
const RETRY_EVERY_MS = 10 * MINUTE;
/** Unconfirmed bookings are tried again on their own for a day; after that, only when staff ask. */
const RETRY_FOR_MS = 24 * 60 * MINUTE;
/** A booking still "booking" after this lost its answer (the server stopped mid-call): unconfirmed. */
const STUCK_AFTER_MS = 5 * MINUTE;
const MAX_EVENTS = 40;
const UNIQUE_VIOLATION = '23505';
/** Outcomes after which the courier has nothing more to say. */
const FINAL_OUTCOMES: readonly CourierOutcome[] = ['delivered', 'returned', 'cancelled'];
/** Order states that can't follow a parcel any further. */
const SETTLED_STATES = ['Delivered', 'Returned', 'Cancelled'];

type BookJob = { orderId: string; courier: string | null; by: string | null };

/**
 * Couriers (roadmap phase 19). Booking writes the booking row first (the order's one live booking:
 * a unique key), then asks the courier. A refusal is kept with its reason and frees the order to be
 * booked again; no clear answer (a timeout, a 5xx, a 429) keeps the booking live as `unconfirmed`, so
 * the same parcel is never made twice: it's tried again later, looked up at the courier first when
 * it may exist. Status updates come by webhook and polling and move the order through our own order
 * actions: picked up → Shipped, delivered → Delivered (COD settles), returned → Returned. Never
 * backwards; a move that fails is tried again by the next poll.
 *
 * Pathao's places are in `PathaoPlacesService`, the couriers' APIs in `CourierClients`.
 */
@Injectable()
export class CourierService implements OnModuleInit {
    private queue: JobQueue<BookJob> | undefined;

    constructor(
        @Inject(COURIERS_OPTIONS) private options: CouriersPluginOptions,
        private connection: TransactionalConnection,
        private settings: CourierSettingsService,
        private clients: CourierClients,
        private places: PathaoPlacesService,
        private orderService: OrderService,
        private orderActions: OrderActionsService,
        private historyService: HistoryService,
        private requestContextService: RequestContextService,
        private administrators: AdministratorService,
        private jobQueueService: JobQueueService,
        private eventBus: EventBus,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: BOOK_JOB,
            process: async job => this.bookFromJob(job.data),
        });
        // Money received or given back after booking changes what the courier should collect.
        this.eventBus.ofType(PaymentStateTransitionEvent).subscribe(event => {
            if (['Settled', 'Declined', 'Cancelled'].includes(event.toState))
                this.codMayHaveChanged(event.order.id);
        });
        this.eventBus.ofType(RefundStateTransitionEvent).subscribe(event => {
            if (event.toState === 'Settled') this.codMayHaveChanged(event.order.id);
        });
    }

    background(): Promise<RequestContext> {
        return this.requestContextService.create({ apiType: 'admin' });
    }

    get publicUrl(): string | null {
        return this.options.publicUrl ? this.options.publicUrl.replace(/\/$/, '') : null;
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

    /** For bulk booking's progress: each order's live booking, else its latest one. */
    async bookingsFor(ctx: RequestContext, orderIds: ID[]): Promise<BdCourierBooking[]> {
        const bookings: BdCourierBooking[] = [];
        for (const orderId of orderIds) {
            const booking = await this.bookingFor(ctx, orderId);
            if (booking) bookings.push(booking);
        }
        return bookings;
    }

    /**
     * Books one order. A Confirmed order is packed first (stores that skip packing). Idempotent: an
     * order that already has a live booking gets it back, and an unconfirmed one is tried again
     * (looked up at the courier first).
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
        if (existing?.status === 'unconfirmed') {
            // Whatever happens, the unconfirmed booking shows it: bulk booking adds no failed row.
            const retried = await this.retry(ctx, existing);
            return retried instanceof CourierActionError ? retried.shown() : retried;
        }
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
        const handle = await this.clients.handle(ctx, courier);
        if (!handle) return new CourierActionError('COURIER_OFF');

        const parcel = await this.parcel(ctx, order, courier);
        if (parcel instanceof CourierActionError) {
            // Kept (not live) so the unmapped addresses screen can list it.
            await this.failed(ctx, order, courier, handle.mode, parcel, by ?? null);
            return parcel.shown();
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
                    invoice: parcel.invoice,
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
        return this.attempt(ctx, booking, handle, parcel);
    }

    /**
     * Asks the courier to make the parcel for a booking we hold ("booking"). Booked: linked. Refused:
     * failed, and the order is free to book again. No clear answer: unconfirmed, still live.
     */
    private async attempt(
        ctx: RequestContext,
        booking: BdCourierBooking,
        handle: CourierHandle,
        parcel: ParcelInput,
    ): Promise<BdCourierBooking | CourierActionError> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        try {
            const booked = await handle.driver.createParcel(handle.call, parcel);
            await repository.update(booking.id, {
                status: 'booked',
                consignmentId: booked.consignmentId,
                trackingCode: booked.trackingCode,
                courierStatus: booked.status,
                deliveryFee: booked.deliveryFee,
                codAmount: parcel.codAmount * 100,
                newCodAmount: null,
                errorCode: null,
                errorMessage: null,
                nextPollAt: new Date(Date.now() + POLL_EVERY_MS),
                events: withEvent(booking.events, 'book', booked.status, booked.raw),
            });
            await this.history(ctx, booking.orderId, handle.courier, 'booked', {
                consignmentId: booked.consignmentId,
            });
            return (await repository.findOne({ where: { id: booking.id } }))!;
        } catch (error) {
            const failure = failureOf(error);
            const detail = error instanceof Error ? error.message : String(error);
            const events = withEvent(
                booking.events,
                'book',
                'error',
                error instanceof CourierError ? error.raw : null,
            );
            if (failure === 'refused') {
                await repository.update(booking.id, {
                    status: 'failed',
                    activeKey: null,
                    nextPollAt: null,
                    errorCode: 'COURIER_REFUSED',
                    errorMessage: detail.slice(0, 500),
                    events,
                });
                await this.history(ctx, booking.orderId, handle.courier, 'booking-failed', {
                    message: detail.slice(0, 200),
                });
                return new CourierActionError('COURIER_REFUSED', detail).shown();
            }
            Logger.warn(
                `${handle.courier} gave no clear answer booking order ${booking.orderId}: ${detail}`,
                loggerCtx,
            );
            const code = failure === 'notCreated' ? 'COURIER_BUSY' : 'COURIER_UNAVAILABLE';
            // Tried again on its own only when that's safe: surely not made, or the courier can be asked.
            const again = failure === 'notCreated' || !!handle.driver.findParcel;
            await repository.update(booking.id, {
                status: 'unconfirmed',
                errorCode: code,
                errorMessage: detail.slice(0, 500),
                nextPollAt: again ? new Date(Date.now() + RETRY_EVERY_MS) : null,
                events,
            });
            await this.history(ctx, booking.orderId, handle.courier, 'booking-unconfirmed', {
                message: detail.slice(0, 200),
            });
            return new CourierActionError(code, detail).shown();
        }
    }

    /**
     * An unconfirmed booking, again ("Try again", or the polling task). Surely not made (COURIER_BUSY):
     * made now. Maybe made: looked up by our invoice first and linked if the courier has it; a courier
     * that can't be asked (Pathao) waits for staff (`resolveUnconfirmed`).
     */
    async retry(
        ctx: RequestContext,
        booking: BdCourierBooking,
    ): Promise<BdCourierBooking | CourierActionError> {
        if (!isCourier(booking.courier)) return booking;
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const handle = await this.clients.handle(ctx, booking.courier, booking.mode);
        if (!handle) return new CourierActionError('COURIER_OFF');
        if (this.clients.paused(booking.courier, booking.mode)) return new CourierActionError('COURIER_BUSY');
        const order = await this.orderService.findOne(ctx, booking.orderId);
        if (!order) return new CourierActionError('ORDER_NOT_FOUND');
        const invoice = booking.invoice ?? order.customFields.orderNumber ?? order.code;

        if (booking.errorCode !== 'COURIER_BUSY') {
            if (!handle.driver.findParcel) return new CourierActionError('CHECK_COURIER_PANEL');
            let found;
            try {
                found = await handle.driver.findParcel(handle.call, invoice);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                await repository.update(
                    { id: booking.id, status: 'unconfirmed' },
                    { nextPollAt: this.retryAt(booking), errorMessage: detail.slice(0, 500) },
                );
                return new CourierActionError('COURIER_UNAVAILABLE', detail);
            }
            if (found) {
                // The courier made it after all: linked, and tracked by invoice until the courier
                // tells us its consignment ID (Steadfast's webhooks carry both).
                const linked = await repository.update(
                    { id: booking.id, status: 'unconfirmed' },
                    {
                        status: 'booked',
                        invoice,
                        courierStatus: found.status.slice(0, 60),
                        errorCode: null,
                        errorMessage: null,
                        nextPollAt: new Date(),
                        events: withEvent(booking.events, 'retry', found.status, found.raw),
                    },
                );
                if (linked.affected) {
                    await this.history(ctx, booking.orderId, booking.courier, 'booked', { status: 'found' });
                }
                return (await repository.findOne({ where: { id: booking.id } }))!;
            }
        }

        // Surely no parcel at the courier: make it now.
        const parcel = await this.parcel(ctx, order, booking.courier);
        if (parcel instanceof CourierActionError) {
            await repository.update(
                { id: booking.id, status: 'unconfirmed' },
                {
                    status: 'failed',
                    activeKey: null,
                    nextPollAt: null,
                    errorCode: parcel.code,
                    errorMessage: parcel.detail ?? null,
                },
            );
            return parcel.shown();
        }
        // Claimed first, so a poll and a click can't both make it.
        const claimed = await repository.update(
            { id: booking.id, status: 'unconfirmed' },
            { status: 'booking', invoice: parcel.invoice },
        );
        if (!claimed.affected) return (await repository.findOne({ where: { id: booking.id } }))!;
        return this.attempt(ctx, booking, handle, parcel);
    }

    /**
     * Staff checked the courier's panel for an unconfirmed booking: the parcel is there (its
     * consignment ID links it and tracking starts), or it isn't (the booking fails and the order can
     * be booked again).
     */
    async resolveUnconfirmed(
        ctx: RequestContext,
        input: { orderId: ID; consignmentId?: string | null },
    ): Promise<BdCourierBooking | CourierActionError> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const booking = await repository.findOne({
            where: { activeKey: String(input.orderId), status: 'unconfirmed' },
        });
        if (!booking) return new CourierActionError('NOT_BOOKED');
        const consignmentId = cleanText(input.consignmentId ?? '').slice(0, 60);
        const by = await this.staffName(ctx);
        if (consignmentId) {
            await repository.update(
                { id: booking.id, status: 'unconfirmed' },
                {
                    status: 'booked',
                    consignmentId,
                    errorCode: null,
                    errorMessage: null,
                    nextPollAt: new Date(),
                    events: withEvent(booking.events, 'resolve', 'found', { by }),
                },
            );
            await this.history(ctx, booking.orderId, booking.courier, 'booked', { consignmentId });
            await this.check(ctx, booking.id).catch(error =>
                Logger.warn(`Status check after linking failed: ${String(error)}`, loggerCtx),
            );
        } else {
            await repository.update(
                { id: booking.id, status: 'unconfirmed' },
                {
                    status: 'failed',
                    activeKey: null,
                    nextPollAt: null,
                    events: withEvent(booking.events, 'resolve', 'not-booked', { by }),
                },
            );
            await this.history(ctx, booking.orderId, booking.courier, 'booking-failed', {
                message: 'Not at the courier (checked by staff)',
            });
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

    /**
     * One order of a bulk booking. A failure no booking shows yet (not ready, no courier, courier
     * off…) is written as a failed booking, so staff see why on the order and in the bulk booking's
     * progress, instead of the order being skipped silently.
     */
    private async bookFromJob(job: BookJob) {
        const ctx = await this.background();
        const result = await this.book(ctx, job.orderId, job.courier, job.by);
        if (!(result instanceof CourierActionError) || result.recorded) return;
        const order = await this.orderService.findOne(ctx, job.orderId);
        if (!order) {
            Logger.warn(`Bulk booking: order ${job.orderId} not found`, loggerCtx);
            return;
        }
        const courier = job.courier && isCourier(job.courier) ? job.courier : '';
        await this.failed(ctx, order, courier, 'live', result, job.by);
    }

    /** The manual fallback: the parcel was booked outside (a courier's panel, a phone call). */
    async markBookedManually(
        ctx: RequestContext,
        input: { orderId: ID; courierName: string; trackingCode: string },
    ): Promise<BdCourierBooking | CourierActionError> {
        // Any courier, in any script ("Sundarban Courier", "সুন্দরবন কুরিয়ার"), in its own column.
        const name = [...cleanText(input.courierName)].slice(0, 40).join('');
        const code = cleanText(input.trackingCode).slice(0, 60);
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
                    courier: known ?? MANUAL_COURIER,
                    courierName: known ? COURIER_NAMES[known] : name,
                    mode: 'live',
                    invoice: order.customFields.orderNumber ?? order.code,
                    status: 'manual',
                    consignmentId: code,
                    trackingCode: code,
                    codAmount: courierCod(Math.max(0, order.totalWithTax - settledAmount(order))) * 100,
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
     * picked-up parcel can't be cancelled: it comes back as a return. An order already Shipped counts
     * as picked up (Steadfast never says "picked up"; staff may have marked it shipped).
     */
    async cancelBooking(ctx: RequestContext, orderId: ID): Promise<BdCourierBooking | CourierActionError> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const booking = await repository.findOne({ where: { activeKey: String(orderId) } });
        if (!booking) return new CourierActionError('NOT_BOOKED');
        if (booking.outcome !== 'booked') return new CourierActionError('ALREADY_PICKED_UP');
        const order = await this.orderService.findOne(ctx, orderId);
        if (order && order.state !== 'Packed' && order.state !== 'Confirmed')
            return new CourierActionError('ALREADY_PICKED_UP');
        await repository.update(booking.id, {
            status: 'cancelled',
            activeKey: null,
            outcome: 'cancelled',
            nextPollAt: null,
            events: withEvent(booking.events, 'cancel', 'cancelled', { by: await this.staffName(ctx) }),
        });
        await this.history(ctx, orderId, booking.courierName ?? booking.courier, 'cancelled', {
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
            // Money already received (settled) isn't collected again. An advance still waiting for
            // staff to verify it counts once verified: the booking is then flagged (`recheckCod`).
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
            const place = await this.places.place(ctx, fields.districtId ?? '', fields.thanaId ?? '');
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

    /** A booking that failed before reaching the courier, kept (not live) to show why. */
    private async failed(
        ctx: RequestContext,
        order: Order,
        courier: Courier | '',
        mode: CourierMode,
        reason: CourierActionError,
        by: string | null,
    ) {
        await this.connection.getRepository(ctx, BdCourierBooking).save(
            new BdCourierBooking({
                orderId: order.id,
                activeKey: null,
                courier,
                mode,
                invoice: order.customFields.orderNumber ?? order.code,
                status: 'failed',
                codAmount: 0,
                outcome: 'note',
                errorCode: reason.code,
                errorMessage: reason.detail?.slice(0, 500) ?? null,
                bookedBy: by ?? (await this.staffName(ctx)),
                events: [],
            }),
        );
    }

    // ── COD changes after booking ─────────────────────────────────────────────────────────────

    /** Runs after the payment's own transaction (Vendure publishes events after commit), in a new context. */
    private codMayHaveChanged(orderId: ID) {
        void this.background()
            .then(ctx => this.recheckCod(ctx, orderId))
            .catch(error =>
                Logger.error(`COD check for order ${String(orderId)} failed: ${String(error)}`, loggerCtx),
            );
    }

    /**
     * After a payment or refund settles: if the order has a live booking the courier hasn't finished,
     * and what's left to collect differs from the parcel's COD, the booking is flagged for staff.
     * Neither courier's API can change a parcel's COD, so staff change it in the courier's panel and
     * confirm (`confirmCodUpdated`). Back to the booked amount: the flag goes.
     */
    async recheckCod(ctx: RequestContext, orderId: ID): Promise<void> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const booking = await repository.findOne({ where: { activeKey: String(orderId) } });
        // Once delivered (or partly), the COD settles from the order itself.
        if (!booking || !['booked', 'pickedUp', 'note'].includes(booking.outcome)) return;
        const order = await this.orderService.findOne(ctx, orderId, ['payments', 'payments.refunds']);
        // A delivered order's COD payment settles too: that's the end, not a change (bookings by hand
        // stay "booked" whatever happens).
        if (!order || SETTLED_STATES.includes(order.state) || order.state === 'PartiallyDelivered') return;
        const due = courierCod(Math.max(0, order.totalWithTax - settledAmount(order))) * 100;
        const flagged = due === booking.codAmount ? null : due;
        if (flagged === booking.newCodAmount) return;
        await repository.update(booking.id, {
            newCodAmount: flagged,
            events: withEvent(booking.events, 'cod', flagged === null ? 'cod-unchanged' : 'cod-changed', {
                was: booking.codAmount,
                now: due,
            }),
        });
        if (flagged !== null) {
            await this.history(ctx, orderId, booking.courierName ?? booking.courier, 'cod-changed', {
                message: `COD ${booking.codAmount / 100} → ${due / 100}`,
            });
        }
    }

    /** Staff changed the parcel's COD in the courier's panel: the booking takes the new amount. */
    async confirmCodUpdated(
        ctx: RequestContext,
        orderId: ID,
    ): Promise<BdCourierBooking | CourierActionError> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const booking = await repository.findOne({ where: { activeKey: String(orderId) } });
        if (!booking) return new CourierActionError('NOT_BOOKED');
        if (booking.newCodAmount === null) return booking;
        await repository.update(booking.id, {
            codAmount: booking.newCodAmount,
            newCodAmount: null,
            events: withEvent(booking.events, 'cod', 'cod-updated', { by: await this.staffName(ctx) }),
        });
        return (await repository.findOne({ where: { id: booking.id } }))!;
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
        // Only read here: the secret is made when staff open the courier settings.
        const expected = await this.settings.webhookSecret(ctx, courier);
        const header =
            courier === 'pathao'
                ? headers['x-pathao-signature']
                : (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const reading = (courier === 'pathao' ? pathaoDriver : steadfastDriver).readWebhook(body);
        if (!expected || !same(secret, expected)) return { status: 401 };
        if (reading.kind === 'handshake') {
            // Pathao checks the URL by asking us to echo its integration secret.
            const echo = headers['x-pathao-merchant-webhook-integration-secret'] ?? expected;
            return { status: 202, headers: { 'X-Pathao-Merchant-Webhook-Integration-Secret': echo } };
        }
        if (!header || !same(header, expected)) return { status: 401 };
        if (reading.kind === 'ignored') return { status: 202 };
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        let booking = await repository.findOne({
            where: { courier, consignmentId: reading.consignmentId, status: In(['booked', 'cancelled']) },
        });
        if (!booking && reading.invoice) {
            // A parcel linked by invoice (found after an unclear booking): now we learn its ID.
            booking = await repository.findOne({
                where: { courier, invoice: reading.invoice, consignmentId: IsNull(), status: 'booked' },
            });
            if (booking) {
                await repository.update(booking.id, {
                    consignmentId: reading.consignmentId,
                    trackingCode: reading.trackingCode ?? null,
                });
            }
        }
        if (!booking) {
            Logger.warn(`${courier} webhook for an unknown consignment, ignored`, loggerCtx);
            return { status: 202 };
        }
        await this.applyStatus(ctx, booking.id, reading.status, reading.at, 'webhook', reading.raw);
        await this.follow(ctx, booking.id);
        return { status: 202 };
    }

    /**
     * The polling task (every 10 minutes): bookings that lost their answer become unconfirmed;
     * unconfirmed ones are tried again while the courier isn't paused; active parcels that are due
     * are asked about, and orders that didn't follow their parcel are moved. Returns how many
     * bookings were looked at.
     */
    async poll(limit = 100): Promise<number> {
        const ctx = await this.background();
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const now = new Date();
        await repository.update(
            { status: 'booking', updatedAt: LessThan(new Date(now.getTime() - STUCK_AFTER_MS)) },
            {
                status: 'unconfirmed',
                errorCode: 'COURIER_UNAVAILABLE',
                errorMessage: 'The booking lost its answer (the server stopped while asking)',
                nextPollAt: now,
            },
        );
        const unsure = await repository.find({
            where: { status: 'unconfirmed', nextPollAt: LessThanOrEqual(now) },
            order: { nextPollAt: 'ASC' },
            take: limit,
        });
        for (const booking of unsure) {
            // Waiting for the courier: its calls are paused; the next run tries again.
            if (isCourier(booking.courier) && this.clients.paused(booking.courier, booking.mode)) continue;
            const result = await this.retry(ctx, booking).catch(error => {
                Logger.error(`Retrying booking ${booking.id} failed: ${String(error)}`, loggerCtx);
                return null;
            });
            if (result instanceof CourierActionError && result.code === 'CHECK_COURIER_PANEL') {
                await repository.update({ id: booking.id, status: 'unconfirmed' }, { nextPollAt: null });
            }
        }
        const due = await repository.find({
            where: { status: 'booked', nextPollAt: LessThanOrEqual(now) },
            order: { nextPollAt: 'ASC' },
            take: limit,
        });
        for (const booking of due) {
            await this.check(ctx, booking.id).catch(error =>
                Logger.error(`Polling booking ${booking.id} failed: ${String(error)}`, loggerCtx),
            );
        }
        return unsure.length + due.length;
    }

    /** When to try an unconfirmed booking again on its own: soon, for a day; then only when staff ask. */
    private retryAt(booking: BdCourierBooking): Date | null {
        return Date.now() - booking.createdAt.getTime() > RETRY_FOR_MS
            ? null
            : new Date(Date.now() + RETRY_EVERY_MS);
    }

    /**
     * "Check status now" and polling: asks the courier (unless it already said its last word), applies
     * the answer, and moves the order if it hasn't followed its parcel yet.
     */
    async check(ctx: RequestContext, bookingId: ID): Promise<BdCourierBooking | null> {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        let booking = await repository.findOne({ where: { id: bookingId } });
        if (!booking || booking.status !== 'booked' || !isCourier(booking.courier)) return booking;
        const old = Date.now() - booking.createdAt.getTime() > POLL_FOR_MS;
        if (!FINAL_OUTCOMES.includes(booking.outcome) && (booking.consignmentId || booking.invoice)) {
            const handle = await this.clients.handle(ctx, booking.courier, booking.mode);
            if (handle) {
                try {
                    const status = await handle.driver.getStatus(handle.call, {
                        consignmentId: booking.consignmentId,
                        invoice: booking.invoice,
                    });
                    await this.applyStatus(ctx, booking.id, status.status, status.at, 'poll', status.raw);
                } catch (error) {
                    Logger.warn(`${booking.courier} status check failed: ${String(error)}`, loggerCtx);
                }
            }
            booking = (await repository.findOne({ where: { id: bookingId } }))!;
        }
        // A cancelled booking leaves "booked"; the order has nothing to follow then.
        if (booking.status !== 'booked') return booking;
        const caughtUp = await this.moveOrder(ctx, booking);
        const done = FINAL_OUTCOMES.includes(booking.outcome) && caughtUp;
        const next = old || done ? null : new Date(Date.now() + (caughtUp ? POLL_EVERY_MS : RETRY_EVERY_MS));
        await repository.update({ id: booking.id, status: 'booked' }, { nextPollAt: next });
        return repository.findOne({ where: { id: booking.id } });
    }

    /**
     * Applies a courier status once, in order: the booking row is locked; a status older than the
     * last applied one, or one that would move backwards, is only recorded. The order follows
     * separately (`follow`, `check`), so a move that fails can be tried again.
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
            if (!booking || !isCourier(booking.courier)) return null;
            // Steadfast's "cancelled" is a return once the parcel has left: picked up by our
            // reading, or the order marked shipped by staff (Steadfast never says "picked up").
            const order = await this.connection
                .getRepository(txCtx, Order)
                .findOne({ where: { id: booking.orderId }, select: ['id', 'state'] });
            const left =
                booking.outcome === 'pickedUp' ||
                booking.outcome === 'partiallyDelivered' ||
                (!!order && order.state !== 'Packed' && order.state !== 'Confirmed');
            const outcome = courierOutcome(booking.courier, status, left);
            const events = withEvent(booking.events, source, status, raw);
            const stale = !!at && !!booking.statusAt && at < booking.statusAt;
            if (stale || !outcomeMovesOn(booking.outcome, outcome)) {
                await repository.update(booking.id, {
                    events,
                    ...(stale ? {} : { courierStatus: status.slice(0, 60) }),
                });
                return null;
            }
            await repository.update(booking.id, {
                events,
                outcome,
                courierStatus: status.slice(0, 60),
                // Only the courier's own times order updates (one without a time keeps the last).
                statusAt: at ?? booking.statusAt,
                outcomeAt: new Date(),
                ...(FINAL_OUTCOMES.includes(outcome) ? { nextPollAt: null } : {}),
                // Cancelled before pickup: the order stays Packed and can be booked again.
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
    }

    /** The order follows its parcel; if it can't now, the next poll tries again soon. */
    private async follow(ctx: RequestContext, bookingId: ID) {
        const repository = this.connection.getRepository(ctx, BdCourierBooking);
        const booking = await repository.findOne({ where: { id: bookingId } });
        if (!booking || booking.status !== 'booked' || (await this.moveOrder(ctx, booking))) return;
        await repository.update(
            { id: booking.id, status: 'booked' },
            { nextPollAt: new Date(Date.now() + RETRY_EVERY_MS) },
        );
    }

    /**
     * Moves the order to where its parcel is, through the same actions staff use (a missed pickup is
     * filled in). Safe to repeat: it acts only where the order lags. Returns whether the order is
     * where it should be (or can't move any more).
     */
    private async moveOrder(ctx: RequestContext, booking: BdCourierBooking): Promise<boolean> {
        const goal = booking.outcome;
        if (goal !== 'pickedUp' && goal !== 'delivered' && goal !== 'returned') return true;
        const state = async () => (await this.orderService.findOne(ctx, booking.orderId))?.state;
        const warn = (what: string, message: string) => {
            Logger.warn(`Couldn't mark order ${booking.orderId} ${what}: ${message}`, loggerCtx);
            return false;
        };
        const name = isCourier(booking.courier) ? COURIER_NAMES[booking.courier] : booking.courier;
        let now = await state();
        if (!now || SETTLED_STATES.includes(now)) return true;
        if (now === 'Packed') {
            const shipped = await this.orderActions.markShipped(ctx, {
                orderId: booking.orderId,
                expectedStatus: 'packed',
                shipment: { method: name, trackingCode: booking.consignmentId ?? booking.invoice ?? '' },
            });
            if (isGraphQlErrorResult(shipped)) return warn('shipped', shipped.message);
            now = await state();
        }
        if (goal === 'pickedUp') return now !== 'Packed';
        if (goal === 'delivered' && now === 'Shipped') {
            const delivered = await this.orderActions.markDelivered(ctx, {
                orderId: booking.orderId,
                expectedStatus: 'shipped',
            });
            if (isGraphQlErrorResult(delivered)) return warn('delivered', delivered.message);
        }
        if (goal === 'returned' && (now === 'Shipped' || now === 'PartiallyDelivered')) {
            const returned = await this.orderActions.markReturned(ctx, {
                orderId: booking.orderId,
                note: `Returned by ${name} (${booking.courierStatus ?? ''})`,
            });
            if (isGraphQlErrorResult(returned)) return warn('returned', returned.message);
        }
        return SETTLED_STATES.includes((await state()) ?? 'Delivered');
    }

    // ── For other plugins and the home page ─────────────────────────────────────────────────

    /** The parcel for stickers, invoices and tracking (a live or finished booking with a consignment). */
    async shipmentInfo(ctx: RequestContext, orderId: ID): Promise<ShipmentInfo | null> {
        const booking = await this.connection.getRepository(ctx, BdCourierBooking).findOne({
            where: { orderId, status: In(['booked', 'manual']), consignmentId: Not(IsNull()) },
            order: { id: 'DESC' },
        });
        if (!booking?.consignmentId) return null;
        const courier = isCourier(booking.courier) ? booking.courier : null;
        return {
            courier: booking.courierName ?? (courier ? COURIER_NAMES[courier] : booking.courier),
            consignmentId: booking.consignmentId,
            trackingCode: booking.trackingCode,
            trackingUrl:
                courier && booking.status === 'booked'
                    ? courierTrackingUrl(courier, {
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

    /** Whether a live booking is waiting because calls to its courier are paused. */
    waiting(booking: BdCourierBooking): boolean {
        return (
            LIVE_BOOKING_STATUSES.includes(booking.status) &&
            isCourier(booking.courier) &&
            this.clients.paused(booking.courier, booking.mode)
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

/**
 * What a failed create call tells us: the driver's reading; calls paused by the circuit breaker or
 * blocked before sending surely made nothing; anything else (a timeout, a dropped connection) is
 * unknown.
 */
function failureOf(error: unknown): CourierFailure {
    if (error instanceof CourierError) return error.failure;
    if (error instanceof HttpError && (error.kind === 'circuit_open' || error.kind === 'blocked')) {
        return 'notCreated';
    }
    return 'unknown';
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
