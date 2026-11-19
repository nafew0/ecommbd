import { z } from 'zod';
import { formatOrderNumber } from './order-settings';
import { SHIPPING_ZONES, type ShippingZone } from './shipping';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Branches and stock transfers (phase 54). A branch is Vendure's stock location.
 * Amounts of stock are whole units. There is no money on a transfer.
 */

export const TRANSFER_STATUSES = ['sent', 'partial', 'received'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

const locationId = z
    .string()
    .trim()
    .max(40)
    .transform(value => value);

const zoneIds = z.object({
    dhaka_city: locationId,
    dhaka_suburb: locationId,
    chattogram_city: locationId,
    outside_dhaka: locationId,
});

export interface BranchSettings {
    /** Number prefix, without the hyphen. "ST" and 1001 → ST-1001. */
    transferPrefix: string;
    /** Default branch for each delivery zone. Empty means the online branch. */
    zoneBranch: Record<ShippingZone, string>;
    /** Where each courier picks the parcel up. Empty means the branch the order ships from. */
    pickupBranch: { steadfast: string; pathao: string };
}

export function defaultBranchSettings(): BranchSettings {
    return {
        transferPrefix: 'ST',
        zoneBranch: { dhaka_city: '', dhaka_suburb: '', chattogram_city: '', outside_dhaka: '' },
        pickupBranch: { steadfast: '', pathao: '' },
    };
}

const prefix = z.string().transform(value =>
    cleanText(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6),
);

const settingsSchema = z.object({
    transferPrefix: prefix,
    zoneBranch: zoneIds,
    pickupBranch: z.object({
        steadfast: locationId,
        pathao: locationId,
    }),
});

export type ParseBranchSettingsResult =
    | { ok: true; settings: BranchSettings }
    | { ok: false; errors: SettingsFieldError[] };

export function parseBranchSettings(input: unknown): ParseBranchSettingsResult {
    const result = settingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

export function formatTransferNumber(prefixValue: string, sequence: number): string {
    return formatOrderNumber(prefixValue, sequence);
}

export const branchInputSchema = z.object({
    name: z
        .string()
        .transform(value => cleanText(value))
        .pipe(z.string().min(1, 'required').max(80, 'tooLong')),
    phone: z.string().transform(value => cleanText(value)),
    districtId: z.string().trim().max(16),
    thanaId: z.string().trim().max(16),
    addressLine: z
        .string()
        .transform(value => cleanText(value))
        .pipe(z.string().max(200, 'tooLong')),
    note: z
        .string()
        .transform(value => cleanText(value, { multiline: true }))
        .pipe(z.string().max(500, 'tooLong')),
    sellsOnline: z.boolean(),
});

export type BranchInput = z.infer<typeof branchInputSchema>;

export function parseBranchInput(input: unknown):
    | { ok: true; value: BranchInput }
    | { ok: false; errors: SettingsFieldError[] } {
    const result = branchInputSchema.safeParse(input);
    return result.success
        ? { ok: true, value: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

const line = z.object({
    variantId: z.string().trim().min(1, 'required').max(40, 'invalid'),
    quantity: z.number().int('invalid').min(1, 'invalid').max(100_000, 'invalid'),
});

export const sendTransferSchema = z.object({
    fromId: z.string().trim().min(1, 'required').max(40),
    toId: z.string().trim().min(1, 'required').max(40),
    note: z
        .string()
        .transform(value => cleanText(value, { multiline: true }))
        .pipe(z.string().max(500, 'tooLong')),
    lines: z.array(line).min(1, 'required').max(100, 'tooMany'),
});

export type SendTransferInput = z.infer<typeof sendTransferSchema>;

export function parseSendTransfer(input: unknown):
    | { ok: true; value: SendTransferInput }
    | { ok: false; errors: SettingsFieldError[] } {
    const result = sendTransferSchema.safeParse(input);
    return result.success
        ? { ok: true, value: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

export const receiveTransferSchema = z.object({
    lines: z
        .array(
            z.object({
                lineId: z.string().trim().min(1).max(40),
                quantity: z.number().int('invalid').min(0, 'invalid').max(100_000, 'invalid'),
            }),
        )
        .min(1, 'required')
        .max(100, 'tooMany'),
});

export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export function parseReceiveTransfer(input: unknown):
    | { ok: true; value: ReceiveTransferInput }
    | { ok: false; errors: SettingsFieldError[] } {
    const result = receiveTransferSchema.safeParse(input);
    return result.success
        ? { ok: true, value: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** The address a courier collects from, one fact per line. */
export function formatBranchAddress(parts: {
    name: string;
    addressLine: string;
    thana: string;
    district: string;
    phone: string;
}): string {
    const place = [parts.thana, parts.district].filter(part => part.trim()).join(', ');
    return [parts.name, parts.addressLine, place, parts.phone]
        .map(part => part.trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 500);
}

export const BRANCH_ZONES = SHIPPING_ZONES;
