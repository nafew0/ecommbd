import { z } from 'zod';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';

/**
 * Online payments (roadmap phase 18): SSLCommerz (cards, mobile banking, internet banking) and
 * bKash tokenized checkout (browser-safe; SSLCommerz's signature check is in `sslcommerz-sign.ts`).
 * An unpaid online order is placed and waits in `AwaitingPayment` with a
 * `Pending` payment; only a server-side check with the gateway marks it paid.
 */

export const ONLINE_GATEWAYS = ['sslcommerz', 'bkash'] as const;
export type OnlineGateway = (typeof ONLINE_GATEWAYS)[number];

export const GATEWAY_MODES = ['sandbox', 'live'] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];

export function isOnlineGateway(value: unknown): value is OnlineGateway {
    return (ONLINE_GATEWAYS as readonly unknown[]).includes(value);
}

/** The gateways' own addresses. Fixed by us, never taken from data. */
export const GATEWAY_BASE_URLS: Record<OnlineGateway, Record<GatewayMode, string>> = {
    sslcommerz: {
        sandbox: 'https://sandbox.sslcommerz.com',
        live: 'https://securepay.sslcommerz.com',
    },
    bkash: {
        sandbox: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
        live: 'https://tokenized.pay.bka.sh/v1.2.0-beta',
    },
};

/** The secret fields of each gateway, kept encrypted. */
export const GATEWAY_CREDENTIAL_FIELDS: Record<OnlineGateway, readonly string[]> = {
    sslcommerz: ['storeId', 'storePassword'],
    bkash: ['username', 'password', 'appKey', 'appSecret'],
};

/** Fields shown back to staff in full (an ID, not a secret); the rest only as "saved". */
export const GATEWAY_PUBLIC_FIELDS: Record<OnlineGateway, readonly string[]> = {
    sslcommerz: ['storeId'],
    bkash: ['username'],
};

export const ONLINE_PAYMENT_LIMITS = {
    expiryMinutes: { min: 15, max: 24 * 60 },
    credentialLength: 200,
    /** New attempts per order (each "Pay again"); more is someone guessing or a loop. */
    attemptsPerOrder: 10,
} as const;

const gateway = z.object({ enabled: z.boolean(), mode: z.enum(GATEWAY_MODES) });

export const onlinePaymentSettingsSchema = z.object({
    sslcommerz: gateway,
    bkash: gateway,
    /** How long an unpaid online order holds its stock before it's cancelled. */
    expiryMinutes: z
        .number()
        .int('invalid')
        .min(ONLINE_PAYMENT_LIMITS.expiryMinutes.min, 'invalid')
        .max(ONLINE_PAYMENT_LIMITS.expiryMinutes.max, 'invalid'),
    /** An order whose online advance wasn't paid keeps waiting (staff follow up) instead of cancelling. */
    keepAdvanceOrdersWaiting: z.boolean(),
});

export type OnlinePaymentSettings = z.output<typeof onlinePaymentSettingsSchema>;

/** Both off and in sandbox until the merchant has credentials; 45 minutes to pay (the roadmap's advice). */
export function defaultOnlinePaymentSettings(): OnlinePaymentSettings {
    return {
        sslcommerz: { enabled: false, mode: 'sandbox' },
        bkash: { enabled: false, mode: 'sandbox' },
        expiryMinutes: 45,
        keepAdvanceOrdersWaiting: false,
    };
}

export type ParseOnlinePaymentSettingsResult =
    { ok: true; settings: OnlinePaymentSettings } | { ok: false; errors: SettingsFieldError[] };

export function parseOnlinePaymentSettings(input: unknown): ParseOnlinePaymentSettingsResult {
    const result = onlinePaymentSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

export type GatewayCredentials = Record<string, string>;

/**
 * Credentials as staff typed them: each field trimmed; an empty or missing field keeps the saved
 * value (secrets are never sent back to the screen, so the form leaves them blank).
 */
export function mergeCredentials(
    gateway: OnlineGateway,
    saved: GatewayCredentials | null,
    input: unknown,
): { ok: true; credentials: GatewayCredentials } | { ok: false; errors: SettingsFieldError[] } {
    const fields = GATEWAY_CREDENTIAL_FIELDS[gateway];
    const given = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const credentials: GatewayCredentials = {};
    const errors: SettingsFieldError[] = [];
    for (const field of fields) {
        const value = given[field];
        if (value !== undefined && value !== null && typeof value !== 'string') {
            errors.push({ path: field, code: 'invalid' });
            continue;
        }
        const typed = (value ?? '').trim();
        if (typed.length > ONLINE_PAYMENT_LIMITS.credentialLength) {
            errors.push({ path: field, code: 'tooLong' });
            continue;
        }
        credentials[field] = typed || saved?.[field] || '';
    }
    return errors.length ? { ok: false, errors } : { ok: true, credentials };
}

/** All fields filled in: the gateway can be used. */
export function hasAllCredentials(gateway: OnlineGateway, credentials: GatewayCredentials | null): boolean {
    return !!credentials && GATEWAY_CREDENTIAL_FIELDS[gateway].every(field => !!credentials[field]);
}

/** Poisha → the gateways' decimal taka string: 125000 → "1250.00". Integer arithmetic only. */
export function toGatewayAmount(minor: number): string {
    if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Invalid amount');
    const taka = Math.floor(minor / 100);
    const poisha = minor % 100;
    return `${taka}.${String(poisha).padStart(2, '0')}`;
}

/**
 * A gateway's amount ("1250", "1250.0", "1250.00") → poisha, or null when it isn't a plain amount.
 * Parsed as text, never as a float, so 1250.10 is exactly 125010.
 */
export function fromGatewayAmount(value: unknown): number | null {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) return null;
    return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * When the reconciliation task next asks the gateway about an unfinished attempt: every 5 minutes
 * for the first day, then hourly until it's 7 days old, then never (it's given up as abandoned).
 */
export function nextReconcileDelayMs(ageMs: number): number | null {
    if (ageMs < 24 * HOUR) return 5 * MINUTE;
    if (ageMs < 7 * 24 * HOUR) return HOUR;
    return null;
}

/** What happened to one try at paying. */
export const ATTEMPT_STATUSES = ['created', 'started', 'paid', 'failed', 'cancelled', 'expired'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * Why money from an attempt needs a person: paid after the order was cancelled, a second payment for
 * an order already paid, a payment the gateway flags as risky, or the amount or currency is wrong.
 */
export const PAYMENT_REVIEW_REASONS = ['late', 'duplicate', 'risky', 'mismatch'] as const;
export type PaymentReviewReason = (typeof PAYMENT_REVIEW_REASONS)[number];

export const PAYMENT_REVIEW_STATES = ['open', 'accepted', 'refunded', 'resolved'] as const;
export type PaymentReviewState = (typeof PAYMENT_REVIEW_STATES)[number];

/** What the shopper is told after a failed bKash payment, by group of bKash error codes. */
export type BkashFailure =
    'insufficientBalance' | 'verification' | 'wallet' | 'limit' | 'alreadyPaid' | 'failed';

const BKASH_FAILURE_OF: Record<string, BkashFailure> = {
    '2023': 'insufficientBalance',
    '2010': 'verification',
    '2011': 'verification',
    '2014': 'verification',
    '2016': 'verification',
    '2018': 'verification',
    '2019': 'verification',
    '2009': 'wallet',
    '2037': 'wallet',
    '2038': 'wallet',
    '2045': 'wallet',
    '2057': 'wallet',
    '2058': 'wallet',
    '2013': 'limit',
    '2015': 'limit',
    '2017': 'limit',
    '2059': 'limit',
    '2062': 'alreadyPaid',
    '2068': 'alreadyPaid',
    '2117': 'alreadyPaid',
};

export function bkashFailure(code: unknown): BkashFailure {
    return BKASH_FAILURE_OF[String(code ?? '')] ?? 'failed';
}

export const BKASH_FAILURE_MESSAGES: Record<'en' | 'bn', Record<BkashFailure, string>> = {
    en: {
        insufficientBalance: 'Your bKash account does not have enough balance. Add money and try again.',
        verification: 'The verification code or PIN was wrong or timed out. Please try again.',
        wallet: 'This bKash account cannot make this payment. Try another account or method.',
        limit: 'Too many tries on this bKash account. Wait a little and try again.',
        alreadyPaid: 'This payment was already completed.',
        failed: 'The bKash payment did not go through. Please try again.',
    },
    bn: {
        insufficientBalance: 'আপনার বিকাশ অ্যাকাউন্টে যথেষ্ট ব্যালেন্স নেই। টাকা যোগ করে আবার চেষ্টা করুন।',
        verification: 'ভেরিফিকেশন কোড বা পিন ভুল হয়েছে বা সময় শেষ হয়ে গেছে। আবার চেষ্টা করুন।',
        wallet: 'এই বিকাশ অ্যাকাউন্ট দিয়ে এই পেমেন্ট করা যাবে না। অন্য অ্যাকাউন্ট বা মাধ্যম চেষ্টা করুন।',
        limit: 'এই বিকাশ অ্যাকাউন্টে অনেকবার চেষ্টা হয়েছে। একটু পরে আবার চেষ্টা করুন।',
        alreadyPaid: 'এই পেমেন্ট আগেই সম্পন্ন হয়েছে।',
        failed: 'বিকাশ পেমেন্ট সম্পন্ন হয়নি। আবার চেষ্টা করুন।',
    },
};
