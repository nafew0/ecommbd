import { field, type ImageValue, readValue, toAnchor, type Values } from './fields';
import { type Bilingual, isRecord } from './text';

/**
 * Style options every section has. Phase 15's presets (background from the palette, spacing S/M/L,
 * width, alignment, hiding, anchor, fade-in) cover most pages; phase 16's **Design** options
 * (`design`) let a merchant set any colour, padding, width, corners, border and type size, as in
 * Elementor. Every design value is checked when read (hex colours, numbers within limits), so the
 * stylesheet made from them (css.ts) can't carry anything else.
 */

const label = (en: string, bn: string): Bilingual => ({ bn, en });

/** The Design tab's fields; empty means "as the theme and the presets say". */
export const DESIGN_FIELDS = {
    background: field.hex(label('Background colour', 'ব্যাকগ্রাউন্ডের রং')),
    text: field.hex(label('Text colour', 'লেখার রং')),
    button: field.hex(label('Button colour', 'বাটনের রং'), {
        hint: label(
            'The text on buttons is chosen to stay readable',
            'বাটনের লেখার রং পড়ার মতো করে নিজেই বাছা হয়',
        ),
    }),
    paddingTop: field.size(label('Space above', 'ওপরে ফাঁকা'), { min: 0, max: 200, step: 4 }),
    paddingBottom: field.size(label('Space below', 'নিচে ফাঁকা'), { min: 0, max: 200, step: 4 }),
    paddingTopPhone: field.size(label('Space above on phones', 'ফোনে ওপরে ফাঁকা'), {
        min: 0,
        max: 160,
        step: 4,
    }),
    paddingBottomPhone: field.size(label('Space below on phones', 'ফোনে নিচে ফাঁকা'), {
        min: 0,
        max: 160,
        step: 4,
    }),
    width: field.size(label('Content width', 'কনটেন্টের চওড়া'), { min: 320, max: 1600, step: 20 }),
    radius: field.size(label('Corners', 'কোনা'), { min: 0, max: 24 }),
    borderWidth: field.size(label('Border', 'বর্ডার'), { min: 0, max: 8 }),
    borderColor: field.hex(label('Border colour', 'বর্ডারের রং')),
    headingSize: field.size(label('Heading size', 'শিরোনামের মাপ'), { min: 16, max: 96 }),
    headingSizePhone: field.size(label('Heading size on phones', 'ফোনে শিরোনামের মাপ'), { min: 14, max: 64 }),
    headingWeight: field.select(
        label('Heading weight', 'শিরোনামের মোটা-চিকন'),
        [
            { value: '', label: label('As the theme', 'থিম অনুযায়ী') },
            { value: '400', label: label('Regular', 'সাধারণ') },
            { value: '600', label: label('Semi-bold', 'একটু মোটা') },
            { value: '700', label: label('Bold', 'মোটা') },
            { value: '800', label: label('Extra bold', 'খুব মোটা') },
        ],
        '',
    ),
    textSize: field.size(label('Text size', 'লেখার মাপ'), { min: 12, max: 28 }),
    shade: field.size(label('Image shade', 'ছবির ওপর ছায়া'), { min: 0, max: 90, step: 5, unit: '%' }),
} as const;

export type SectionDesign = Values<typeof DESIGN_FIELDS>;

/** How the editor groups the Design tab. */
export const DESIGN_GROUPS: ReadonlyArray<{ label: Bilingual; fields: ReadonlyArray<keyof SectionDesign> }> =
    [
        { label: label('Colours', 'রং'), fields: ['background', 'text', 'button'] },
        {
            label: label('Spacing and width', 'ফাঁকা জায়গা ও চওড়া'),
            fields: ['paddingTop', 'paddingBottom', 'paddingTopPhone', 'paddingBottomPhone', 'width'],
        },
        {
            label: label('Corners and border', 'কোনা ও বর্ডার'),
            fields: ['radius', 'borderWidth', 'borderColor'],
        },
        {
            label: label('Text', 'লেখা'),
            fields: ['headingSize', 'headingSizePhone', 'headingWeight', 'textSize'],
        },
        { label: label('Background image', 'ব্যাকগ্রাউন্ডের ছবি'), fields: ['shade'] },
    ];

export function readDesign(value: unknown): SectionDesign {
    const raw = isRecord(value) ? value : {};
    return Object.fromEntries(
        Object.entries(DESIGN_FIELDS).map(([name, definition]) => [name, readValue(definition, raw[name])]),
    ) as SectionDesign;
}

/** True when any Design option is set (the section then needs generated CSS). */
export function hasDesign(design: SectionDesign): boolean {
    return Object.values(design).some(value => value !== '' && value !== null);
}
export interface SectionStyle {
    /** `none` is the page's background; the others come from the theme's palette, or an image. */
    background: 'none' | 'subtle' | 'accent' | 'dark' | 'image';
    backgroundImage: ImageValue | null;
    /** `auto` picks what reads on the background. */
    text: 'auto' | 'dark' | 'light';
    spacing: 's' | 'm' | 'l';
    width: 'narrow' | 'normal' | 'full';
    align: 'start' | 'center' | 'end';
    hideOn: 'none' | 'phone' | 'desktop';
    /** For buttons that jump to this section (`#order-form`). Empty for none. */
    anchor: string;
    /** One entrance animation, CSS only, off for visitors who prefer reduced motion. */
    animate: boolean;
    /** Sales pages (phase 16): an "Order now" button below the section, jumping to the order form. */
    orderButton: boolean;
    /** Any colour, padding, width, corners, border and type size (phase 16). */
    design: SectionDesign;
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
        { value: 'end', label: { bn: 'ডানে', en: 'Right' } },
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
    orderButton: false,
    design: Object.freeze(readDesign({})) as SectionDesign,
});

function choose<K extends keyof typeof STYLE_CHOICES>(key: K, value: unknown, fallback: SectionStyle[K]) {
    return STYLE_CHOICES[key].some(choice => choice.value === value) ? (value as SectionStyle[K]) : fallback;
}

/** A stored style read back; anything missing or wrong takes the section's default. */
export function readStyle(value: unknown, defaults: Partial<SectionStyle> = {}): SectionStyle {
    const base: SectionStyle = { ...DEFAULT_STYLE, design: readDesign(defaults.design), ...defaults };
    if (!isRecord(value)) return { ...base, design: readDesign(base.design) };
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
        orderButton: typeof value.orderButton === 'boolean' ? value.orderButton : base.orderButton,
        design: readDesign(isRecord(value.design) ? value.design : base.design),
    };
}
