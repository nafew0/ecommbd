import { type ImageValue, readValue } from './fields';
import { type Bilingual, cleanText, EMPTY_TEXT, isRecord } from './text';
import { FONTS, type FontName, normalizeHex } from './theme';

/**
 * A sales page's own settings (roadmap phase 16), next to its sections: how the page around the
 * sections looks, its search-engine fields, its packs and add-on offer, and what happens after an
 * order. Prices are poisha in whole taka, like everywhere else.
 */

export interface SalesPack {
    /** How many of the product. */
    quantity: number;
    /** The pack's total price, in poisha. */
    price: number;
    label: Bilingual;
    popular: boolean;
}

export interface SalesBump {
    enabled: boolean;
    /** The add-on product variant. */
    variantId: string | null;
    /** Its special price for one, in poisha. */
    price: number | null;
    title: Bilingual;
    text: Bilingual;
}

export interface SalesPageSettings {
    /** `slim`: a bar with the logo and phone; `store`: the store's own header; `none`. */
    header: 'slim' | 'store' | 'none';
    /** A small footer with the store's name and policies. */
    footer: boolean;
    /** Empty means the theme's. */
    colours: { main: string; sale: string; background: string };
    font: FontName | '';
    /** A phone-width column even on computers (BD sales pages), or the full width. */
    width: 'phone' | 'full';
    seo: { title: Bilingual; description: Bilingual; image: ImageValue | null };
    /** Ad pages shouldn't compete with the product's own page: on by default. */
    hideFromGoogle: boolean;
    /** Price and "Order now" fixed at the bottom on phones. */
    stickyBar: boolean;
    packs: SalesPack[];
    bump: SalesBump;
    thankYou: { message: Bilingual; whatsapp: boolean; redirect: string };
}

export const SALES_LIMITS = {
    title: 150,
    slug: 80,
    packs: 6,
    packQuantity: 20,
    label: 60,
    message: 600,
    /** ৳10 lakh. */
    maxPrice: 100_000_000,
} as const;

const text = (value: unknown, max: number): Bilingual => {
    const raw = isRecord(value) ? value : {};
    const one = (part: unknown) => (typeof part === 'string' ? cleanText(part).slice(0, max) : '');
    return { bn: one(raw.bn), en: one(raw.en) };
};

const lines = (value: unknown, max: number): Bilingual => {
    const raw = isRecord(value) ? value : {};
    const one = (part: unknown) => (typeof part === 'string' ? cleanText(part, true).slice(0, max) : '');
    return { bn: one(raw.bn), en: one(raw.en) };
};

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback;

/** Whole taka in poisha, above zero; null for anything else. */
export function readPrice(value: unknown): number | null {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) return null;
    return Math.min(Math.round(number / 100) * 100, SALES_LIMITS.maxPrice);
}

/** A thank-you redirect: a path on this site only (no other site, no `//host`). */
export function isSameSitePath(path: string): boolean {
    return /^\/(?![/\\])[^\s\\]*$/.test(path) && path.length <= 300;
}

export function defaultSalesSettings(): SalesPageSettings {
    return {
        header: 'slim',
        footer: true,
        colours: { main: '', sale: '', background: '' },
        font: '',
        width: 'phone',
        seo: { title: { ...EMPTY_TEXT }, description: { ...EMPTY_TEXT }, image: null },
        hideFromGoogle: true,
        stickyBar: true,
        packs: [],
        bump: {
            enabled: false,
            variantId: null,
            price: null,
            title: { ...EMPTY_TEXT },
            text: { ...EMPTY_TEXT },
        },
        thankYou: {
            message: {
                bn: 'আপনার অর্ডার পেয়েছি। কনফার্ম করতে শিগগিরই কল করব।',
                en: 'We have your order. We’ll call you soon to confirm it.',
            },
            whatsapp: true,
            redirect: '',
        },
    };
}

/** Stored settings read back: anything missing or wrong takes the default. */
export function readSalesSettings(value: unknown): SalesPageSettings {
    const raw = isRecord(value) ? value : {};
    const base = defaultSalesSettings();
    const colours = isRecord(raw.colours) ? raw.colours : {};
    const seo = isRecord(raw.seo) ? raw.seo : {};
    const bump = isRecord(raw.bump) ? raw.bump : {};
    const thankYou = isRecord(raw.thankYou) ? raw.thankYou : {};
    const hex = (part: unknown) => normalizeHex(part) ?? '';
    const packs: SalesPack[] = [];
    for (const item of Array.isArray(raw.packs) ? raw.packs : []) {
        if (!isRecord(item) || packs.length >= SALES_LIMITS.packs) continue;
        const quantity = Number(item.quantity);
        const price = readPrice(item.price);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > SALES_LIMITS.packQuantity || !price)
            continue;
        if (packs.some(pack => pack.quantity === quantity)) continue;
        packs.push({
            quantity,
            price,
            label: text(item.label, SALES_LIMITS.label),
            popular: item.popular === true,
        });
    }
    const redirect = typeof thankYou.redirect === 'string' ? thankYou.redirect.trim() : '';
    return {
        header: oneOf(['slim', 'store', 'none'] as const, raw.header, base.header),
        footer: typeof raw.footer === 'boolean' ? raw.footer : base.footer,
        colours: { main: hex(colours.main), sale: hex(colours.sale), background: hex(colours.background) },
        font: raw.font === '' ? '' : oneOf<FontName | ''>(FONTS, raw.font, base.font),
        width: oneOf(['phone', 'full'] as const, raw.width, base.width),
        seo: {
            title: text(seo.title, 70),
            description: text(seo.description, 200),
            image: readValue({ kind: 'image', label: EMPTY_TEXT }, seo.image),
        },
        hideFromGoogle: typeof raw.hideFromGoogle === 'boolean' ? raw.hideFromGoogle : base.hideFromGoogle,
        stickyBar: typeof raw.stickyBar === 'boolean' ? raw.stickyBar : base.stickyBar,
        packs: packs.sort((a, b) => a.quantity - b.quantity),
        bump: {
            enabled: bump.enabled === true,
            variantId:
                typeof bump.variantId === 'string' && /^[\w-]{1,40}$/.test(bump.variantId)
                    ? bump.variantId
                    : null,
            price: readPrice(bump.price),
            title: text(bump.title, 120),
            text: lines(bump.text, 300),
        },
        thankYou: {
            message: isRecord(thankYou.message)
                ? lines(thankYou.message, SALES_LIMITS.message)
                : base.thankYou.message,
            whatsapp: typeof thankYou.whatsapp === 'boolean' ? thankYou.whatsapp : base.thankYou.whatsapp,
            redirect: isSameSitePath(redirect) ? redirect : '',
        },
    };
}

export interface SalesSettingsProblem {
    path: string;
    code:
        | 'invalidPrice'
        | 'duplicatePack'
        | 'tooManyPacks'
        | 'invalidQuantity'
        | 'invalidRedirect'
        | 'bumpIncomplete';
}

/** What stops the settings from being saved; the read settings either way. */
export function checkSalesSettings(input: unknown): {
    settings: SalesPageSettings;
    errors: SalesSettingsProblem[];
} {
    const raw = isRecord(input) ? input : {};
    const errors: SalesSettingsProblem[] = [];
    const packs = Array.isArray(raw.packs) ? raw.packs : [];
    if (packs.length > SALES_LIMITS.packs) errors.push({ path: 'packs', code: 'tooManyPacks' });
    const seen = new Set<number>();
    packs.slice(0, SALES_LIMITS.packs).forEach((pack, index) => {
        const item = isRecord(pack) ? pack : {};
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > SALES_LIMITS.packQuantity) {
            errors.push({ path: `packs.${index}.quantity`, code: 'invalidQuantity' });
        } else if (seen.has(quantity)) {
            errors.push({ path: `packs.${index}.quantity`, code: 'duplicatePack' });
        }
        seen.add(quantity);
        if (!readPrice(item.price)) errors.push({ path: `packs.${index}.price`, code: 'invalidPrice' });
    });
    const thankYou = isRecord(raw.thankYou) ? raw.thankYou : {};
    if (
        typeof thankYou.redirect === 'string' &&
        thankYou.redirect.trim() &&
        !isSameSitePath(thankYou.redirect.trim())
    ) {
        errors.push({ path: 'thankYou.redirect', code: 'invalidRedirect' });
    }
    const bump = isRecord(raw.bump) ? raw.bump : {};
    if (bump.enabled === true && (!bump.variantId || !readPrice(bump.price))) {
        errors.push({ path: 'bump', code: 'bumpIncomplete' });
    }
    return { settings: readSalesSettings(input), errors };
}

/** What a pack saves against the normal price of its quantity, in poisha (0 when it saves nothing). */
export function packSaving(pack: SalesPack, unitPrice: number): number {
    return Math.max(0, unitPrice * pack.quantity - pack.price);
}

/** A sales page's address segment, from its title or as typed. */
export function toSalesSlug(input: string): string {
    return cleanText(input)
        .normalize('NFC')
        .toLowerCase()
        .replace(/[!"£$%^&*()+[\]{};:@#~?\\/,.|><`¬'=‘’“”©®™।]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, SALES_LIMITS.slug);
}
