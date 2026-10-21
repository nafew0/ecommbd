import { describe, expect, it } from 'vitest';
import {
    defaultPrintSettings,
    pageSizeMm,
    parsePrintSettings,
    STICKER_GRID,
    STICKER_PAGES,
    STICKER_SIZES,
} from './print-settings';

describe('print settings', () => {
    it('has defaults that pass the schema', () => {
        const settings = defaultPrintSettings();
        expect(parsePrintSettings(settings)).toEqual({ ok: true, settings });
    });

    it('cleans the footer text and limits its length', () => {
        const settings = defaultPrintSettings();
        const parsed = parsePrintSettings({
            ...settings,
            footerText: { bn: '  ধন্যবাদ!  ', en: 'Thank you' },
        });
        expect(parsed.ok && parsed.settings.footerText).toEqual({ bn: 'ধন্যবাদ!', en: 'Thank you' });
        expect(parsePrintSettings({ ...settings, footerText: { bn: 'ক'.repeat(301), en: '' } })).toEqual({
            ok: false,
            errors: [{ path: 'footerText.bn', code: 'tooLong' }],
        });
    });

    it('refuses unknown sizes and languages', () => {
        const settings = defaultPrintSettings();
        const result = parsePrintSettings({
            ...settings,
            sticker: { ...settings.sticker, size: '5x7' },
            language: 'fr',
        });
        expect(result).toEqual({
            ok: false,
            errors: [
                { path: 'sticker.size', code: 'invalid' },
                { path: 'language', code: 'invalid' },
            ],
        });
    });

    it('knows the paper for each document', () => {
        const size = { invoice: 'a4', sticker: '4x6' } as const;
        expect(pageSizeMm('invoice', size)).toEqual({ width: 210, height: 297 });
        expect(pageSizeMm('slip', { ...size, invoice: 'a5' })).toEqual({ width: 148, height: 210 });
        expect(pageSizeMm('receipt', size)).toEqual({ width: 80, height: 0 });
        expect(pageSizeMm('sticker', size)).toEqual({ width: 101.6, height: 152.4 });
        expect(pageSizeMm('sticker', { ...size, sticker: '3x4' }).width).toBeCloseTo(76.2);
        for (const sticker of STICKER_SIZES) {
            expect(STICKER_PAGES[sticker].width).toBeGreaterThan(0);
            expect(STICKER_GRID[sticker].columns * STICKER_GRID[sticker].rows).toBeGreaterThan(0);
        }
        expect(STICKER_GRID['a4-12']).toEqual({ columns: 3, rows: 4 });
    });
});
