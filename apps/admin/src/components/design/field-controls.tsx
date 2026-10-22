import {
    type Bilingual,
    type Field,
    type ImageValue,
    isLinkUrl,
    LINK_TYPES,
    type LinkValue,
    type LayoutDocument,
    PALETTE_COLOURS,
    parseVideo,
    POLICY_KEYS,
} from '@ecommbd/sections';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CircleCheck, CircleX, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { ImageUpload } from '../form/image-upload';
import { RichTextEditor } from '../form/rich-text-editor';
import { Button } from '../ui/button';
import { IconButton } from './icon-button';
import { Input, Select, Textarea } from '../ui/input';
import { Switch } from '../ui/switch';
import { fetchPages } from './design-api';
import { anchorsOf } from './document-ops';
import {
    CollectionPickerDialog,
    collectionLabel,
    ProductPickerDialog,
    ProductThumb,
    useCollections,
    useProducts,
} from './pickers';

/**
 * One form control per field type (roadmap phase 15), generated from the section's schema. Text
 * fields edit the language chosen in the editor's toolbar; when it's empty, the other language's
 * text shows as a hint, since that's what shoppers see.
 */

export type Language = 'bn' | 'en';

export interface FieldControlProps {
    field: Field;
    value: unknown;
    onChange(value: unknown): void;
    /** The language being written (the toolbar's); labels are in the admin's own language. */
    language: Language;
    document: LayoutDocument;
    issue?: string;
}

function Label({ htmlFor, children, language }: { htmlFor?: string; children: string; language?: Language }) {
    return (
        <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
                {children}
            </label>
            {language && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    {language === 'bn' ? 'বাংলা' : 'English'}
                </span>
            )}
        </div>
    );
}

function Hint({ children, tone = 'muted', id }: { children: string; tone?: 'muted' | 'error'; id?: string }) {
    return (
        <p
            id={id}
            className={cn(
                'mt-1.5 text-xs leading-relaxed',
                tone === 'error' ? 'text-red-700' : 'text-slate-500',
            )}
        >
            {children}
        </p>
    );
}

function TextControl({ field, value, onChange, language, issue }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const id = useId();
    const text = value as Bilingual;
    const other: Language = language === 'bn' ? 'en' : 'bn';
    const current = text[language];
    const fallback = text[other];
    const set = (next: string) => onChange({ ...text, [language]: next });
    const label = field.label[ui];
    return (
        <div>
            <Label htmlFor={id} language={language}>
                {label}
            </Label>
            {field.kind === 'richText' ? (
                <RichTextEditor id={id} value={current} onChange={set} lang={language} label={label} />
            ) : field.kind === 'textarea' ? (
                <Textarea
                    id={id}
                    lang={language}
                    rows={3}
                    value={current}
                    maxLength={field.max}
                    placeholder={fallback}
                    onChange={event => set(event.target.value)}
                />
            ) : (
                <Input
                    id={id}
                    lang={language}
                    value={current}
                    maxLength={field.kind === 'text' ? field.max : undefined}
                    placeholder={fallback}
                    onChange={event => set(event.target.value)}
                />
            )}
            {!current && fallback && (
                <Hint>{m.design.missingText(m.design.languageNames[other] ?? other)}</Hint>
            )}
            {field.hint && <Hint>{field.hint[ui]}</Hint>}
            {issue && <Hint tone="error">{issue}</Hint>}
        </div>
    );
}

function ImageControl({ field, value, onChange, issue }: FieldControlProps) {
    const { language: ui } = useI18n();
    const id = useId();
    const image = value as ImageValue | null;
    return (
        <div>
            <Label htmlFor={id}>{field.label[ui]}</Label>
            <ImageUpload
                id={id}
                maxMegabytes={10}
                value={image ? { id: image.assetId, preview: image.preview } : null}
                onChange={next => onChange(next ? { assetId: next.id, preview: next.preview } : null)}
            />
            {field.hint && <Hint>{field.hint[ui]}</Hint>}
            {issue && <Hint tone="error">{issue}</Hint>}
        </div>
    );
}

function ProductsControl({ field, value, onChange, issue }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const single = field.kind === 'product';
    const ids = single ? (value ? [value as string] : []) : (value as string[]);
    const max = field.kind === 'productList' ? field.max : 1;
    const products = useProducts(ids);
    const [open, setOpen] = useState(false);
    const set = (next: string[]) => onChange(single ? (next[0] ?? null) : next);
    const move = (index: number, to: number) => {
        const next = [...ids];
        const [item] = next.splice(index, 1);
        next.splice(to, 0, item!);
        set(next);
    };
    return (
        <div>
            <Label>{field.label[ui]}</Label>
            {ids.length > 0 && (
                <ul className="mb-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                    {ids.map((productId, index) => {
                        const product = products.data?.get(productId);
                        return (
                            <li key={productId} className="flex items-center gap-2 px-2 py-1.5">
                                <ProductThumb product={product} size="size-9" />
                                <span className="min-w-0 flex-1 truncate text-sm">
                                    {product?.name ?? '…'}
                                    {product && !product.enabled && (
                                        <span className="ml-1 text-xs text-amber-700">
                                            · {d.hiddenProduct}
                                        </span>
                                    )}
                                </span>
                                {!single && (
                                    <>
                                        <IconButton
                                            aria-label={d.moveUp}
                                            disabled={index === 0}
                                            onClick={() => move(index, index - 1)}
                                        >
                                            <ArrowUp className="size-4" aria-hidden />
                                        </IconButton>
                                        <IconButton
                                            aria-label={d.moveDown}
                                            disabled={index === ids.length - 1}
                                            onClick={() => move(index, index + 1)}
                                        >
                                            <ArrowDown className="size-4" aria-hidden />
                                        </IconButton>
                                    </>
                                )}
                                <IconButton
                                    aria-label={d.remove}
                                    onClick={() => set(ids.filter(item => item !== productId))}
                                >
                                    <X className="size-4" aria-hidden />
                                </IconButton>
                            </li>
                        );
                    })}
                </ul>
            )}
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" aria-hidden />
                {ids.length ? d.change : single ? d.chooseProduct : d.chooseProducts}
            </Button>
            {issue && <Hint tone="error">{issue}</Hint>}
            {open && (
                <ProductPickerDialog
                    open={open}
                    onClose={() => setOpen(false)}
                    selected={ids}
                    max={max}
                    onDone={set}
                />
            )}
        </div>
    );
}

function CollectionsControl({ field, value, onChange, issue }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const single = field.kind === 'collection';
    const ids = single ? (value ? [value as string] : []) : (value as string[]);
    const max = field.kind === 'collectionList' ? field.max : 1;
    const collections = useCollections();
    const byId = new Map((collections.data ?? []).map(item => [item.id, item]));
    const [open, setOpen] = useState(false);
    const set = (next: string[]) => onChange(single ? (next[0] ?? null) : next);
    return (
        <div>
            <Label>{field.label[ui]}</Label>
            {ids.length === 0 && !single && <p className="mb-2 text-sm text-slate-600">{d.mainCategories}</p>}
            {ids.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                    {ids.map(collectionId => {
                        const collection = byId.get(collectionId);
                        return (
                            <li
                                key={collectionId}
                                className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white py-1 pr-1 pl-2.5 text-sm"
                            >
                                <span className="truncate">
                                    {collection ? collectionLabel(collection) : '…'}
                                </span>
                                <button
                                    type="button"
                                    className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                    aria-label={d.remove}
                                    onClick={() => set(ids.filter(item => item !== collectionId))}
                                >
                                    <X className="size-3.5" aria-hidden />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" aria-hidden />
                {ids.length ? d.change : d.chooseCategory}
            </Button>
            {field.hint && <Hint>{field.hint[ui]}</Hint>}
            {issue && <Hint tone="error">{issue}</Hint>}
            {open && (
                <CollectionPickerDialog
                    open={open}
                    onClose={() => setOpen(false)}
                    selected={ids}
                    max={max}
                    onDone={set}
                />
            )}
        </div>
    );
}

function LinkControl({ field, value, onChange, language, document, issue }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const id = useId();
    const link = value as LinkValue;
    const collections = useCollections();
    const pages = useQuery({
        queryKey: ['designPages'],
        queryFn: fetchPages,
        staleTime: 60_000,
        enabled: link.type === 'page',
    });
    const [pickProduct, setPickProduct] = useState(false);
    const products = useProducts(link.type === 'product' ? [link.ref] : []);
    const anchors = anchorsOf(document, language);
    const setType = (type: string) => {
        switch (type) {
            case 'category':
            case 'product':
            case 'page':
                onChange({ type, ref: '' });
                if (type === 'product') setPickProduct(true);
                break;
            case 'policy':
                onChange({ type, policy: 'returnPolicy' });
                break;
            case 'anchor':
                onChange({ type, anchor: anchors[0]?.anchor ?? '' });
                break;
            case 'url':
                onChange({ type, url: '' });
                break;
            default:
                onChange({ type });
        }
    };
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{field.label[ui]}</Label>
            <Select id={id} value={link.type} onChange={event => setType(event.target.value)}>
                {LINK_TYPES.map(type => (
                    <option key={type} value={type}>
                        {d.linkTypes[type]}
                    </option>
                ))}
            </Select>
            {link.type === 'category' && (
                <Select
                    aria-label={d.chooseCategory}
                    value={link.ref}
                    onChange={event => onChange({ type: 'category', ref: event.target.value })}
                >
                    <option value="">{d.chooseCategory}</option>
                    {(collections.data ?? [])
                        .filter(item => !item.isPrivate)
                        .map(item => (
                            <option key={item.id} value={item.id}>
                                {collectionLabel(item)}
                            </option>
                        ))}
                </Select>
            )}
            {link.type === 'page' && (
                <Select
                    aria-label={d.choosePageLink}
                    value={link.ref}
                    onChange={event => onChange({ type: 'page', ref: event.target.value })}
                >
                    <option value="">{d.choosePageLink}</option>
                    {(pages.data ?? []).map(page => {
                        const translation =
                            page.translations.find(item => item.languageCode === language) ??
                            page.translations[0];
                        return (
                            <option key={page.id} value={page.id}>
                                {translation?.title}
                            </option>
                        );
                    })}
                </Select>
            )}
            {link.type === 'product' && (
                <div className="flex items-center gap-2">
                    {link.ref && <ProductThumb product={products.data?.get(link.ref)} size="size-9" />}
                    <span className="min-w-0 flex-1 truncate text-sm">
                        {link.ref ? (products.data?.get(link.ref)?.name ?? '…') : ''}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => setPickProduct(true)}>
                        {link.ref ? d.change : d.chooseProduct}
                    </Button>
                    {pickProduct && (
                        <ProductPickerDialog
                            open={pickProduct}
                            onClose={() => setPickProduct(false)}
                            selected={link.ref ? [link.ref] : []}
                            max={1}
                            onDone={ids => ids[0] && onChange({ type: 'product', ref: ids[0] })}
                        />
                    )}
                </div>
            )}
            {link.type === 'policy' && (
                <Select
                    aria-label={d.linkTypes.policy}
                    value={link.policy}
                    onChange={event => onChange({ type: 'policy', policy: event.target.value })}
                >
                    {POLICY_KEYS.map(policy => (
                        <option key={policy} value={policy}>
                            {d.policies[policy]}
                        </option>
                    ))}
                </Select>
            )}
            {link.type === 'anchor' &&
                (anchors.length ? (
                    <Select
                        aria-label={d.chooseAnchor}
                        value={link.anchor}
                        onChange={event => onChange({ type: 'anchor', anchor: event.target.value })}
                    >
                        <option value="">{d.chooseAnchor}</option>
                        {anchors.map(item => (
                            <option key={item.anchor} value={item.anchor}>
                                #{item.anchor} · {item.label}
                            </option>
                        ))}
                    </Select>
                ) : (
                    <Hint>{d.noAnchors}</Hint>
                ))}
            {link.type === 'url' && (
                <Input
                    aria-label={d.linkTypes.url}
                    inputMode="url"
                    value={link.url}
                    placeholder={d.urlPlaceholder}
                    aria-invalid={link.url !== '' && !isLinkUrl(link.url.trim()) ? true : undefined}
                    onChange={event => onChange({ type: 'url', url: event.target.value })}
                />
            )}
            {issue && <Hint tone="error">{issue}</Hint>}
        </div>
    );
}

/** A choice of a few short options as one row of buttons; longer lists as a select. */
function ChoiceControl({ field, value, onChange }: FieldControlProps) {
    const { language: ui } = useI18n();
    const id = useId();
    if (field.kind !== 'select') return null;
    const segmented =
        field.options.length <= 4 && field.options.every(option => option.label[ui].length <= 18);
    if (!segmented) {
        return (
            <div>
                <Label htmlFor={id}>{field.label[ui]}</Label>
                <Select id={id} value={value as string} onChange={event => onChange(event.target.value)}>
                    {field.options.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label[ui]}
                        </option>
                    ))}
                </Select>
                {field.hint && <Hint>{field.hint[ui]}</Hint>}
            </div>
        );
    }
    return (
        <Segmented
            label={field.label[ui]}
            value={value as string}
            onChange={onChange}
            options={field.options.map(option => ({ value: option.value, label: option.label[ui] }))}
            hint={field.hint?.[ui]}
        />
    );
}

export function Segmented<T extends string>({
    label,
    value,
    onChange,
    options,
    hint,
}: {
    label: string;
    value: T;
    onChange(value: T): void;
    options: ReadonlyArray<{ value: T; label: string }>;
    hint?: string;
}) {
    const id = useId();
    return (
        <fieldset>
            <legend id={id} className="mb-1.5 text-sm font-medium text-slate-800">
                {label}
            </legend>
            <div
                className="flex rounded-md border border-slate-300 bg-slate-50 p-0.5"
                role="radiogroup"
                aria-labelledby={id}
            >
                {options.map(option => {
                    const on = option.value === value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => onChange(option.value)}
                            className={cn(
                                'min-h-9 flex-1 rounded px-2 text-sm leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-teal-600',
                                on
                                    ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200'
                                    : 'text-slate-600 hover:text-slate-900',
                            )}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
            {hint && <Hint>{hint}</Hint>}
        </fieldset>
    );
}

function RangeControl({ field, value, onChange }: FieldControlProps) {
    const id = useId();
    const { language: ui } = useI18n();
    if (field.kind !== 'range') return null;
    const shown =
        ui === 'bn' ? String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(value);
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor={id} className="text-sm font-medium text-slate-800">
                    {field.label[ui]}
                </label>
                <output
                    htmlFor={id}
                    className="min-w-8 rounded bg-slate-100 px-2 py-0.5 text-center text-sm font-medium tabular-nums"
                >
                    {shown}
                </output>
            </div>
            <input
                id={id}
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={value as number}
                onChange={event => onChange(Number(event.target.value))}
                className="h-2 w-full cursor-pointer accent-teal-700"
            />
            {field.hint && <Hint>{field.hint[ui]}</Hint>}
        </div>
    );
}

function VideoControl({ field, value, onChange, issue }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const id = useId();
    const url = value as string;
    const video = url ? parseVideo(url) : null;
    return (
        <div>
            <Label htmlFor={id}>{field.label[ui]}</Label>
            <Input
                id={id}
                inputMode="url"
                value={url}
                placeholder="https://youtu.be/…"
                aria-invalid={url && !video ? true : undefined}
                onChange={event => onChange(event.target.value)}
            />
            {url && video && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-teal-800">
                    <CircleCheck className="size-3.5" aria-hidden />
                    {m.design.videoFound(video.provider === 'youtube' ? 'YouTube' : 'Facebook')}
                </p>
            )}
            {url && !video && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-700">
                    <CircleX className="size-3.5" aria-hidden />
                    {m.design.issues.invalidVideo}
                </p>
            )}
            {field.hint && !url && <Hint>{field.hint[ui]}</Hint>}
            {issue && !(url && !video) && <Hint tone="error">{issue}</Hint>}
        </div>
    );
}

/** Any colour (phase 16's Design options): the browser's colour picker and the hex code, or none. */
function HexControl({ field, value, onChange, issue }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    const hex = (value as string) || '';
    const [typed, setTyped] = useState(hex);
    // Undo, redo or the picker changed it: show it, unless the merchant is typing.
    useEffect(() => {
        if (document.activeElement !== input.current) setTyped(hex);
    }, [hex]);
    const valid = (text: string) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.trim());
    const normalize = (text: string) => {
        const digits = text.trim().toLowerCase().replace('#', '');
        return `#${digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits}`;
    };
    return (
        <div>
            <Label htmlFor={id}>{field.label[ui]}</Label>
            <div className="flex items-center gap-2">
                <span className="relative size-11 shrink-0 overflow-hidden rounded-md border border-slate-300">
                    <input
                        type="color"
                        aria-label={field.label[ui]}
                        value={hex || '#ffffff'}
                        onChange={event => onChange(event.target.value)}
                        className="absolute inset-0 size-full cursor-pointer border-0 p-0"
                    />
                    {!hex && (
                        // No colour chosen: a slash, like "none" in design tools.
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white">
                            <span className="h-px w-8 rotate-45 bg-red-500" />
                        </span>
                    )}
                </span>
                <Input
                    ref={input}
                    id={id}
                    value={typed}
                    placeholder={m.design.auto}
                    maxLength={7}
                    spellCheck={false}
                    className="font-mono uppercase"
                    aria-invalid={typed !== '' && !valid(typed) ? true : undefined}
                    onChange={event => {
                        const next = event.target.value;
                        setTyped(next);
                        if (next.trim() === '') onChange('');
                        else if (/^#?[0-9a-f]{6}$/i.test(next.trim())) onChange(normalize(next));
                    }}
                    onBlur={() => {
                        if (valid(typed)) onChange(normalize(typed));
                        setTyped(valid(typed) ? normalize(typed) : hex);
                    }}
                />
                {hex && (
                    <Button variant="ghost" size="sm" onClick={() => onChange('')}>
                        {m.design.clear}
                    </Button>
                )}
            </div>
            {field.hint && <Hint>{field.hint[ui]}</Hint>}
            {issue && <Hint tone="error">{issue}</Hint>}
        </div>
    );
}

/** A size within limits, or automatic (empty): a slider with the number, and "Auto". */
function SizeControl({ field, value, onChange }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const id = useId();
    if (field.kind !== 'size') return null;
    const size = value as number | null;
    const unit = field.unit === '%' ? '%' : field.unit === 'h' ? m.design.hoursShort : 'px';
    const shown = (n: number) =>
        ui === 'bn' ? String(n).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(n);
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor={id} className="text-sm font-medium text-slate-800">
                    {field.label[ui]}
                </label>
                <span className="flex items-center gap-1.5">
                    <output
                        htmlFor={id}
                        className={cn(
                            'min-w-12 rounded px-2 py-0.5 text-center text-sm font-medium tabular-nums',
                            size == null ? 'text-slate-500' : 'bg-slate-100',
                        )}
                    >
                        {size == null ? m.design.auto : `${shown(size)} ${unit}`}
                    </output>
                    {size != null && (
                        <button
                            type="button"
                            onClick={() => onChange(null)}
                            className="rounded px-1.5 py-0.5 text-xs font-medium text-teal-800 hover:bg-teal-50"
                        >
                            {m.design.auto}
                        </button>
                    )}
                </span>
            </div>
            <input
                id={id}
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={size ?? field.min}
                onChange={event => onChange(Number(event.target.value))}
                className={cn('h-2 w-full cursor-pointer accent-teal-700', size == null && 'opacity-50')}
            />
            {field.hint && <Hint>{field.hint[ui]}</Hint>}
        </div>
    );
}

/** Dhaka time is UTC+6 all year (no daylight saving). */
const DHAKA_MS = 6 * 60 * 60 * 1000;

/** A date and time, chosen in Dhaka time and stored in UTC (ISO). */
function DateTimeControl({ field, value, onChange, issue }: FieldControlProps) {
    const { messages: m, language: ui } = useI18n();
    const id = useId();
    const iso = value as string;
    const local = iso ? new Date(Date.parse(iso) + DHAKA_MS).toISOString().slice(0, 16) : '';
    return (
        <div>
            <Label htmlFor={id}>{field.label[ui]}</Label>
            <Input
                id={id}
                type="datetime-local"
                value={local}
                onChange={event =>
                    onChange(
                        event.target.value ? new Date(`${event.target.value}:00+06:00`).toISOString() : '',
                    )
                }
            />
            <Hint>{m.design.dhakaTime}</Hint>
            {issue && <Hint tone="error">{issue}</Hint>}
        </div>
    );
}

/** An amount in whole taka, stored in poisha; empty for none. */
function MoneyControl({ field, value, onChange }: FieldControlProps) {
    const { language: ui } = useI18n();
    const id = useId();
    const poisha = value as number | null;
    return (
        <div>
            <Label htmlFor={id}>{field.label[ui]}</Label>
            <div className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white focus-within:outline-2 focus-within:outline-teal-600">
                <span className="pl-3 text-slate-500" aria-hidden>
                    ৳
                </span>
                <input
                    id={id}
                    inputMode="numeric"
                    className="min-w-0 flex-1 bg-transparent py-2 pr-3 pl-1 text-base outline-none"
                    value={poisha == null ? '' : String(poisha / 100)}
                    onChange={event => {
                        const digits = event.target.value
                            .replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)))
                            .replace(/[^\d]/g, '');
                        onChange(digits ? Math.min(Number(digits), 10_000_000) * 100 : null);
                    }}
                />
            </div>
            {field.hint && <Hint>{field.hint[ui]}</Hint>}
        </div>
    );
}

const SWATCHES: Record<(typeof PALETTE_COLOURS)[number], string> = {
    text: 'bg-slate-900',
    accent: 'bg-teal-700',
    sale: 'bg-red-700',
    subtle: 'bg-slate-100',
};

function ColourControl({ field, value, onChange }: FieldControlProps) {
    const { language: ui } = useI18n();
    if (field.kind !== 'colour') return null;
    return (
        <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-800">{field.label[ui]}</legend>
            <div className="flex gap-2">
                {PALETTE_COLOURS.map(colour => (
                    <button
                        key={colour}
                        type="button"
                        aria-label={colour}
                        aria-pressed={value === colour}
                        onClick={() => onChange(colour)}
                        className={cn(
                            'size-8 rounded border border-slate-300',
                            SWATCHES[colour],
                            value === colour && 'ring-2 ring-teal-600 ring-offset-2',
                        )}
                    />
                ))}
            </div>
        </fieldset>
    );
}

export function FieldControl(props: FieldControlProps) {
    const { language: ui } = useI18n();
    const { field, value, onChange } = props;
    switch (field.kind) {
        case 'text':
        case 'textarea':
        case 'richText':
            return <TextControl {...props} />;
        case 'image':
            return <ImageControl {...props} />;
        case 'product':
        case 'productList':
            return <ProductsControl {...props} />;
        case 'collection':
        case 'collectionList':
            return <CollectionsControl {...props} />;
        case 'link':
            return <LinkControl {...props} />;
        case 'select':
            return <ChoiceControl {...props} />;
        case 'toggle':
            return (
                <Switch
                    checked={value as boolean}
                    onChange={onChange}
                    label={field.label[ui]}
                    description={field.hint?.[ui]}
                />
            );
        case 'range':
            return <RangeControl {...props} />;
        case 'video':
            return <VideoControl {...props} />;
        case 'colour':
            return <ColourControl {...props} />;
        case 'hex':
            return <HexControl {...props} />;
        case 'size':
            return <SizeControl {...props} />;
        case 'datetime':
            return <DateTimeControl {...props} />;
        case 'money':
            return <MoneyControl {...props} />;
    }
}
