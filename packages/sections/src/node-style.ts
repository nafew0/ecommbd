import { field, type Field, readValue, type Values } from './fields';
import { type Bilingual, isRecord } from './text';

/**
 * The look of one node of a page's element tree (roadmap phases 56 and 57): a set of values for
 * computers (`base`) and, when they differ, for tablets and phones. Only what the merchant set is
 * stored; anything else follows the theme. Every value is checked when read (hex colours, numbers
 * within limits, fixed choices), so the stylesheet made from them (css.ts) can't carry anything
 * else.
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

/** Type families an element can use. Each one's stack ends in fonts that have Bangla letters. */
export const NODE_FONTS = {
    system: "system-ui,-apple-system,'Segoe UI','Noto Sans Bengali','Noto Sans',Roboto,sans-serif",
    'hind-siliguri': "'Hind Siliguri',system-ui,-apple-system,'Segoe UI',sans-serif",
    'noto-serif-bengali': "'Noto Serif Bengali',Georgia,'Times New Roman',serif",
    serif: "Georgia,'Times New Roman','Noto Serif Bengali',serif",
    mono: "ui-monospace,'Courier New','Hind Siliguri',monospace",
} as const;
export type NodeFont = keyof typeof NODE_FONTS;

/** Shadows, from barely there to deep. */
export const NODE_SHADOWS = {
    none: 'none',
    s: '0 1px 2px rgb(0 0 0/.08)',
    m: '0 4px 12px rgb(0 0 0/.1)',
    l: '0 10px 30px rgb(0 0 0/.12)',
    xl: '0 20px 50px rgb(0 0 0/.16)',
} as const;

/** Where an image sits in its frame, and the CSS for each place. */
export const FOCUS_POINTS = {
    'top-left': 'left top',
    top: 'center top',
    'top-right': 'right top',
    left: 'left center',
    center: 'center',
    right: 'right center',
    'bottom-left': 'left bottom',
    bottom: 'center bottom',
    'bottom-right': 'right bottom',
} as const;

const asTheme = { value: '', label: label('As the theme', 'থিম অনুযায়ী') } as const;
const side = (en: string, bn: string, max = 200) => field.size(label(en, bn), { min: 0, max, step: 2 });

export const NODE_STYLE_FIELDS = {
    // Typography
    color: field.hex(label('Text colour', 'লেখার রং')),
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
    lineHeight: field.size(label('Line height', 'লাইনের উচ্চতা'), {
        min: 0.8,
        max: 3,
        step: 0.05,
        unit: 'x',
    }),
    letterSpacing: field.size(label('Letter spacing', 'অক্ষরের ফাঁকা'), { min: -2, max: 12, step: 0.5 }),
    fontFamily: field.select(
        label('Font', 'ফন্ট'),
        [
            asTheme,
            { value: 'hind-siliguri', label: label('Hind Siliguri', 'হিন্দ শিলিগুড়ি') },
            { value: 'noto-serif-bengali', label: label('Noto Serif Bengali', 'নোটো সেরিফ বাংলা') },
            { value: 'system', label: label("The phone's own font", 'ফোনের নিজের ফন্ট') },
            { value: 'serif', label: label('Serif (Georgia)', 'সেরিফ (Georgia)') },
            { value: 'mono', label: label('Typewriter', 'টাইপরাইটার') },
        ],
        '',
    ),
    textTransform: field.select(
        label('Letter case', 'বড়-ছোট হাতের অক্ষর'),
        [
            { value: '', label: label('As typed', 'যেমন লেখা') },
            { value: 'uppercase', label: label('ALL CAPITALS', 'সব বড় হাতের') },
            { value: 'lowercase', label: label('all small', 'সব ছোট হাতের') },
            { value: 'capitalize', label: label('Each Word', 'প্রতি শব্দের শুরু বড়') },
        ],
        '',
        { hint: label('English letters only', 'শুধু ইংরেজি অক্ষরে') },
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
    // Image
    aspect: field.select(
        label('Shape', 'আকৃতি'),
        [
            { value: '', label: label('As the photo', 'ছবির নিজের মাপ') },
            { value: '1/1', label: label('Square', 'বর্গাকার') },
            { value: '4/3', label: label('Landscape', 'আড়াআড়ি') },
            { value: '3/4', label: label('Portrait', 'খাড়া') },
            { value: '16/9', label: label('Wide', 'চওড়া') },
        ],
        '',
    ),
    objectFit: field.select(
        label('Fit', 'ফ্রেমে বসানো'),
        [
            { value: '', label: label('Default', 'স্বাভাবিক') },
            { value: 'cover', label: label('Fill the frame', 'ফ্রেম ভরে') },
            { value: 'contain', label: label('Show it all', 'পুরোটা দেখিয়ে') },
            { value: 'fill', label: label('Stretch', 'টেনে') },
            { value: 'none', label: label('Original size', 'আসল মাপে') },
            { value: 'scale-down', label: label('Shrink to fit', 'ছোট করে') },
        ],
        '',
    ),
    objectPosition: field.select(
        label('Focus', 'ফোকাস'),
        [
            { value: '', label: label('Centre', 'মাঝে') },
            { value: 'top-left', label: label('Top left', 'ওপরে বাঁয়ে') },
            { value: 'top', label: label('Top', 'ওপরে') },
            { value: 'top-right', label: label('Top right', 'ওপরে ডানে') },
            { value: 'left', label: label('Left', 'বাঁয়ে') },
            { value: 'center', label: label('Centre', 'মাঝে') },
            { value: 'right', label: label('Right', 'ডানে') },
            { value: 'bottom-left', label: label('Bottom left', 'নিচে বাঁয়ে') },
            { value: 'bottom', label: label('Bottom', 'নিচে') },
            { value: 'bottom-right', label: label('Bottom right', 'নিচে ডানে') },
        ],
        '',
    ),
    // Spacing
    padding: field.size(label('Inner space, all sides', 'ভেতরের ফাঁকা, সব দিকে'), {
        min: 0,
        max: 200,
        step: 2,
    }),
    paddingTop: side('Inner space above', 'ভেতরে ওপরে'),
    paddingRight: side('Inner space right', 'ভেতরে ডানে'),
    paddingBottom: side('Inner space below', 'ভেতরে নিচে'),
    paddingLeft: side('Inner space left', 'ভেতরে বাঁয়ে'),
    marginTop: side('Space above', 'ওপরে ফাঁকা'),
    marginRight: side('Space right', 'ডানে ফাঁকা'),
    marginBottom: side('Space below', 'নিচে ফাঁকা'),
    marginLeft: side('Space left', 'বাঁয়ে ফাঁকা'),
    maxWidth: field.size(label('Content width', 'কনটেন্টের চওড়া'), { min: 120, max: 1600, step: 20 }),
    minHeight: field.size(label('Minimum height', 'কমপক্ষে উচ্চতা'), { min: 0, max: 1000, step: 10 }),
    // Background
    background: field.hex(label('Background colour', 'ব্যাকগ্রাউন্ডের রং')),
    gradientTo: field.hex(label('Blend into', 'যে রঙে মিশবে'), {
        hint: label(
            'A second colour makes a gradient from the background colour',
            'দ্বিতীয় রং দিলে ব্যাকগ্রাউন্ডের রং থেকে গ্রেডিয়েন্ট হয়',
        ),
    }),
    gradientAngle: field.size(label('Blend direction', 'মেশার দিক'), {
        min: 0,
        max: 345,
        step: 15,
        unit: '°',
    }),
    // Border
    borderWidth: field.size(label('Border', 'বর্ডার'), { min: 0, max: 12 }),
    borderStyle: field.select(
        label('Border style', 'বর্ডারের ধরন'),
        [
            { value: '', label: label('Solid', 'টানা') },
            { value: 'dashed', label: label('Dashed', 'ভাঙা ভাঙা') },
            { value: 'dotted', label: label('Dotted', 'ফোঁটা ফোঁটা') },
        ],
        '',
    ),
    borderColor: field.hex(label('Border colour', 'বর্ডারের রং')),
    radius: field.size(label('Corners', 'কোনা'), { min: 0, max: 80 }),
    shadow: field.select(
        label('Shadow', 'ছায়া'),
        [
            { value: '', label: label('As the theme', 'থিম অনুযায়ী') },
            { value: 'none', label: label('None', 'নেই') },
            { value: 's', label: label('Small', 'ছোট') },
            { value: 'm', label: label('Medium', 'মাঝারি') },
            { value: 'l', label: label('Large', 'বড়') },
            { value: 'xl', label: label('Extra large', 'খুব বড়') },
        ],
        '',
    ),
    opacity: field.size(label('Opacity', 'স্বচ্ছতা'), { min: 0, max: 100, step: 5, unit: '%' }),
    // Sizing
    width: field.size(label('Width', 'চওড়া'), { min: 10, max: 100, step: 5, unit: '%' }),
    alignSelf: field.select(
        label('Place in its container', 'কনটেইনারে অবস্থান'),
        [
            { value: '', label: label('As the container', 'কনটেইনার অনুযায়ী') },
            { value: 'start', label: label('Start', 'শুরুতে') },
            { value: 'center', label: label('Middle', 'মাঝে') },
            { value: 'end', label: label('End', 'শেষে') },
            { value: 'stretch', label: label('Stretch', 'টেনে') },
        ],
        '',
    ),
    flexGrow: field.size(
        label('Share of spare room', 'বাড়তি জায়গার ভাগ'),
        { min: 0, max: 10 },
        {
            hint: label(
                'In a row: 2 takes twice the spare room of 1',
                'সারিতে: ২ দিলে ১-এর দ্বিগুণ বাড়তি জায়গা নেয়',
            ),
        },
    ),
    // Button
    buttonBg: field.hex(label('Button colour', 'বাটনের রং')),
    buttonText: field.hex(label('Button text', 'বাটনের লেখা')),
    buttonBorder: field.hex(label('Button border', 'বাটনের বর্ডার')),
    buttonHoverBg: field.hex(label('Colour when pointed at', 'কার্সর রাখলে রং')),
    buttonHoverText: field.hex(label('Text when pointed at', 'কার্সর রাখলে লেখা')),
    buttonPaddingX: field.size(label('Space at the sides', 'দুই পাশে ফাঁকা'), { min: 0, max: 80, step: 2 }),
    buttonPaddingY: field.size(label('Space above and below', 'ওপরে-নিচে ফাঁকা'), {
        min: 0,
        max: 40,
        step: 2,
    }),
} as const satisfies Record<string, Field>;

export type NodeStyleProp = keyof typeof NODE_STYLE_FIELDS;
export const NODE_STYLE_PROPS = Object.keys(NODE_STYLE_FIELDS) as NodeStyleProp[];

/** What one device sets. A property that isn't here follows the wider device, then the theme. */
export type NodeStyleValues = Partial<Values<typeof NODE_STYLE_FIELDS>>;

export interface NodeStyle {
    base: NodeStyleValues;
    tablet?: NodeStyleValues;
    phone?: NodeStyleValues;
}

/** How the editor's Design tab groups the properties. */
export const STYLE_GROUPS = [
    {
        key: 'typography',
        label: label('Text', 'লেখা'),
        props: [
            'color',
            'fontSize',
            'fontWeight',
            'textAlign',
            'lineHeight',
            'letterSpacing',
            'fontFamily',
            'textTransform',
        ],
    },
    {
        key: 'button',
        label: label('Button', 'বাটন'),
        props: [
            'buttonBg',
            'buttonText',
            'buttonBorder',
            'buttonHoverBg',
            'buttonHoverText',
            'buttonPaddingX',
            'buttonPaddingY',
        ],
    },
    { key: 'image', label: label('Image', 'ছবি'), props: ['aspect', 'objectFit', 'objectPosition'] },
    {
        key: 'spacing',
        label: label('Spacing', 'ফাঁকা জায়গা'),
        props: [
            'padding',
            'paddingTop',
            'paddingRight',
            'paddingBottom',
            'paddingLeft',
            'marginTop',
            'marginRight',
            'marginBottom',
            'marginLeft',
            'maxWidth',
            'minHeight',
        ],
    },
    {
        key: 'background',
        label: label('Background', 'ব্যাকগ্রাউন্ড'),
        props: ['background', 'gradientTo', 'gradientAngle'],
    },
    {
        key: 'border',
        label: label('Border and shadow', 'বর্ডার ও ছায়া'),
        props: ['borderWidth', 'borderStyle', 'borderColor', 'radius', 'shadow', 'opacity'],
    },
    {
        key: 'sizing',
        label: label('Size and place', 'মাপ ও অবস্থান'),
        props: ['width', 'alignSelf', 'flexGrow'],
    },
] as const satisfies ReadonlyArray<{ key: string; label: Bilingual; props: readonly NodeStyleProp[] }>;

export type StyleGroupKey = (typeof STYLE_GROUPS)[number]['key'];

const BOX: StyleGroupKey[] = ['spacing', 'background', 'border', 'sizing'];
const TEXT: StyleGroupKey[] = ['typography', ...BOX];

/** The groups that mean something for each kind of node, in the order the editor shows them. */
const ELEMENT_GROUPS: Record<string, StyleGroupKey[]> = {
    container: ['spacing', 'background', 'border', 'sizing', 'typography'],
    button: ['button', ...TEXT],
    image: ['image', ...BOX],
    video: BOX,
    live: BOX,
    icon: ['typography', 'spacing', 'sizing'],
    divider: ['spacing', 'sizing'],
    spacer: [],
};

/** Typography properties that mean nothing for a few elements (an icon has a colour, no font). */
const SKIP: Record<string, NodeStyleProp[]> = {
    icon: ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontFamily', 'textTransform'],
    container: ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform'],
};

/** The style groups and properties the editor offers for a kind of node. */
export function styleGroupsFor(
    type: string,
): Array<{ key: StyleGroupKey; label: Bilingual; props: NodeStyleProp[] }> {
    const keys = ELEMENT_GROUPS[type] ?? TEXT;
    const skip = SKIP[type] ?? [];
    return keys.map(key => {
        const group = STYLE_GROUPS.find(item => item.key === key)!;
        return {
            key,
            label: group.label,
            props: (group.props as readonly NodeStyleProp[]).filter(name => !skip.includes(name)),
        };
    });
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

/** A style with everything one device sets cleared: it follows the wider device again. */
export function withoutDevice(style: NodeStyle, device: Device): NodeStyle {
    if (device === 'base') return { ...style, base: {} };
    const next = { ...style };
    delete next[device];
    return next;
}

/** What a device ends up with: its own values over the wider devices'. */
export function effectiveStyle(style: NodeStyle, device: Device): NodeStyleValues {
    if (device === 'base') return style.base;
    if (device === 'tablet') return { ...style.base, ...style.tablet };
    return { ...style.base, ...style.tablet, ...style.phone };
}

/**
 * Where an unset property's value comes from on a device: the wider device that sets it, or
 * null when nothing does (it follows the theme).
 */
export function inheritedFrom(style: NodeStyle, device: Device, name: NodeStyleProp): Device | null {
    if (device === 'phone' && isSet(style.tablet?.[name])) return 'tablet';
    if (device !== 'base' && isSet(style.base[name])) return 'base';
    return null;
}

/**
 * A copied look pasted onto a node of some kind: only the properties that kind of node has
 * (a button's colours mean nothing on an image), read again so nothing unchecked comes through.
 */
export function pasteStyle(copied: unknown, type: string): NodeStyle {
    const allowed = new Set(styleGroupsFor(type).flatMap(group => group.props));
    const style = readNodeStyle(copied);
    const keep = (values: NodeStyleValues | undefined) =>
        Object.fromEntries(
            Object.entries(values ?? {}).filter(([name]) => allowed.has(name as NodeStyleProp)),
        );
    const next: NodeStyle = { base: keep(style.base) };
    for (const device of ['tablet', 'phone'] as const) {
        const values = keep(style[device]);
        if (Object.keys(values).length) next[device] = values;
    }
    return next;
}
