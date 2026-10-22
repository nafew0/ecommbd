import { field, type SelectOption } from '../fields';
import type { Bilingual } from '../text';

/** Labels and fields many sections share. */
export const L = {
    heading: { bn: 'শিরোনাম', en: 'Heading' },
    subheading: { bn: 'ছোট লেখা', en: 'Text' },
    text: { bn: 'লেখা', en: 'Text' },
    image: { bn: 'ছবি', en: 'Image' },
    phoneImage: { bn: 'ফোনের ছবি (ঐচ্ছিক)', en: 'Phone image (optional)' },
    buttonLabel: { bn: 'বাটনের লেখা', en: 'Button label' },
    buttonLink: { bn: 'বাটনের লিংক', en: 'Button link' },
    link: { bn: 'লিংক', en: 'Link' },
    columns: { bn: 'কম্পিউটারে কলাম', en: 'Columns on computers' },
    title: { bn: 'শিরোনাম', en: 'Title' },
} satisfies Record<string, Bilingual>;

export const heading = (value?: Bilingual) => field.text(L.heading, value, { max: 120 });

export const text = (value?: Bilingual) => field.textarea(L.subheading, value, { max: 400 });

export const buttonLabel = (value?: Bilingual) => field.text(L.buttonLabel, value, { max: 40 });

/** Our own icons on the storefront (Icon.astro), for trust badges and columns. */
export const ICONS = [
    'cash',
    'truck',
    'return',
    'shield',
    'check',
    'phone',
    'chat',
    'star',
    'leaf',
    'gift',
    'clock',
    'tag',
    'box',
    'lock',
] as const;
export type IconName = (typeof ICONS)[number];

const ICON_LABELS: Record<IconName, Bilingual> = {
    cash: { bn: 'টাকা', en: 'Cash' },
    truck: { bn: 'ডেলিভারি', en: 'Delivery' },
    return: { bn: 'ফেরত', en: 'Return' },
    shield: { bn: 'সুরক্ষা', en: 'Shield' },
    check: { bn: 'টিক চিহ্ন', en: 'Tick' },
    phone: { bn: 'ফোন', en: 'Phone' },
    chat: { bn: 'চ্যাট', en: 'Chat' },
    star: { bn: 'তারা', en: 'Star' },
    leaf: { bn: 'পাতা', en: 'Leaf' },
    gift: { bn: 'উপহার', en: 'Gift' },
    clock: { bn: 'ঘড়ি', en: 'Clock' },
    tag: { bn: 'ট্যাগ', en: 'Tag' },
    box: { bn: 'বাক্স', en: 'Box' },
    lock: { bn: 'তালা', en: 'Lock' },
};

export const ICON_OPTIONS: ReadonlyArray<SelectOption<IconName>> = ICONS.map(value => ({
    value,
    label: ICON_LABELS[value],
}));

export const sizeOptions = [
    { value: 's', label: { bn: 'ছোট', en: 'Small' } },
    { value: 'm', label: { bn: 'মাঝারি', en: 'Medium' } },
    { value: 'l', label: { bn: 'বড়', en: 'Large' } },
] as const;
