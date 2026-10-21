import { z } from 'zod';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Incomplete orders and fake-order protection (roadmap phase 11): settings, the own-store risk
 * score, and the limits for verification codes.
 */

export const OTP_MODES = ['off', 'all', 'firstTime', 'risky'] as const;
export type OtpMode = (typeof OTP_MODES)[number];

/** Verification codes for COD: 6 digits, 5 minutes, 3 tries, a minute between sends, 5 a phone a day. */
export const OTP_RULES = {
    length: 6,
    ttlMs: 5 * 60_000,
    attempts: 3,
    cooldownMs: 60_000,
    perPhonePerDay: 5,
} as const;

export const INCOMPLETE_RULES = {
    /** An order with the same phone within this time recovers the incomplete checkout. */
    recoverWithinDays: 7,
    /** Then the personal data is deleted; only counts stay. */
    expiryDays: 30,
} as const;

export const INCOMPLETE_STATUSES = ['open', 'recovered', 'converted', 'dismissed', 'expired'] as const;
export type IncompleteStatus = (typeof INCOMPLETE_STATUSES)[number];

export const DISMISS_REASONS = ['wrongNumber', 'notInterested', 'alreadyOrdered', 'test', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

/** IP blocks are temporary only: many mobile shoppers share one IP (carrier-grade NAT). */
export const IP_BLOCK_MAX_DAYS = 30;

/** A checkout form sent faster than this is a script. */
export const MIN_SECONDS_ON_FORM = 3;

const message = z
    .string()
    .transform(value => cleanText(value, { multiline: true }))
    .pipe(z.string().min(1, 'required').max(300, 'tooLong'));

export const fraudSettingsSchema = z.object({
    velocity: z.object({
        /** Web orders one phone may place in 24 hours; 0 means no limit. */
        maxOrdersPerPhonePerDay: z.number().int('invalid').min(0, 'invalid').max(50, 'invalid'),
        /** After an order, the same phone can't order again for this many minutes; 0 is off. */
        duplicateOrderMinutes: z.number().int('invalid').min(0, 'invalid').max(1440, 'invalid'),
        /** What the shopper sees then (the storefront adds a WhatsApp button). */
        duplicateOrderMessage: z.object({ bn: message, en: message }),
    }),
    otp: z.object({
        mode: z.enum(OTP_MODES),
        /** A shopper who gets no code may still order; the order is marked "not verified". */
        allowUnverified: z.boolean(),
    }),
    risk: z.object({
        /** From this score an order counts as risky (advance for risky orders, OTP for risky orders). */
        riskyScore: z.number().int('invalid').min(1, 'invalid').max(100, 'invalid'),
    }),
});

export type FraudSettings = z.output<typeof fraudSettingsSchema>;

export function defaultFraudSettings(): FraudSettings {
    return {
        velocity: {
            maxOrdersPerPhonePerDay: 3,
            duplicateOrderMinutes: 0,
            duplicateOrderMessage: {
                bn: 'আপনার অর্ডারটি আমরা পেয়েছি। কিছু যোগ বা বদল করতে চাইলে WhatsApp-এ জানান।',
                en: 'We already have your order. To add or change something, message us on WhatsApp.',
            },
        },
        otp: { mode: 'off', allowUnverified: false },
        risk: { riskyScore: 60 },
    };
}

export type ParseFraudSettingsResult =
    | { ok: true; settings: FraudSettings }
    | { ok: false; errors: SettingsFieldError[] };

export function parseFraudSettings(input: unknown): ParseFraudSettingsResult {
    const result = fraudSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

export interface RiskInputs {
    /** This phone's earlier orders in this store. */
    delivered: number;
    returned: number;
    /** Cancelled with the reason "fake". */
    fake: number;
    /** Orders from this phone in the last 24 hours, not counting this one. */
    ordersLast24h: number;
    /** An order with the same items from this phone in the last 24 hours. */
    duplicateCart: boolean;
    /** The street line ("house, road, area"). */
    street: string;
    /** The thana isn't in the list (the shopper typed an area). */
    otherThana: boolean;
    name: string;
}

export const RISK_REASONS = [
    'fakeBefore',
    'returnsBefore',
    'manyOrders',
    'duplicateCart',
    'shortAddress',
    'unlistedThana',
    'oddName',
    'deliveredBefore',
] as const;
export type RiskReasonCode = (typeof RISK_REASONS)[number];

export interface RiskReason {
    code: RiskReasonCode;
    /** How many (returns, orders…), when it matters. */
    count?: number;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskAssessment {
    /** 0 to 100. */
    score: number;
    level: RiskLevel;
    reasons: RiskReason[];
}

/** A short street line is likely made up or incomplete. */
const SHORT_ADDRESS = 12;

/**
 * The own-store risk score (no outside data): this phone's history here, how fast it orders, and
 * how real the name and address look. Staff see the reasons; nothing is refused because of it
 * unless the merchant asks for an advance or a code for risky orders.
 */
export function assessRisk(inputs: RiskInputs): RiskAssessment {
    const reasons: RiskReason[] = [];
    let score = 0;
    if (inputs.fake > 0) {
        score += Math.min(60, inputs.fake * 40);
        reasons.push({ code: 'fakeBefore', count: inputs.fake });
    }
    if (inputs.returned > 0) {
        score += Math.min(45, inputs.returned * 15);
        reasons.push({ code: 'returnsBefore', count: inputs.returned });
    }
    if (inputs.ordersLast24h > 0) {
        score += Math.min(30, inputs.ordersLast24h * 10);
        reasons.push({ code: 'manyOrders', count: inputs.ordersLast24h + 1 });
    }
    if (inputs.duplicateCart) {
        score += 20;
        reasons.push({ code: 'duplicateCart' });
    }
    if (cleanText(inputs.street).length < SHORT_ADDRESS) {
        score += 10;
        reasons.push({ code: 'shortAddress' });
    }
    if (inputs.otherThana) {
        score += 5;
        reasons.push({ code: 'unlistedThana' });
    }
    if (looksLikeGibberish(inputs.name)) {
        score += 15;
        reasons.push({ code: 'oddName' });
    }
    if (inputs.delivered > 0) {
        // Every delivered order earns trust back, up to 30 points.
        score -= Math.min(30, inputs.delivered * 10);
        reasons.push({ code: 'deliveredBefore', count: inputs.delivered });
    }
    score = Math.max(0, Math.min(100, score));
    return { score, level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low', reasons };
}

const KEYBOARD_RUNS = ['qwer', 'asdf', 'zxcv', 'hjkl', 'sdfg', 'dfgh', 'fghj', 'xcvb', 'wert', 'erty'];

/**
 * A name typed by hammering the keyboard: digits, one letter repeated, a keyboard run, or a long
 * Latin word with no vowels. Bangla names are only checked for digits and repeats.
 */
export function looksLikeGibberish(name: string): boolean {
    const text = cleanText(name).toLowerCase();
    if ([...text.replace(/\s/g, '')].length < 2) return true;
    if (/[0-9০-৯]/.test(text)) return true;
    if (/(.)\1{3,}/u.test(text.replace(/\s/g, ''))) return true;
    if (KEYBOARD_RUNS.some(run => text.includes(run))) return true;
    return text.split(/\s+/).some(word => /^[a-z]{5,}$/.test(word) && !/[aeiouy]/.test(word));
}
