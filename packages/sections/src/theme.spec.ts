import { describe, expect, it } from 'vitest';
import {
    checkThemeInput,
    contrastRatio,
    defaultThemeSettings,
    hasDefaultColours,
    luminance,
    mix,
    normalizeHex,
    readableOn,
    readThemeSettings,
    THEMES,
    themeAttributes,
    themeCss,
    themeVariables,
    themeVersion,
} from './theme';

describe('colours', () => {
    it('normalizes hex colours and refuses anything else', () => {
        expect(normalizeHex('#ABC')).toBe('#aabbcc');
        expect(normalizeHex(' 006A4E ')).toBe('#006a4e');
        expect(normalizeHex('#12345')).toBeNull();
        expect(normalizeHex('red')).toBeNull();
        expect(normalizeHex('#fff;background:url(x)')).toBeNull();
        expect(normalizeHex(42)).toBeNull();
    });

    it('measures contrast as WCAG does', () => {
        expect(luminance('#ffffff')).toBeCloseTo(1);
        expect(luminance('#000000')).toBe(0);
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
        expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
        expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
    });

    it('picks readable text for a colour', () => {
        expect(readableOn('#006a4e')).toBe('#ffffff');
        expect(readableOn('#ffd400')).toBe('#121212');
        expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    });
});

describe('theme settings', () => {
    it('gives each theme its own readable defaults', () => {
        for (const theme of THEMES) {
            const settings = defaultThemeSettings(theme);
            expect(settings.theme).toBe(theme);
            const checked = checkThemeInput(settings);
            expect(checked.errors).toEqual([]);
            expect(checked.warnings).toEqual([]);
            expect(hasDefaultColours(settings)).toBe(true);
        }
        expect(defaultThemeSettings('bazaar').cards).toBe('card');
    });

    it('keeps the announcement when switching themes', () => {
        const announcement = { enabled: false, text: { bn: 'ঈদ অফার', en: 'Eid offer' } };
        expect(defaultThemeSettings('bazaar', announcement).announcement).toEqual(announcement);
    });

    it('reads stored settings leniently', () => {
        const settings = readThemeSettings({
            theme: 'bazaar',
            colours: { accent: '#ff0000', text: 'nope' },
            font: 'comic-sans',
            buttons: 'outline',
            header: 'left',
            cards: 'plain',
            logoSize: 'l',
            announcement: { enabled: false, text: { bn: '  ঈদ   অফার ', en: 9 } },
        });
        expect(settings).toMatchObject({
            theme: 'bazaar',
            colours: { background: '#ffffff', text: '#1a1a1a', accent: '#ff0000', sale: '#c8102e' },
            font: 'hind-siliguri',
            buttons: 'outline',
            header: 'left',
            cards: 'plain',
            logoSize: 'l',
            announcement: {
                enabled: false,
                text: { bn: 'ঈদ অফার', en: 'Cash on delivery all over Bangladesh' },
            },
        });
        expect(readThemeSettings(null)).toEqual(defaultThemeSettings('minimal'));
        expect(readThemeSettings({ announcement: { text: 'x' } }).announcement.enabled).toBe(true);
    });

    it('refuses unreadable body text and bad colours, and warns about weak buttons', () => {
        const low = checkThemeInput({ colours: { background: '#ffffff', text: '#bbbbbb' } });
        expect(low.errors).toEqual([{ path: 'colours.text', code: 'lowContrast', ratio: 1.9 }]);
        const bad = checkThemeInput({ colours: { accent: 'url(javascript:x)' } });
        expect(bad.errors).toEqual([{ path: 'colours.accent', code: 'invalidColour' }]);
        // Mid grey: neither white nor black text reaches 4.5:1 on it.
        const weak = checkThemeInput({ colours: { accent: '#f0f0f0', sale: '#777777' } });
        expect(weak.errors).toEqual([]);
        expect(weak.warnings).toEqual([
            { path: 'colours.sale', code: 'lowContrast', ratio: 4.4 },
            { path: 'colours.accent', code: 'lowContrast', ratio: 1.1 },
        ]);
        const mid = checkThemeInput({ colours: { accent: '#a0a0a0' } });
        expect(mid.warnings).toEqual([{ path: 'colours.accent', code: 'lowContrast', ratio: 2.6 }]);
    });
});

describe('stylesheet', () => {
    it('derives the variables the storefront uses', () => {
        const variables = themeVariables(defaultThemeSettings('bazaar'));
        expect(variables).toMatchObject({
            '--background': '#ffffff',
            '--accent': '#006a4e',
            '--on-accent': '#ffffff',
            '--on-sale': '#ffffff',
        });
        expect(contrastRatio(variables['--text-soft']!, variables['--background']!)).toBeGreaterThanOrEqual(
            4.5,
        );
    });

    it('keeps soft text readable on dark and mid backgrounds', () => {
        const dark = readThemeSettings({ colours: { background: '#121212', text: '#f5f5f5' } });
        const variables = themeVariables(dark);
        expect(contrastRatio(variables['--text-soft']!, '#121212')).toBeGreaterThanOrEqual(4.5);
        const mid = readThemeSettings({ colours: { background: '#ffffff', text: '#6b6b6b' } });
        expect(contrastRatio(themeVariables(mid)['--text-soft']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
        // Text that only just passes: the soft text is the text itself.
        const tight = readThemeSettings({ colours: { background: '#ffffff', text: '#767676' } });
        expect(themeVariables(tight)['--text-soft']).toBe('#767676');
    });

    it('writes the stylesheet, attributes and a version that changes with the settings', () => {
        const settings = defaultThemeSettings('minimal');
        expect(themeCss(settings)).toMatch(/^:root\{--background:#ffffff;--text:#121212;.*\}$/);
        expect(themeAttributes(settings)).toEqual({
            'data-theme': 'minimal',
            'data-font': 'system',
            'data-buttons': 'solid',
            'data-header': 'left',
            'data-cards': 'plain',
            'data-logo': 'm',
        });
        const changed = { ...settings, colours: { ...settings.colours, accent: '#006a4e' } };
        expect(themeVersion(changed)).not.toBe(themeVersion(settings));
        expect(themeVersion(settings)).toBe(themeVersion(defaultThemeSettings('minimal')));
        expect(hasDefaultColours(changed)).toBe(false);
    });
});
