import { z } from 'zod';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { banglaToAsciiDigits, cleanText } from './text';

/**
 * Order settings (roadmap phase 04, Vendure's settings store `bdOrders.settings`): the order
 * number prefix, packing prepaid orders without a call, and the auto-cancel suggestion.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const orderSettingsSchema = z.object({
    /** Up to 6 letters or digits, shown before the number: `MF` → `MF-1001`. Empty for `1001`. */
    orderNumberPrefix: z
        .string()
        .transform(value => cleanText(value).toUpperCase())
        .pipe(z.string().regex(/^[A-Z0-9]{0,6}$/, 'invalid')),
    /** Fully prepaid orders may be packed without a confirmation call. */
    skipConfirmationForPrepaid: z.boolean(),
    autoCancel: z.object({
        /** Flag New orders that look unreachable in the confirmation queue. */
        suggest: z.boolean(),
        /** …once they're this many days old… */
        afterDays: z.number().int('invalid').min(1, 'invalid').max(30, 'invalid'),
        /** …with at least this many unanswered calls. */
        minFailedCalls: z.number().int('invalid').min(1, 'invalid').max(20, 'invalid'),
        /** Cancel those orders automatically (reason "unreachable"). Off unless the merchant turns it on. */
        cancelAutomatically: z.boolean(),
    }),
});

export type OrderSettings = z.output<typeof orderSettingsSchema>;

export function defaultOrderSettings(): OrderSettings {
    return {
        orderNumberPrefix: '',
        skipConfirmationForPrepaid: false,
        autoCancel: { suggest: false, afterDays: 3, minFailedCalls: 3, cancelAutomatically: false },
    };
}

export type ParseOrderSettingsResult =
    { ok: true; settings: OrderSettings } | { ok: false; errors: SettingsFieldError[] };

export function parseOrderSettings(input: unknown): ParseOrderSettingsResult {
    const result = orderSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** `MF` and 1001 → `MF-1001`; no prefix → `1001`. */
export function formatOrderNumber(prefix: string, sequence: number): string {
    return prefix ? `${prefix}-${sequence}` : String(sequence);
}

/**
 * What staff type when looking for an order number ("#১০০১", "mf-1001 ") → `MF-1001` or `1001`.
 * Returns null when it can't be an order number.
 */
export function normalizeOrderNumberSearch(input: string): string | null {
    const text = banglaToAsciiDigits(cleanText(input)).replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
    return /^(?:[A-Z0-9]{1,6}-)?\d+$/.test(text) ? text : null;
}

/** An unconfirmed order old enough, with enough unanswered calls, to suggest cancelling. */
export function shouldSuggestCancel(
    order: { placedAt: Date; failedCalls: number },
    settings: OrderSettings['autoCancel'],
    now: Date = new Date(),
): boolean {
    if (!settings.suggest && !settings.cancelAutomatically) {
        return false;
    }
    return (
        now.getTime() - order.placedAt.getTime() >= settings.afterDays * DAY_MS &&
        order.failedCalls >= settings.minFailedCalls
    );
}
