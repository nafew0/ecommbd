import { type ImageValue, readValue, toAnchor } from './fields';
import { type Bilingual, isRecord } from './text';

/**
 * Style options every section has (roadmap phase 15), deliberately few and preset: no per-screen
 * settings except hiding, no raw sizes or colours.
 */
export interface SectionStyle {
    /** `none` is the page's background; the others come from the theme's palette, or an image. */
    background: 'none' | 'subtle' | 'accent' | 'dark' | 'image';
    backgroundImage: ImageValue | null;
    /** `auto` picks what reads on the background. */
    text: 'auto' | 'dark' | 'light';
    spacing: 's' | 'm' | 'l';
    width: 'narrow' | 'normal' | 'full';
    align: 'start' | 'center';
    hideOn: 'none' | 'phone' | 'desktop';
    /** For buttons that jump to this section (`#order-form`). Empty for none. */
    anchor: string;
    /** One entrance animation, CSS only, off for visitors who prefer reduced motion. */
    animate: boolean;
}

type Choice<K extends keyof SectionStyle> = ReadonlyArray<{ value: SectionStyle[K]; label: Bilingual }>;

export const STYLE_CHOICES: {
    background: Choice<'background'>;
    text: Choice<'text'>;
    spacing: Choice<'spacing'>;
    width: Choice<'width'>;
    align: Choice<'align'>;
    hideOn: Choice<'hideOn'>;
} = {
    background: [
        { value: 'none', label: { bn: 'পেজের রং', en: 'Page colour' } },
        { value: 'subtle', label: { bn: 'হালকা', en: 'Subtle' } },
        { value: 'accent', label: { bn: 'ব্র্যান্ডের রং', en: 'Brand colour' } },
        { value: 'dark', label: { bn: 'গাঢ়', en: 'Dark' } },
        { value: 'image', label: { bn: 'ছবি', en: 'Image' } },
    ],
    text: [
        { value: 'auto', label: { bn: 'নিজে থেকে', en: 'Automatic' } },
        { value: 'dark', label: { bn: 'গাঢ় লেখা', en: 'Dark text' } },
        { value: 'light', label: { bn: 'হালকা লেখা', en: 'Light text' } },
    ],
    spacing: [
        { value: 's', label: { bn: 'কম', en: 'S' } },
        { value: 'm', label: { bn: 'মাঝারি', en: 'M' } },
        { value: 'l', label: { bn: 'বেশি', en: 'L' } },
    ],
    width: [
        { value: 'narrow', label: { bn: 'সরু', en: 'Narrow' } },
        { value: 'normal', label: { bn: 'স্বাভাবিক', en: 'Normal' } },
        { value: 'full', label: { bn: 'পুরো চওড়া', en: 'Full width' } },
    ],
    align: [
        { value: 'start', label: { bn: 'বাঁয়ে', en: 'Left' } },
        { value: 'center', label: { bn: 'মাঝে', en: 'Centre' } },
    ],
    hideOn: [
        { value: 'none', label: { bn: 'সব স্ক্রিনে দেখান', en: 'Show everywhere' } },
        { value: 'phone', label: { bn: 'ফোনে লুকান', en: 'Hide on phones' } },
        { value: 'desktop', label: { bn: 'কম্পিউটারে লুকান', en: 'Hide on computers' } },
    ],
};

export const DEFAULT_STYLE: Readonly<SectionStyle> = Object.freeze({
    background: 'none',
    backgroundImage: null,
    text: 'auto',
    spacing: 'm',
    width: 'normal',
    align: 'start',
    hideOn: 'none',
    anchor: '',
    animate: false,
});

function choose<K extends keyof typeof STYLE_CHOICES>(key: K, value: unknown, fallback: SectionStyle[K]) {
    return STYLE_CHOICES[key].some(choice => choice.value === value) ? (value as SectionStyle[K]) : fallback;
}

/** A stored style read back; anything missing or wrong takes the section's default. */
export function readStyle(value: unknown, defaults: Partial<SectionStyle> = {}): SectionStyle {
    const base: SectionStyle = { ...DEFAULT_STYLE, ...defaults };
    if (!isRecord(value)) return base;
    const backgroundImage = readValue({ kind: 'image', label: { bn: '', en: '' } }, value.backgroundImage);
    let background = choose('background', value.background, base.background);
    // An image background without an image is the page's own.
    if (background === 'image' && !backgroundImage) background = 'none';
    return {
        background,
        backgroundImage,
        text: choose('text', value.text, base.text),
        spacing: choose('spacing', value.spacing, base.spacing),
        width: choose('width', value.width, base.width),
        align: choose('align', value.align, base.align),
        hideOn: choose('hideOn', value.hideOn, base.hideOn),
        anchor: typeof value.anchor === 'string' ? toAnchor(value.anchor) : base.anchor,
        animate: typeof value.animate === 'boolean' ? value.animate : base.animate,
    };
}
