import type { HttpClient } from '@ecommbd/shared';

export interface CourierCall {
    http: HttpClient;
    baseUrl: string;
    credentials: Record<string, string>;
}

/** What a courier needs to carry a parcel: nothing more (privacy: name, phone, address, COD, items). */
export interface ParcelInput {
    /** Our order number: the courier's invoice / merchant order ID. */
    invoice: string;
    recipientName: string;
    /** `01XXXXXXXXX` */
    recipientPhone: string;
    recipientAddress: string;
    /** Whole taka. */
    codAmount: number;
    note: string;
    itemDescription: string;
    itemQuantity: number;
    weightKg: number;
    /** Pathao only. */
    pathao?: {
        storeId: string;
        cityId: number;
        zoneId: number;
        areaId: number | null;
        deliveryType: number;
        itemType: number;
    };
}

export interface ParcelBooked {
    consignmentId: string;
    trackingCode: string | null;
    status: string;
    /** Poisha. */
    deliveryFee: number | null;
    raw: unknown;
}

export interface CourierStatus {
    status: string;
    /** When the courier says it happened; null when it doesn't say. */
    at: Date | null;
    raw: unknown;
}

/** A webhook, read: the integration handshake (Pathao), or a status for a consignment. */
export type WebhookReading =
    | { kind: 'handshake' }
    | {
          kind: 'status';
          consignmentId: string;
          /** Our invoice, when the courier sends it (Steadfast): finds a parcel linked by invoice. */
          invoice?: string | null;
          trackingCode?: string | null;
          status: string;
          at: Date | null;
          raw: unknown;
      }
    | { kind: 'ignored'; reason: string };

/** How the courier knows a parcel: its consignment ID, else our invoice (a parcel found by invoice). */
export interface ParcelRef {
    consignmentId: string | null;
    invoice: string | null;
}

export interface CourierDriver {
    testConnection(call: CourierCall): Promise<{ ok: true } | { ok: false; message: string }>;
    createParcel(call: CourierCall, parcel: ParcelInput): Promise<ParcelBooked>;
    getStatus(call: CourierCall, parcel: ParcelRef): Promise<CourierStatus>;
    /**
     * Whether the courier already has a parcel for our invoice (after a booking with no clear answer):
     * its status, or null when the courier says there's none. Throws when it can't tell. Missing when
     * the courier's API can't look a parcel up by our invoice (Pathao): staff check its panel instead.
     */
    findParcel?(call: CourierCall, invoice: string): Promise<CourierStatus | null>;
    readWebhook(body: unknown): WebhookReading;
}

/**
 * What a failed call tells us about the parcel:
 * - refused: the courier understood and said no (validation, credentials): no parcel; retrying the
 *   same parcel won't help
 * - notCreated: surely no parcel, but worth trying later (429 too many requests)
 * - unknown: no clear answer (5xx, a timeout, a dropped connection, an answer we can't read): the
 *   courier may have made the parcel
 */
export type CourierFailure = 'refused' | 'notCreated' | 'unknown';

/** The courier refused or answered with something we can't use. */
export class CourierError extends Error {
    constructor(
        message: string,
        readonly raw: unknown = null,
        readonly failure: CourierFailure = 'unknown',
    ) {
        super(message);
        this.name = 'CourierError';
    }

    get refused(): boolean {
        return this.failure === 'refused';
    }
}

/** What an HTTP status on a failed call means: 429 is "later", other 4xx a refusal, 5xx unknown. */
export function failureOf(status: number): CourierFailure {
    if (status === 429) return 'notCreated';
    // 408 Request Timeout: the courier gave up on the request, maybe after acting on it.
    return status >= 400 && status < 500 && status !== 408 ? 'refused' : 'unknown';
}

/** The JSON object a courier answered; anything else is an error (a 2xx we can't read: unknown). */
export function jsonOf(response: { status: number; text(): string }): Record<string, unknown> {
    const failure = response.status >= 200 && response.status < 300 ? 'unknown' : failureOf(response.status);
    let body: unknown;
    try {
        body = JSON.parse(response.text());
    } catch {
        throw new CourierError(`Unexpected response (HTTP ${response.status})`, null, failure);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new CourierError(`Unexpected response (HTTP ${response.status})`, body, failure);
    }
    return body as Record<string, unknown>;
}

export const str = (value: unknown): string | null =>
    typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null;

/** A date the courier sent ("2026-10-24 14:05:00" is Dhaka time; ISO strings carry their zone). */
export function courierDate(value: unknown): Date | null {
    const text = str(value);
    if (!text) return null;
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)
        ? `${text.replace(' ', 'T')}+06:00`
        : text;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** The first message in a courier's error body (`message`, or the first of `errors`). */
export function messageOf(body: Record<string, unknown>): string {
    const errors = body.errors;
    if (errors && typeof errors === 'object') {
        const first = Object.values(errors as Record<string, unknown>)[0];
        const text = Array.isArray(first) ? str(first[0]) : str(first);
        if (text) return text;
    }
    return str(body.message) ?? 'no message';
}
