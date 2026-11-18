import { field, readValue, type Values } from './fields';
import { type Bilingual, isRecord } from './text';

/**
 * The look of one node of a page's element tree (roadmap phase 56): a set of values for computers
 * (`base`) and, when they differ, for tablets and phones. Only what the merchant set is stored;
 * anything else follows the theme. Every value is checked when read (hex colours, numbers within
 * limits, fixed choices), so the stylesheet made from them (css.ts) can't carry anything else.
 */

const label = (en: string, bn: string): Bilingual => ({ bn, en });

/** `base` is the computer's look; tablets and phones override it. */
export const DEVICES = ['base', 'tablet', 'phone'] as const;
export type Device = (typeof DEVICES)[number];

/**
 * The widest tablet and the widest phone, in pixels. They match the theme's own stylesheet
 * (which changes at 750 and 990), so a node and the section around it change together.
 */
export const BREAKPOINTS = { tablet: 989, phone: 749 } as const;

export const NODE_STYLE_FIELDS = {
    color: field.hex(label('Colour', 'রং')),
    background: field.hex(label('Background', 'ব্যাকগ্রাউন্ড')),
    fontSize: field.size(label('Size', 'মাপ'), { min: 10, max: 120 }),
    fontWeight: field.select(
        label('Weight', 'মোটা-চিকন'),
        [
            { value: '', label: label('Default', 'স্বাভাবিক') },
            { value: '300', label: label('Light', 'চিকন') },
            { value: '400', label: label('Regular', 'সাধারণ') },
            { value: '500', label: label('Medium', 'মাঝারি') },
            { value: '600', label: label('Semi-bold', 'একটু মোটা') },
            { value: '700', label: label('Bold', 'মোটা') },
            { value: '800', label: label('Extra bold', 'খুব মোটা') },
            { value: '900', label: label('Black', 'সবচেয়ে মোটা') },
        ],
        '',
    ),
    textAlign: field.select(
        label('Alignment', 'অবস্থান'),
        [
            { value: '', label: label('As the section', 'সেকশন অনুযায়ী') },
            { value: 'start', label: label('Left', 'বাঁয়ে') },
            { value: 'center', label: label('Centre', 'মাঝে') },
            { value: 'end', label: label('Right', 'ডানে') },
        ],
        '',
    ),
    width: field.size(label('Width', 'চওড়া'), { min: 10, max: 100, step: 5, unit: '%' }),
    padding: field.size(label('Inner space', 'ভেতরের ফাঁকা'), { min: 0, max: 80, step: 2 }),
    radius: field.size(label('Corners', 'কোনা'), { min: 0, max: 40 }),
    borderWidth: field.size(label('Border', 'বর্ডার'), { min: 0, max: 8 }),
    borderColor: field.hex(label('Border colour', 'বর্ডারের রং')),
    marginBottom: field.size(label('Space below', 'নিচে ফাঁকা'), { min: 0, max: 160, step: 4 }),
} as const;

export type NodeStyleProp = keyof typeof NODE_STYLE_FIELDS;
export const NODE_STYLE_PROPS = Object.keys(NODE_STYLE_FIELDS) as NodeStyleProp[];

/** What one device sets. A property that isn't here follows the wider device, then the theme. */
export type NodeStyleValues = Partial<Values<typeof NODE_STYLE_FIELDS>>;

export interface NodeStyle {
    base: NodeStyleValues;
    tablet?: NodeStyleValues;
    phone?: NodeStyleValues;
}

const isSet = (value: unknown) => value !== '' && value !== null && value !== undefined;

function readValues(raw: unknown): NodeStyleValues {
    if (!isRecord(raw)) return {};
    const values: Record<string, unknown> = {};
    for (const name of NODE_STYLE_PROPS) {
        const value = readValue(NODE_STYLE_FIELDS[name], raw[name]);
        if (isSet(value)) values[name] = value;
    }
    return values as NodeStyleValues;
}

/** A stored node style read back: known properties with checked values, empty devices left out. */
export function readNodeStyle(raw: unknown): NodeStyle {
    const source = isRecord(raw) ? raw : {};
    const style: NodeStyle = { base: readValues(source.base) };
    for (const device of ['tablet', 'phone'] as const) {
        const values = readValues(source[device]);
        if (Object.keys(values).length) style[device] = values;
    }
    return style;
}

/** How many properties a device sets itself (the editor shows the count beside each device). */
export function styleCount(style: NodeStyle, device: Device): number {
    return Object.keys(style[device] ?? {}).length;
}

/** A style with one property set (or cleared, for an empty value) on one device. */
export function withStyleValue(
    style: NodeStyle,
    device: Device,
    name: NodeStyleProp,
    value: unknown,
): NodeStyle {
    const values: Record<string, unknown> = { ...style[device] };
    if (isSet(value)) values[name] = value;
    else delete values[name];
    const next: NodeStyle = { ...style, [device]: values };
    if (device !== 'base' && !Object.keys(values).length) delete next[device];
    return next;
}

/** What a device ends up with: its own values over the wider devices'. */
export function effectiveStyle(style: NodeStyle, device: Device): NodeStyleValues {
    if (device === 'base') return style.base;
    if (device === 'tablet') return { ...style.base, ...style.tablet };
    return { ...style.base, ...style.tablet, ...style.phone };
}
