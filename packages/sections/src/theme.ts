import { type Bilingual, cleanText, isRecord } from './text';

/**
 * Themes (roadmap phase 15): two looks over the same sections, and the few settings a merchant can
 * change. Switching themes never touches page layouts. Colours are validated hex values; body text
 * must stay readable (4.5:1, WCAG AA) or the theme isn't saved.
 */

export const THEMES = ['minimal', 'bazaar'] as const;
export type ThemeName = (typeof THEMES)[number];

export const FONTS = ['system', 'hind-siliguri', 'noto-serif-bengali'] as const;
export type FontName = (typeof FONTS)[number];

export interface ThemeColours {
    background: string;
    text: string;
    /** Buttons, links that stand out, the announcement bar. */
    accent: string;
    /** Sale badges and prices. */
    sale: string;
}

export interface ThemeSettings {
    theme: ThemeName;
    colours: ThemeColours;
    font: FontName;
    /** Corners stay square or nearly (CLAUDE.md: no pill shapes). */
    buttons: 'solid' | 'outline' | 'rounded';
    header: 'left' | 'center';
    cards: 'plain' | 'card';
    logoSize: 's' | 'm' | 'l';
    announcement: { enabled: boolean; text: Bilingual };
}

export const THEME_INFO: Record<ThemeName, { name: Bilingual; description: Bilingual }> = {
    minimal: {
        name: { bn: 'মিনিমাল', en: 'Minimal' },
        description: {
            bn: 'পরিষ্কার আর খোলামেলা: বড় ছবি, শান্ত রং। পোশাক, প্রসাধনী আর ব্র্যান্ডের জন্য।',
            en: 'Clean and airy: large photos, calm colours. For fashion, cosmetics and brands.',
        },
    },
    bazaar: {
        name: { bn: 'বাজার', en: 'Bazaar' },
        description: {
            bn: 'জমজমাট আর সাহসী: এক স্ক্রিনে বেশি পণ্য, চোখে পড়ার মতো রং। গ্যাজেট, খাবার আর অনেক পণ্যের দোকানের জন্য।',
            en: 'Busy and bold: more products per screen, colours that stand out. For gadgets, food and large catalogues.',
        },
    },
};

export const FONT_INFO: Record<FontName, { name: Bilingual; family: string }> = {
    system: {
        name: { bn: 'ফোনের নিজের ফন্ট', en: 'The device’s own font' },
        family: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans Bengali', 'Noto Sans', Roboto, sans-serif",
    },
    'hind-siliguri': {
        name: { bn: 'হিন্দ শিলিগুড়ি', en: 'Hind Siliguri' },
        family: "'Hind Siliguri', system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    'noto-serif-bengali': {
        name: { bn: 'নোটো সেরিফ বাংলা', en: 'Noto Serif Bengali' },
        family: "'Noto Serif Bengali', Georgia, 'Times New Roman', serif",
    },
};

const DEFAULT_ANNOUNCEMENT: Bilingual = {
    bn: 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি',
    en: 'Cash on delivery all over Bangladesh',
};

const THEME_DEFAULTS: Record<ThemeName, Omit<ThemeSettings, 'theme' | 'announcement'>> = {
    minimal: {
        colours: { background: '#ffffff', text: '#121212', accent: '#121212', sale: '#b3261e' },
        font: 'system',
        buttons: 'solid',
        header: 'left',
        cards: 'plain',
        logoSize: 'm',
    },
    bazaar: {
        // Bangladesh's own green and a red that keeps 4.5:1 with white text.
        colours: { background: '#ffffff', text: '#1a1a1a', accent: '#006a4e', sale: '#c8102e' },
        font: 'hind-siliguri',
        buttons: 'rounded',
        header: 'center',
        cards: 'card',
        logoSize: 'm',
    },
};

/** A theme's own defaults, keeping the announcement (switching themes keeps the merchant's text). */
export function defaultThemeSettings(
    theme: ThemeName = 'minimal',
    announcement?: ThemeSettings['announcement'],
): ThemeSettings {
    return {
        theme,
        ...structuredClone(THEME_DEFAULTS[theme]),
        announcement: announcement
            ? structuredClone(announcement)
            : { enabled: true, text: { ...DEFAULT_ANNOUNCEMENT } },
    };
}

const HEX = /^#[0-9a-f]{6}$/;

/** `#ABC` or `abcdef` as `#aabbcc`; null when it isn't a colour. */
export function normalizeHex(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    let hex = value.trim().toLowerCase();
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map(digit => digit + digit).join('')}`;
    return HEX.test(hex) ? hex : null;
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
    return options.includes(value as T) ? (value as T) : fallback;
}

/** Stored theme settings read back: anything missing or wrong takes the theme's default. */
export function readThemeSettings(value: unknown): ThemeSettings {
    const raw = isRecord(value) ? value : {};
    const theme = oneOf(THEMES, raw.theme, 'minimal');
    const base = defaultThemeSettings(theme);
    const colours = isRecord(raw.colours) ? raw.colours : {};
    const announcement = isRecord(raw.announcement) ? raw.announcement : {};
    const announcementText = isRecord(announcement.text) ? announcement.text : {};
    const line = (text: unknown, fallback: string) =>
        typeof text === 'string' ? cleanText(text).slice(0, 120) : fallback;
    return {
        theme,
        colours: {
            background: normalizeHex(colours.background) ?? base.colours.background,
            text: normalizeHex(colours.text) ?? base.colours.text,
            accent: normalizeHex(colours.accent) ?? base.colours.accent,
            sale: normalizeHex(colours.sale) ?? base.colours.sale,
        },
        font: oneOf(FONTS, raw.font, base.font),
        buttons: oneOf(['solid', 'outline', 'rounded'] as const, raw.buttons, base.buttons),
        header: oneOf(['left', 'center'] as const, raw.header, base.header),
        cards: oneOf(['plain', 'card'] as const, raw.cards, base.cards),
        logoSize: oneOf(['s', 'm', 'l'] as const, raw.logoSize, base.logoSize),
        announcement: {
            enabled:
                typeof announcement.enabled === 'boolean' ? announcement.enabled : base.announcement.enabled,
            text: {
                bn: line(announcementText.bn, base.announcement.text.bn),
                en: line(announcementText.en, base.announcement.text.en),
            },
        },
    };
}

export interface ThemeProblem {
    /** `colours.text`, `colours.accent`… */
    path: string;
    code: 'invalidColour' | 'lowContrast';
    /** The contrast found, rounded to one decimal, for the message. */
    ratio?: number;
}

/** Input from the theme screen: errors stop saving, warnings are only shown. */
export function checkThemeInput(input: unknown): {
    settings: ThemeSettings;
    errors: ThemeProblem[];
    warnings: ThemeProblem[];
} {
    const errors: ThemeProblem[] = [];
    const colours = isRecord(input) && isRecord(input.colours) ? input.colours : {};
    for (const key of ['background', 'text', 'accent', 'sale'] as const) {
        if (key in colours && normalizeHex(colours[key]) === null) {
            errors.push({ path: `colours.${key}`, code: 'invalidColour' });
        }
    }
    const settings = readThemeSettings(input);
    const { background, text, accent } = settings.colours;
    const body = contrastRatio(text, background);
    if (body < 4.5) errors.push({ path: 'colours.text', code: 'lowContrast', ratio: round(body) });
    const warnings: ThemeProblem[] = [];
    for (const key of ['accent', 'sale'] as const) {
        const colour = settings.colours[key];
        const ratio = contrastRatio(colour, readableOn(colour));
        if (ratio < 4.5) warnings.push({ path: `colours.${key}`, code: 'lowContrast', ratio: round(ratio) });
    }
    // A button that blends into the page is hard to find.
    const edge = contrastRatio(accent, background);
    if (edge < 3 && !warnings.some(warning => warning.path === 'colours.accent')) {
        warnings.push({ path: 'colours.accent', code: 'lowContrast', ratio: round(edge) });
    }
    return { settings, errors, warnings };
}

const round = (ratio: number) => Math.floor(ratio * 10) / 10;

function channels(hex: string): [number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
    const [r, g, b] = channels(hex).map(channel => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

/** White or near-black, whichever reads better on this colour. */
export function readableOn(hex: string): string {
    return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#121212') ? '#ffffff' : '#121212';
}

/** `a` with `weight` (0–1) of `b` mixed in. */
export function mix(a: string, b: string, weight: number): string {
    const [ar, ag, ab] = channels(a);
    const [br, bg, bb] = channels(b);
    const one = (x: number, y: number) =>
        Math.round(x + (y - x) * weight)
            .toString(16)
            .padStart(2, '0');
    return `#${one(ar, br)}${one(ag, bg)}${one(ab, bb)}`;
}

/**
 * The CSS custom properties the storefront's stylesheet uses (`--text`, `--accent`…), derived from
 * the palette. `--text-soft` keeps at least 4.5:1 on the background.
 */
export function themeVariables(settings: ThemeSettings): Record<string, string> {
    const { background, text, accent, sale } = settings.colours;
    let softWeight = 0.28;
    while (softWeight > 0 && contrastRatio(mix(text, background, softWeight), background) < 4.5)
        softWeight -= 0.04;
    const dark = luminance(background) < 0.2;
    return {
        '--background': background,
        '--text': text,
        '--text-soft': mix(text, background, Math.max(softWeight, 0)),
        '--line': mix(background, text, 0.12),
        '--line-strong': mix(background, text, 0.32),
        '--subtle': mix(background, text, dark ? 0.08 : 0.045),
        '--accent': accent,
        '--on-accent': readableOn(accent),
        '--sale': sale,
        '--on-sale': readableOn(sale),
    };
}

/** Data attributes on `<html>` that switch the theme's look in the stylesheet. */
export function themeAttributes(settings: ThemeSettings): Record<string, string> {
    return {
        'data-theme': settings.theme,
        'data-font': settings.font,
        'data-buttons': settings.buttons,
        'data-header': settings.header,
        'data-cards': settings.cards,
        'data-logo': settings.logoSize,
    };
}

/** True when the colours are the theme's own (the storefront then needs no extra stylesheet). */
export function hasDefaultColours(settings: ThemeSettings): boolean {
    const own = THEME_DEFAULTS[settings.theme].colours;
    return (Object.keys(own) as Array<keyof ThemeColours>).every(key => own[key] === settings.colours[key]);
}

/** The stylesheet for a theme's palette and font (served as `/theme.css`). */
export function themeCss(settings: ThemeSettings): string {
    const declarations = Object.entries(themeVariables(settings))
        .map(([name, value]) => `${name}:${value}`)
        .join(';');
    return `:root{${declarations}}`;
}

/** A short hash of the settings, for the stylesheet's URL (`/theme.css?v=…`). FNV-1a. */
export function themeVersion(settings: ThemeSettings): string {
    let hash = 0x811c9dc5;
    for (const char of JSON.stringify(settings)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
