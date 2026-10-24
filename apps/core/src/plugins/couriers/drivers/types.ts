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
    | { kind: 'status'; consignmentId: string; status: string; at: Date | null; raw: unknown }
    | { kind: 'ignored'; reason: string };

export interface CourierDriver {
    testConnection(call: CourierCall): Promise<{ ok: true } | { ok: false; message: string }>;
    createParcel(call: CourierCall, parcel: ParcelInput): Promise<ParcelBooked>;
    getStatus(call: CourierCall, consignmentId: string): Promise<CourierStatus>;
    readWebhook(body: unknown): WebhookReading;
}

/** The courier refused (validation, credentials) or answered with something we can't use. */
export class CourierError extends Error {
    constructor(
        message: string,
        readonly raw: unknown = null,
        /** The courier understood and refused: retrying the same parcel won't help. */
        readonly refused = false,
    ) {
        super(message);
        this.name = 'CourierError';
    }
}

export function jsonOf(response: { status: number; text(): string }): Record<string, unknown> {
    let body: unknown;
    try {
        body = JSON.parse(response.text());
    } catch {
        throw new CourierError(`Unexpected response (HTTP ${response.status})`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new CourierError(`Unexpected response (HTTP ${response.status})`, body);
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
