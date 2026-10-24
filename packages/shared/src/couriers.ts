import { z } from 'zod';
import { type ShippingZone, SHIPPING_ZONES } from './shipping';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';

/**
 * Couriers (roadmap phase 19): Steadfast and Pathao. Booking a parcel, the couriers' statuses in our
 * words, and matching our districts and thanas to Pathao's cities, zones and areas. Browser-safe.
 */

export const COURIERS = ['steadfast', 'pathao'] as const;
export type Courier = (typeof COURIERS)[number];

export function isCourier(value: unknown): value is Courier {
    return (COURIERS as readonly unknown[]).includes(value);
}

export const COURIER_MODES = ['sandbox', 'live'] as const;
export type CourierMode = (typeof COURIER_MODES)[number];

/** The couriers' own addresses. Steadfast has no sandbox: its sandbox is its live API. */
export const COURIER_BASE_URLS: Record<Courier, Record<CourierMode, string>> = {
    steadfast: {
        sandbox: 'https://portal.packzy.com/api/v1',
        live: 'https://portal.packzy.com/api/v1',
    },
    pathao: {
        sandbox: 'https://courier-api-sandbox.pathao.com',
        live: 'https://api-hermes.pathao.com',
    },
};

export const COURIER_CREDENTIAL_FIELDS: Record<Courier, readonly string[]> = {
    steadfast: ['apiKey', 'secretKey'],
    pathao: ['clientId', 'clientSecret', 'username', 'password'],
};

/** Shown back to staff in full; the rest only as "saved". */
export const COURIER_PUBLIC_FIELDS: Record<Courier, readonly string[]> = {
    steadfast: [],
    pathao: ['clientId', 'username'],
};

/** Pathao's delivery types: 48 normal, 12 on-demand (same day). Item types: 1 document, 2 parcel. */
export const PATHAO_DELIVERY_TYPES = [48, 12] as const;
export const PATHAO_ITEM_TYPES = [2, 1] as const;

export const COURIER_LIMITS = {
    /** Orders in one bulk booking. */
    bulk: 100,
    weightGrams: { min: 50, max: 30_000 },
    storeId: 20,
} as const;

const courierOrNone = z.union([z.enum(COURIERS), z.literal('')]);

export const courierSettingsSchema = z.object({
    steadfast: z.object({ enabled: z.boolean() }),
    pathao: z.object({
        enabled: z.boolean(),
        mode: z.enum(COURIER_MODES),
        /** The merchant's Pathao store (pickup point), from Pathao's store list. */
        storeId: z.string().trim().max(COURIER_LIMITS.storeId, 'tooLong'),
        deliveryType: z.union([z.literal(48), z.literal(12)]),
        itemType: z.union([z.literal(2), z.literal(1)]),
    }),
    /** The courier "Book" picks by default, by delivery zone. Empty: staff choose. */
    defaultByZone: z.object(
        Object.fromEntries(SHIPPING_ZONES.map(zone => [zone, courierOrNone])) as Record<
            ShippingZone,
            typeof courierOrNone
        >,
    ),
    /** Used when a product has no weight (phase 07's field). */
    defaultWeightGrams: z
        .number()
        .int('invalid')
        .min(COURIER_LIMITS.weightGrams.min, 'invalid')
        .max(COURIER_LIMITS.weightGrams.max, 'invalid'),
});

export type CourierSettings = z.output<typeof courierSettingsSchema>;

export function defaultCourierSettings(): CourierSettings {
    return {
        steadfast: { enabled: false },
        pathao: { enabled: false, mode: 'sandbox', storeId: '', deliveryType: 48, itemType: 2 },
        defaultByZone: { dhaka_city: '', dhaka_suburb: '', chattogram_city: '', outside_dhaka: '' },
        defaultWeightGrams: 500,
    };
}

export function parseCourierSettings(
    input: unknown,
): { ok: true; settings: CourierSettings } | { ok: false; errors: SettingsFieldError[] } {
    const result = courierSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** `+8801712345678` → `01712345678`, what both couriers expect. */
export function courierPhone(e164: string): string {
    return e164.startsWith('+880') ? `0${e164.slice(4)}` : e164.replace(/^880/, '0');
}

/** Poisha → whole taka for a COD amount (couriers take whole taka; our totals are whole taka). */
export function courierCod(minor: number): number {
    return Math.max(0, Math.round(minor / 100));
}

/**
 * What a courier status means for the order. Moves are one-way, ranked: an older or lower status
 * never takes an order back (only a return can follow a pickup).
 * - booked: with the courier, not picked up yet
 * - pickedUp: on its way (order → Shipped)
 * - delivered: delivered (order → Delivered, COD settled)
 * - partiallyDelivered: the customer kept some items: staff record the rest
 * - returned: coming or came back (order → Returned)
 * - cancelled: the booking was cancelled before pickup (order stays Packed)
 * - note: hold, failed attempt, approval pending… shown, nothing moves
 */
export type CourierOutcome =
    'booked' | 'pickedUp' | 'delivered' | 'partiallyDelivered' | 'returned' | 'cancelled' | 'note';

export const OUTCOME_RANK: Record<CourierOutcome, number> = {
    note: 0,
    booked: 1,
    cancelled: 2,
    pickedUp: 3,
    partiallyDelivered: 4,
    delivered: 5,
    returned: 5,
};

const STEADFAST: Record<string, CourierOutcome> = {
    in_review: 'booked',
    // Accepted and on its way (Steadfast has no separate "picked up" status).
    pending: 'pickedUp',
    delivered: 'delivered',
    partial_delivered: 'partiallyDelivered',
    // Cancelled by Steadfast means it didn't reach the customer: it comes back to the merchant.
    cancelled: 'returned',
    hold: 'note',
    unknown: 'note',
    // Waiting for Steadfast's own approval: final only once approved.
    delivered_approval_pending: 'note',
    partial_delivered_approval_pending: 'note',
    cancelled_approval_pending: 'note',
    unknown_approval_pending: 'note',
};

/** Pathao's order_status_slug, or a webhook event (`order.picked` → `picked`), lower-cased. */
const PATHAO: Record<string, CourierOutcome> = {
    pending: 'booked',
    created: 'booked',
    pickup_requested: 'booked',
    assigned_for_pickup: 'booked',
    pickup_failed: 'note',
    pickup_cancelled: 'cancelled',
    picked: 'pickedUp',
    at_the_sorting_hub: 'pickedUp',
    in_transit: 'pickedUp',
    received_at_last_mile_hub: 'pickedUp',
    assigned_for_delivery: 'pickedUp',
    delivered: 'delivered',
    partial_delivery: 'partiallyDelivered',
    return: 'returned',
    returned: 'returned',
    paid_return: 'returned',
    delivery_failed: 'note',
    on_hold: 'note',
    paid: 'note',
    payment_invoice: 'note',
    exchange: 'note',
    exchanged: 'note',
};

/** Normalizes `order.at-the-sorting-hub`, `At_the_Sorting_HUB`, `In Transit` to `at_the_sorting_hub`. */
export function courierStatusKey(status: string): string {
    return status
        .trim()
        .toLowerCase()
        .replace(/^order\./, '')
        .replace(/[\s-]+/g, '_');
}

export function courierOutcome(courier: Courier, status: string): CourierOutcome {
    const key = courierStatusKey(status);
    return (courier === 'steadfast' ? STEADFAST : PATHAO)[key] ?? 'note';
}

/**
 * Whether a new status may move a booking on: never to a lower rank (an old "in transit" after
 * "delivered"), never anything after a final outcome except a return after a partial delivery.
 */
export function outcomeMovesOn(current: CourierOutcome, next: CourierOutcome): boolean {
    if (next === 'note') return false;
    if (current === 'delivered' || current === 'returned' || current === 'cancelled') return false;
    return OUTCOME_RANK[next] > OUTCOME_RANK[current];
}

/** The courier's public tracking page for a parcel. */
export function courierTrackingUrl(
    courier: Courier,
    refs: { consignmentId: string; trackingCode: string | null },
) {
    return courier === 'steadfast'
        ? `https://steadfast.com.bd/t/${encodeURIComponent(refs.trackingCode ?? refs.consignmentId)}`
        : `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(refs.consignmentId)}`;
}

/**
 * A place name for matching: lower-case Latin letters only (spaces, dots, hyphens and brackets go),
 * with the common spellings made the same (Chittagong / Chattogram, Bogra / Bogura, Comilla /
 * Cumilla, Jessore / Jashore, Barisal / Barishal…). "Sadar" and "Thana" are dropped.
 */
export function placeKey(name: string): string {
    let key = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\(.*?\)/g, ' ')
        .replace(/\b(sadar|thana|upazila|city|corporation|metro|model)\b/g, ' ')
        .replace(/[^a-z]/g, '');
    for (const [from, to] of SPELLINGS) key = key.replace(from, to);
    return key;
}

const SPELLINGS: Array<[RegExp, string]> = [
    [/chittagong|chattagram/g, 'chattogram'],
    [/bogra/g, 'bogura'],
    [/comilla/g, 'cumilla'],
    [/jessore/g, 'jashore'],
    [/barisal/g, 'barishal'],
    [/coxsbazar|coxbazar/g, 'coxsbazar'],
    [/jhalakati|jhalokathi/g, 'jhalokati'],
    [/netrakona/g, 'netrokona'],
    [/maulvibazar|moulvibazaar/g, 'moulvibazar'],
    [/chapainababganj/g, 'chapainawabganj'],
    [/mymensing$/g, 'mymensingh'],
    [/narshingdi/g, 'narsingdi'],
    [/lakshmipur|laxmipur/g, 'lakshmipur'],
    [/kishorganj/g, 'kishoreganj'],
    [/sirajgonj/g, 'sirajganj'],
    [/gonj/g, 'ganj'],
];

export interface PlaceCandidate {
    id: number;
    name: string;
}

/**
 * The candidate whose name matches one of ours (name or alias), or null. Exact key first, then a
 * unique prefix match either way ("Mirpur" ↔ "Mirpur 10" is not unique, so it isn't guessed).
 */
export function matchPlace(
    names: readonly string[],
    candidates: readonly PlaceCandidate[],
): PlaceCandidate | null {
    const keys = [...new Set(names.map(placeKey).filter(key => key.length >= 3))];
    if (!keys.length) return null;
    const exact = candidates.filter(candidate => keys.includes(placeKey(candidate.name)));
    if (exact.length === 1) return exact[0]!;
    if (exact.length > 1) return null;
    const prefix = candidates.filter(candidate => {
        const key = placeKey(candidate.name);
        return key.length >= 4 && keys.some(ours => ours.startsWith(key) || key.startsWith(ours));
    });
    return prefix.length === 1 ? prefix[0]! : null;
}

/** Booking states. One active booking per order (booking, booked). */
export const BOOKING_STATUSES = ['booking', 'booked', 'failed', 'cancelled', 'manual'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
