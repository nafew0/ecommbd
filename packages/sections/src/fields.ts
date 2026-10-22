import { type Bilingual, cleanText, EMPTY_TEXT, isRecord } from './text';
import { normalizeHex } from './theme';

/**
 * Field types for section settings (roadmap phase 15). Each type knows its default, how to read a
 * stored value whatever shape it has (anything wrong becomes the default, so old or damaged data
 * always opens), and what blocks publishing (a broken link, an unknown video address).
 */

/** Colours a section may use: names from the theme's palette, never raw values (no CSS injection). */
export const PALETTE_COLOURS = ['text', 'accent', 'sale', 'subtle'] as const;
export type PaletteColour = (typeof PALETTE_COLOURS)[number];

export const POLICY_KEYS = ['returnPolicy', 'refundPolicy', 'privacyPolicy', 'terms'] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];

export interface ImageValue {
    /** The asset's ID. */
    assetId: string;
    /** The asset's preview path, for the editor's thumbnails (the core refreshes it). */
    preview: string;
}

/** Where a button or link goes. The core adds `href` when it serves a layout to the storefront. */
export type LinkValue = (
    | { type: 'none' }
    | { type: 'home' }
    | { type: 'search' }
    | { type: 'category'; ref: string }
    | { type: 'product'; ref: string }
    | { type: 'page'; ref: string }
    | { type: 'policy'; policy: PolicyKey }
    | { type: 'anchor'; anchor: string }
    | { type: 'whatsapp' }
    | { type: 'call' }
    | { type: 'url'; url: string }
) & { href?: string };

export type LinkType = LinkValue['type'];

export const LINK_TYPES: readonly LinkType[] = [
    'none',
    'home',
    'search',
    'category',
    'product',
    'page',
    'policy',
    'anchor',
    'whatsapp',
    'call',
    'url',
];

/** Show a field only while other fields have one of these values (`{ source: ['collection'] }`). */
export type FieldCondition = Readonly<Record<string, ReadonlyArray<string | boolean>>>;

interface FieldBase {
    label: Bilingual;
    hint?: Bilingual;
    when?: FieldCondition;
}

export interface TextField extends FieldBase {
    kind: 'text';
    max: number;
    default: Bilingual;
}

export interface TextareaField extends FieldBase {
    kind: 'textarea';
    max: number;
    default: Bilingual;
}

export interface RichTextField extends FieldBase {
    kind: 'richText';
    max: number;
    default: Bilingual;
}

export interface ImageField extends FieldBase {
    kind: 'image';
}

export interface ProductField extends FieldBase {
    kind: 'product';
}

export interface ProductListField extends FieldBase {
    kind: 'productList';
    max: number;
}

export interface CollectionField extends FieldBase {
    kind: 'collection';
}

export interface CollectionListField extends FieldBase {
    kind: 'collectionList';
    max: number;
}

export interface LinkField extends FieldBase {
    kind: 'link';
    default: LinkValue;
}

export interface ColourField extends FieldBase {
    kind: 'colour';
    default: PaletteColour;
}

export interface SelectOption<O extends string = string> {
    value: O;
    label: Bilingual;
}

export interface SelectField<O extends string = string> extends FieldBase {
    kind: 'select';
    options: ReadonlyArray<SelectOption<O>>;
    default: O;
}

export interface ToggleField extends FieldBase {
    kind: 'toggle';
    default: boolean;
}

export interface RangeField extends FieldBase {
    kind: 'range';
    min: number;
    max: number;
    step: number;
    default: number;
}

export interface VideoField extends FieldBase {
    kind: 'video';
}

/** Any colour (phase 16's Design options): a checked `#rrggbb`, or empty for "as the theme". */
export interface HexField extends FieldBase {
    kind: 'hex';
}

/** A size or amount that may be left automatic: a number within limits, or null. */
export interface SizeField extends FieldBase {
    kind: 'size';
    min: number;
    max: number;
    step: number;
    unit: 'px' | '%' | 'h';
}

/** A moment (a countdown's end), stored as an ISO date-time in UTC; entered in Dhaka time. */
export interface DateTimeField extends FieldBase {
    kind: 'datetime';
}

/** An amount of money in poisha, whole taka (prices in a custom section). */
export interface MoneyField extends FieldBase {
    kind: 'money';
}

export type Field =
    | TextField
    | TextareaField
    | RichTextField
    | ImageField
    | ProductField
    | ProductListField
    | CollectionField
    | CollectionListField
    | LinkField
    | ColourField
    | SelectField
    | ToggleField
    | RangeField
    | VideoField
    | HexField
    | SizeField
    | DateTimeField
    | MoneyField;

export type FieldKind = Field['kind'];
export type Fields = Readonly<Record<string, Field>>;

/** The value a field holds. */
export type FieldValue<F> = F extends { kind: 'text' | 'textarea' | 'richText' }
    ? Bilingual
    : F extends { kind: 'image' }
      ? ImageValue | null
      : F extends { kind: 'product' | 'collection' }
        ? string | null
        : F extends { kind: 'productList' | 'collectionList' }
          ? string[]
          : F extends { kind: 'link' }
            ? LinkValue
            : F extends { kind: 'colour' }
              ? PaletteColour
              : F extends SelectField<infer O>
                ? O
                : F extends { kind: 'toggle' }
                  ? boolean
                  : F extends { kind: 'range' }
                    ? number
                    : F extends { kind: 'video' | 'hex' | 'datetime' }
                      ? string
                      : F extends { kind: 'size' }
                        ? number | null
                        : F extends { kind: 'money' }
                          ? number | null
                          : never;

export type Values<Fs extends Fields> = { -readonly [K in keyof Fs]: FieldValue<Fs[K]> };

type Options<F> = Omit<F, 'kind' | 'label' | 'default'>;

/** Field builders, so section definitions read like a form. */
export const field = {
    text: (label: Bilingual, value: Bilingual = EMPTY_TEXT, options: Partial<Options<TextField>> = {}) =>
        ({ kind: 'text', label, default: value, max: 150, ...options }) as TextField,
    textarea: (
        label: Bilingual,
        value: Bilingual = EMPTY_TEXT,
        options: Partial<Options<TextareaField>> = {},
    ) => ({ kind: 'textarea', label, default: value, max: 600, ...options }) as TextareaField,
    richText: (
        label: Bilingual,
        value: Bilingual = EMPTY_TEXT,
        options: Partial<Options<RichTextField>> = {},
    ) => ({ kind: 'richText', label, default: value, max: 20_000, ...options }) as RichTextField,
    image: (label: Bilingual, options: Options<ImageField> = {}): ImageField => ({
        kind: 'image',
        label,
        ...options,
    }),
    product: (label: Bilingual, options: Options<ProductField> = {}): ProductField => ({
        kind: 'product',
        label,
        ...options,
    }),
    productList: (label: Bilingual, max: number, options: Omit<Options<ProductListField>, 'max'> = {}) =>
        ({ kind: 'productList', label, max, ...options }) as ProductListField,
    collection: (label: Bilingual, options: Options<CollectionField> = {}): CollectionField => ({
        kind: 'collection',
        label,
        ...options,
    }),
    collectionList: (
        label: Bilingual,
        max: number,
        options: Omit<Options<CollectionListField>, 'max'> = {},
    ) => ({ kind: 'collectionList', label, max, ...options }) as CollectionListField,
    link: (label: Bilingual, value: LinkValue = { type: 'none' }, options: Options<LinkField> = {}) =>
        ({ kind: 'link', label, default: value, ...options }) as LinkField,
    colour: (label: Bilingual, value: PaletteColour, options: Options<ColourField> = {}) =>
        ({ kind: 'colour', label, default: value, ...options }) as ColourField,
    select: <const O extends string>(
        label: Bilingual,
        options: ReadonlyArray<SelectOption<O>>,
        value: NoInfer<O>,
        extra: Omit<Options<SelectField<O>>, 'options'> = {},
    ): SelectField<O> => ({ kind: 'select', label, options, default: value, ...extra }),
    toggle: (label: Bilingual, value = false, options: Options<ToggleField> = {}): ToggleField => ({
        kind: 'toggle',
        label,
        default: value,
        ...options,
    }),
    range: (
        label: Bilingual,
        range: { min: number; max: number; step?: number },
        value: number,
        options: Omit<Options<RangeField>, 'min' | 'max' | 'step'> = {},
    ): RangeField => ({
        kind: 'range',
        label,
        min: range.min,
        max: range.max,
        step: range.step ?? 1,
        default: value,
        ...options,
    }),
    video: (label: Bilingual, options: Options<VideoField> = {}): VideoField => ({
        kind: 'video',
        label,
        ...options,
    }),
    hex: (label: Bilingual, options: Options<HexField> = {}): HexField => ({
        kind: 'hex',
        label,
        ...options,
    }),
    size: (
        label: Bilingual,
        range: { min: number; max: number; step?: number; unit?: SizeField['unit'] },
        options: Omit<Options<SizeField>, 'min' | 'max' | 'step' | 'unit'> = {},
    ): SizeField => ({
        kind: 'size',
        label,
        min: range.min,
        max: range.max,
        step: range.step ?? 1,
        unit: range.unit ?? 'px',
        ...options,
    }),
    datetime: (label: Bilingual, options: Options<DateTimeField> = {}): DateTimeField => ({
        kind: 'datetime',
        label,
        ...options,
    }),
    money: (label: Bilingual, options: Options<MoneyField> = {}): MoneyField => ({
        kind: 'money',
        label,
        ...options,
    }),
};

const ID = /^[\w-]{1,40}$/;
const ANCHOR = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_URL = 500;

function readId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
    return typeof value === 'string' && ID.test(value) ? value : null;
}

/** `line`: one line of text; `lines`: line breaks kept; `html`: rich text, sanitized elsewhere. */
type TextMode = 'line' | 'lines' | 'html';

function readText(value: unknown, max: number, mode: TextMode, fallback: Bilingual): Bilingual {
    // A field that held one plain string (an older shape) keeps it in both languages.
    if (typeof value === 'string') value = { bn: value, en: value };
    if (!isRecord(value)) return { ...fallback };
    const one = (text: unknown) => {
        if (typeof text !== 'string') return '';
        return (mode === 'html' ? text.trim() : cleanText(text, mode === 'lines')).slice(0, max).trim();
    };
    return { bn: one(value.bn), en: one(value.en) };
}

/** An anchor ID as typed (`Order Form` → `order-form`). */
export function toAnchor(input: string): string {
    return cleanText(input)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

export function isAnchor(value: string): boolean {
    return ANCHOR.test(value);
}

function readLink(value: unknown, fallback: LinkValue): LinkValue {
    if (!isRecord(value) || typeof value.type !== 'string') return { ...fallback };
    switch (value.type) {
        case 'none':
        case 'home':
        case 'search':
        case 'whatsapp':
        case 'call':
            return { type: value.type };
        case 'category':
        case 'product':
        case 'page': {
            const ref = readId(value.ref);
            return ref ? { type: value.type, ref } : { type: 'none' };
        }
        case 'policy':
            return (POLICY_KEYS as readonly unknown[]).includes(value.policy)
                ? { type: 'policy', policy: value.policy as PolicyKey }
                : { type: 'none' };
        case 'anchor':
            return { type: 'anchor', anchor: typeof value.anchor === 'string' ? toAnchor(value.anchor) : '' };
        case 'url':
            return {
                type: 'url',
                url: typeof value.url === 'string' ? value.url.trim().slice(0, MAX_URL) : '',
            };
        default:
            return { ...fallback };
    }
}

/** A path on this store (`/product-category/saree/`) or a full http(s) address. */
export function isLinkUrl(url: string): boolean {
    if (/^\/(?!\/)\S*$/.test(url)) return true;
    return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url) && URL.canParse(url);
}

function readNumber(value: unknown, field: RangeField): number {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return field.default;
    const stepped = Math.round((number - field.min) / field.step) * field.step + field.min;
    return Math.min(field.max, Math.max(field.min, stepped));
}

/** A stored value read back: the right shape, within limits; anything else becomes the default. */
export function readValue<F extends Field>(definition: F, value: unknown): FieldValue<F>;
export function readValue(definition: Field, value: unknown): unknown {
    switch (definition.kind) {
        case 'text':
            return readText(value, definition.max, 'line', definition.default);
        case 'textarea':
            return readText(value, definition.max, 'lines', definition.default);
        case 'richText':
            return readText(value, definition.max, 'html', definition.default);
        case 'image':
            return isRecord(value) && readId(value.assetId)
                ? {
                      assetId: readId(value.assetId)!,
                      preview: typeof value.preview === 'string' ? value.preview.slice(0, MAX_URL) : '',
                  }
                : null;
        case 'product':
        case 'collection':
            return readId(value);
        case 'productList':
        case 'collectionList':
            return Array.isArray(value)
                ? [...new Set(value.map(readId).filter((id): id is string => id !== null))].slice(
                      0,
                      definition.max,
                  )
                : [];
        case 'link':
            return readLink(value, definition.default);
        case 'colour':
            return (PALETTE_COLOURS as readonly unknown[]).includes(value) ? value : definition.default;
        case 'select':
            return definition.options.some(option => option.value === value) ? value : definition.default;
        case 'toggle':
            return typeof value === 'boolean' ? value : definition.default;
        case 'range':
            return readNumber(value, definition);
        case 'video':
            return typeof value === 'string' ? value.trim().slice(0, MAX_URL) : '';
        case 'hex':
            return value === '' || value === null || value === undefined ? '' : (normalizeHex(value) ?? '');
        case 'size':
            return readSize(value, definition);
        case 'datetime':
            return readDateTime(value);
        case 'money':
            return readMoney(value);
    }
}

/** A number within the field's limits, on its steps; null (automatic) for empty or nonsense. */
export function readSize(
    value: unknown,
    definition: { min: number; max: number; step: number },
): number | null {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return null;
    const stepped =
        Math.round((number - definition.min) / definition.step) * definition.step + definition.min;
    return Math.min(definition.max, Math.max(definition.min, Math.round(stepped * 100) / 100));
}

function readDateTime(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '';
    const time = Date.parse(value);
    return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

/** Poisha, rounded to whole taka, from 0 to ৳10 crore; null when empty. */
function readMoney(value: unknown): number | null {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return null;
    return Math.min(Math.round(number / 100) * 100, 1_000_000_000);
}

/** A fresh copy of a field's default. */
export function defaultValue<F extends Field>(definition: F): FieldValue<F>;
export function defaultValue(definition: Field): unknown {
    return readValue(definition, 'default' in definition ? definition.default : undefined);
}

export type FieldIssueCode = 'invalidUrl' | 'invalidAnchor' | 'invalidVideo';

/** What stops a value from being published. */
export function valueIssue(definition: Field, value: unknown): FieldIssueCode | null {
    if (definition.kind === 'link') {
        const link = value as LinkValue;
        if (link.type === 'url' && !isLinkUrl(link.url)) return 'invalidUrl';
        if (link.type === 'anchor' && !isAnchor(link.anchor)) return 'invalidAnchor';
    }
    if (definition.kind === 'video' && value !== '' && !parseVideo(value as string)) return 'invalidVideo';
    return null;
}

/** True when a condition (`when`) holds for these settings. */
export function fieldShown(definition: Field, settings: Record<string, unknown>): boolean {
    if (!definition.when) return true;
    return Object.entries(definition.when).every(([name, values]) =>
        values.includes(settings[name] as string | boolean),
    );
}

export interface Video {
    provider: 'youtube' | 'facebook';
    /** YouTube's 11-character ID, or Facebook's video URL. */
    id: string;
    /** For the frame, loaded only when the shopper presses play. */
    embedUrl: string;
    /** The page to open without JavaScript. */
    watchUrl: string;
    /** YouTube's own thumbnail; Facebook needs a poster image. */
    thumbnail?: string;
}

/** A YouTube or Facebook video address, in any of the usual spellings; null for anything else. */
export function parseVideo(input: string): Video | null {
    if (!URL.canParse(input.trim())) return null;
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.replace(/^(www|m)\./, '');
    let youtube: string | null = null;
    if (host === 'youtu.be') youtube = url.pathname.slice(1);
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        youtube =
            url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? null;
    }
    if (youtube !== null) {
        if (!/^[\w-]{11}$/.test(youtube)) return null;
        return {
            provider: 'youtube',
            id: youtube,
            embedUrl: `https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&rel=0`,
            watchUrl: `https://www.youtube.com/watch?v=${youtube}`,
            thumbnail: `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`,
        };
    }
    if (host === 'facebook.com' && /^\/(?:[^/]+\/videos\/|watch\/?$|reel\/)/.test(url.pathname)) {
        const watchUrl = `https://www.facebook.com${url.pathname}${url.searchParams.get('v') ? `?v=${url.searchParams.get('v')}` : ''}`;
        if (url.pathname.startsWith('/watch') && !/^\d+$/.test(url.searchParams.get('v') ?? '')) return null;
        return {
            provider: 'facebook',
            id: watchUrl,
            embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(watchUrl)}&show_text=false&autoplay=true`,
            watchUrl,
        };
    }
    return null;
}
