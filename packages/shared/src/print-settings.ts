import { z } from 'zod';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Print settings (roadmap phase 06, Vendure's settings store `bdPrint.settings`): which invoice and
 * sticker size to use, what they show, the language and digits, and a footer line.
 */

export const PRINT_DOCUMENTS = ['invoice', 'slip', 'receipt', 'sticker'] as const;
export type PrintDocument = (typeof PRINT_DOCUMENTS)[number];

export const INVOICE_SIZES = ['a4', 'a5'] as const;
export type InvoiceSize = (typeof INVOICE_SIZES)[number];

export const STICKER_SIZES = ['4x6', '3x4', 'a4-8', 'a4-12'] as const;
export type StickerSize = (typeof STICKER_SIZES)[number];

export const PRINT_LANGUAGES = ['bn', 'en', 'both'] as const;
export type PrintLanguage = (typeof PRINT_LANGUAGES)[number];

/** Most orders printed in one go: larger selections print in batches, so the browser stays responsive. */
export const PRINT_BATCH_SIZE = 100;

const FOOTER_MAX = 300;
const footer = z
    .string()
    .transform(value => cleanText(value, { multiline: true }))
    .pipe(z.string().max(FOOTER_MAX, 'tooLong'));

export const printSettingsSchema = z.object({
    invoice: z.object({
        size: z.enum(INVOICE_SIZES),
        showLogo: z.boolean(),
        showStoreAddress: z.boolean(),
        showNote: z.boolean(),
        /** The first part of the return policy (or the footer text) at the bottom. */
        showReturnPolicy: z.boolean(),
    }),
    sticker: z.object({
        size: z.enum(STICKER_SIZES),
        /** List the items on the sticker (helps the packer and the courier). */
        showItems: z.boolean(),
        /** The store's name and phone as the sender. */
        showSender: z.boolean(),
        showNote: z.boolean(),
    }),
    /** Bangla, English, or both side by side on every label. */
    language: z.enum(PRINT_LANGUAGES),
    /** Amounts, dates and numbers in Bangla digits (৳১,২৫০). Phone numbers keep Latin digits. */
    banglaDigits: z.boolean(),
    /** Replaces the return policy line at the bottom of invoices when not empty. */
    footerText: z.object({ bn: footer, en: footer }),
});

export type PrintSettings = z.output<typeof printSettingsSchema>;

export function defaultPrintSettings(): PrintSettings {
    return {
        invoice: {
            size: 'a4',
            showLogo: true,
            showStoreAddress: true,
            showNote: true,
            showReturnPolicy: true,
        },
        sticker: { size: '4x6', showItems: true, showSender: true, showNote: true },
        language: 'bn',
        banglaDigits: false,
        footerText: { bn: '', en: '' },
    };
}

export type ParsePrintSettingsResult =
    { ok: true; settings: PrintSettings } | { ok: false; errors: SettingsFieldError[] };

export function parsePrintSettings(input: unknown): ParsePrintSettingsResult {
    const result = printSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** The physical page each document and size prints on, in millimetres (portrait). */
export function pageSizeMm(
    document: PrintDocument,
    size: { invoice: InvoiceSize; sticker: StickerSize },
): { width: number; height: number } {
    switch (document) {
        case 'invoice':
        case 'slip':
            return size.invoice === 'a5' ? { width: 148, height: 210 } : { width: 210, height: 297 };
        case 'receipt':
            // The height is the receipt's own length; this is only the width of the roll.
            return { width: 80, height: 0 };
        case 'sticker':
            return STICKER_PAGES[size.sticker];
    }
}

/** One sticker per page (4 × 6 in, 3 × 4 in), or an A4 sheet of 8 (2 × 4) or 12 (3 × 4) labels. */
export const STICKER_PAGES: Record<StickerSize, { width: number; height: number }> = {
    '4x6': { width: 101.6, height: 152.4 },
    '3x4': { width: 76.2, height: 101.6 },
    'a4-8': { width: 210, height: 297 },
    'a4-12': { width: 210, height: 297 },
};

/** Labels per page and their grid. */
export const STICKER_GRID: Record<StickerSize, { columns: number; rows: number }> = {
    '4x6': { columns: 1, rows: 1 },
    '3x4': { columns: 1, rows: 1 },
    'a4-8': { columns: 2, rows: 4 },
    'a4-12': { columns: 3, rows: 4 },
};
