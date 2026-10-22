import {
    type Bilingual,
    DESIGN_FIELDS,
    DESIGN_GROUPS,
    fieldShown,
    hasDesign,
    type LayoutDocument,
    pick,
    readDesign,
    type SectionData,
    sectionDefinition,
    type SectionDesign,
    type SectionStyle,
    STYLE_CHOICES,
} from '@ecommbd/sections';
import {
    ArrowDown,
    ArrowUp,
    BadgePercent,
    ChevronDown,
    CirclePlay,
    Copy,
    Heading,
    ImageIcon,
    LayoutPanelTop,
    ListChecks,
    type LucideIcon,
    MousePointerClick,
    MoveVertical,
    Plus,
    RotateCcw,
    SeparatorHorizontal,
    Star,
    Tag,
    Timer,
    Trash2,
    Type,
} from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { ImageUpload } from '../form/image-upload';
import { Button } from '../ui/button';
import { IconButton } from './icon-button';
import { Switch } from '../ui/switch';
import type { LayoutWarning } from './design-api';
import { addBlock, moveBlock, removeBlock, setBlockSetting, setSetting, setStyle } from './document-ops';
import { FieldControl, type Language, Segmented } from './field-controls';

/**
 * The selected section's settings (roadmap phase 15): "Content" is generated from the section's
 * schema (fields, then its blocks such as slides or questions), "Style" has the few style options
 * every section shares, and "Design" (phase 16) any colour, spacing, width, corners, border and
 * type size, as in a page builder. Problems found on save or publish show under their field.
 */

interface SectionFormProps {
    section: SectionData;
    document: LayoutDocument;
    language: Language;
    warnings: LayoutWarning[];
    onChange(document: LayoutDocument, key?: string): void;
    /** A sales page (phase 16): sections can have an "Order now" button below them. */
    landing?: boolean;
}

export function SectionForm({ section, document, language, warnings, onChange, landing }: SectionFormProps) {
    const { messages: m } = useI18n();
    const d = m.design;
    const [tab, setTab] = useState<'content' | 'style' | 'design'>('content');
    const definition = sectionDefinition(section.type);
    if (!definition) return null;
    const tabs = [
        { key: 'content' as const, label: d.content },
        { key: 'style' as const, label: d.style },
        { key: 'design' as const, label: d.designTab },
    ];
    const issueFor = (field: string, blockUid?: string) => {
        const warning = warnings.find(
            item =>
                item.sectionId === section.uid &&
                item.field === field &&
                (item.blockId ?? undefined) === blockUid,
        );
        return warning ? (d.issues[warning.code] ?? warning.code) : undefined;
    };
    const general = warnings.filter(
        item => item.sectionId === section.uid && (item.field === '' || item.field === 'sections'),
    );

    return (
        <div>
            <div role="tablist" className="sticky top-0 z-10 flex border-b border-slate-200 bg-white px-4">
                {tabs.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => setTab(item.key)}
                        className={cn(
                            '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                            tab === item.key
                                ? 'border-teal-700 text-teal-800'
                                : 'border-transparent text-slate-600 hover:text-slate-900',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            {general.length > 0 && (
                <ul className="mx-4 mt-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {general.map(item => (
                        <li key={`${item.code}-${item.blockId ?? ''}`}>{d.issues[item.code] ?? item.code}</li>
                    ))}
                </ul>
            )}
            {tab === 'content' ? (
                <div className="space-y-5 p-4">
                    {Object.entries(definition.fields).map(([name, field]) =>
                        fieldShown(field, section.settings) ? (
                            <FieldControl
                                key={`${section.uid}-${name}`}
                                field={field}
                                value={section.settings[name]}
                                language={language}
                                document={document}
                                issue={issueFor(name)}
                                onChange={value =>
                                    onChange(
                                        setSetting(document, section.uid, name, value),
                                        `${section.uid}.${name}.${language}`,
                                    )
                                }
                            />
                        ) : null,
                    )}
                    {definition.blocks && (
                        <Blocks
                            section={section}
                            document={document}
                            language={language}
                            issueFor={issueFor}
                            onChange={onChange}
                        />
                    )}
                </div>
            ) : tab === 'style' ? (
                <StyleForm
                    section={section}
                    document={document}
                    onChange={onChange}
                    issue={issueFor('style.anchor')}
                    landing={landing}
                />
            ) : (
                <DesignForm section={section} document={document} language={language} onChange={onChange} />
            )}
        </div>
    );
}

/** The Design tab (phase 16): every option empty means "as the theme and the Style tab say". */
function DesignForm({
    section,
    document,
    language,
    onChange,
}: {
    section: SectionData;
    document: LayoutDocument;
    language: Language;
    onChange(document: LayoutDocument, key?: string): void;
}) {
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const design = section.style.design;
    const set = (name: keyof SectionDesign, value: unknown) =>
        onChange(
            setStyle(document, section.uid, { design: { ...design, [name]: value } as SectionDesign }),
            `${section.uid}.design.${name}`,
        );
    return (
        <div className="space-y-6 p-4">
            <p className="text-sm text-slate-600">{d.designIntro}</p>
            {DESIGN_GROUPS.map(group => (
                <fieldset
                    key={group.label.en}
                    className="space-y-4 border-t border-slate-100 pt-4 first-of-type:border-0 first-of-type:pt-0"
                >
                    <legend className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        {group.label[ui]}
                    </legend>
                    {group.fields.map(name => (
                        <FieldControl
                            key={`${section.uid}-design-${name}`}
                            field={DESIGN_FIELDS[name]}
                            value={design[name]}
                            language={language}
                            document={document}
                            onChange={value => set(name, value)}
                        />
                    ))}
                </fieldset>
            ))}
            {hasDesign(design) && (
                <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => onChange(setStyle(document, section.uid, { design: readDesign({}) }))}
                >
                    <RotateCcw className="size-4" aria-hidden />
                    {d.resetDesign}
                </Button>
            )}
        </div>
    );
}

/** A Custom section element's own look: under "Style this element", after its content. */
const ELEMENT_STYLE = new Set([
    'color',
    'background',
    'size',
    'sizePhone',
    'weight',
    'align',
    'width',
    'padding',
    'radius',
    'borderWidth',
    'borderColor',
    'spaceBelow',
]);

const ELEMENT_ICONS: Record<string, LucideIcon> = {
    heading: Heading,
    text: Type,
    image: ImageIcon,
    button: MousePointerClick,
    list: ListChecks,
    iconbox: LayoutPanelTop,
    video: CirclePlay,
    countdown: Timer,
    price: Tag,
    badge: BadgePercent,
    stars: Star,
    spacer: MoveVertical,
    divider: SeparatorHorizontal,
};

/** A few words of an element's content, for its row in the list. */
function elementSnippet(settings: Record<string, unknown>, language: Language): string {
    for (const name of ['heading', 'label', 'text', 'items', 'body']) {
        const value = settings[name];
        if (value && typeof value === 'object') {
            const text = pick(value as Bilingual, language)
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (text) return text.slice(0, 40);
        }
    }
    return '';
}

function Blocks({
    section,
    document,
    language,
    issueFor,
    onChange,
}: {
    section: SectionData;
    document: LayoutDocument;
    language: Language;
    issueFor(field: string, blockUid?: string): string | undefined;
    onChange(document: LayoutDocument, key?: string): void;
}) {
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const definition = sectionDefinition(section.type)!;
    const blocks = definition.blocks!;
    const [open, setOpen] = useState<string | null>(
        section.blocks.length === 1 ? section.blocks[0]!.uid : null,
    );
    const label = pick(blocks.label, ui);
    const digits = (n: number) =>
        ui === 'bn' ? String(n).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(n);
    const custom = section.type === 'custom';
    const kindField = blocks.fields.kind;
    const kinds = kindField?.kind === 'select' ? kindField.options : [];
    const kindLabel = (kind: unknown) => {
        const option = kinds.find(item => item.value === kind);
        return option ? option.label[ui] : label;
    };
    const titleOf = (settings: Record<string, unknown>, index: number) => {
        if (custom) {
            const snippet = elementSnippet(settings, language);
            return snippet ? `${kindLabel(settings.kind)}: ${snippet}` : kindLabel(settings.kind);
        }
        const value = blocks.titleField ? settings[blocks.titleField] : undefined;
        const text = value && typeof value === 'object' ? pick(value as Bilingual, language) : '';
        return text || `${label} ${digits(index + 1)}`;
    };
    const [picking, setPicking] = useState(false);
    const addElement = (kind: string) => {
        const added = addBlock(document, section.uid);
        const fresh = added.sections.find(item => item.uid === section.uid)!.blocks.at(-1)!;
        const column = (section.blocks.at(-1)?.settings.column as string | undefined) ?? '1';
        const withKind = setBlockSetting(added, section.uid, fresh.uid, 'kind', kind);
        onChange(setBlockSetting(withKind, section.uid, fresh.uid, 'column', column));
        setOpen(fresh.uid);
        setPicking(false);
    };
    const fieldRow = (block: SectionData['blocks'][number], name: string) => {
        const field = blocks.fields[name]!;
        return fieldShown(field, block.settings) ? (
            <FieldControl
                key={`${block.uid}-${name}`}
                field={field}
                value={block.settings[name]}
                language={language}
                document={document}
                issue={issueFor(name, block.uid)}
                onChange={value =>
                    onChange(
                        setBlockSetting(document, section.uid, block.uid, name, value),
                        `${block.uid}.${name}.${language}`,
                    )
                }
            />
        ) : null;
    };
    return (
        <section className="border-t border-slate-200 pt-5">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{label}</h3>
                <span className="text-xs text-slate-500">
                    {d.blockCount(digits(section.blocks.length), digits(blocks.max))}
                </span>
            </div>
            <ul className="space-y-2">
                {section.blocks.map((block, index) => {
                    const expanded = open === block.uid;
                    const hasIssue = Object.keys(blocks.fields).some(name => issueFor(name, block.uid));
                    return (
                        <li
                            key={block.uid}
                            className={cn(
                                'rounded-md border bg-white',
                                hasIssue
                                    ? 'border-red-300'
                                    : expanded
                                      ? 'border-teal-600 ring-1 ring-teal-600/20'
                                      : 'border-slate-200',
                            )}
                        >
                            <div className="flex items-center gap-1 pr-1">
                                <button
                                    type="button"
                                    aria-expanded={expanded}
                                    onClick={() => setOpen(expanded ? null : block.uid)}
                                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm"
                                >
                                    <ChevronDown
                                        className={cn(
                                            'size-4 shrink-0 text-slate-500 transition-transform',
                                            expanded && 'rotate-180',
                                        )}
                                        aria-hidden
                                    />
                                    {custom &&
                                        (() => {
                                            const Icon = ELEMENT_ICONS[block.settings.kind as string] ?? Type;
                                            return (
                                                <Icon className="size-4 shrink-0 text-teal-700" aria-hidden />
                                            );
                                        })()}
                                    <span className="truncate font-medium">
                                        {titleOf(block.settings, index)}
                                    </span>
                                </button>
                                <IconButton
                                    aria-label={d.moveUp}
                                    disabled={index === 0}
                                    onClick={() =>
                                        onChange(moveBlock(document, section.uid, index, index - 1))
                                    }
                                >
                                    <ArrowUp className="size-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    aria-label={d.moveDown}
                                    disabled={index === section.blocks.length - 1}
                                    onClick={() =>
                                        onChange(moveBlock(document, section.uid, index, index + 1))
                                    }
                                >
                                    <ArrowDown className="size-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    aria-label={d.duplicate}
                                    disabled={section.blocks.length >= blocks.max}
                                    onClick={() => {
                                        const added = addBlock(document, section.uid);
                                        const fresh = added.sections
                                            .find(item => item.uid === section.uid)!
                                            .blocks.at(-1)!;
                                        let next = added;
                                        for (const [name, value] of Object.entries(block.settings)) {
                                            next = setBlockSetting(
                                                next,
                                                section.uid,
                                                fresh.uid,
                                                name,
                                                structuredClone(value),
                                            );
                                        }
                                        const moved = moveBlock(
                                            next,
                                            section.uid,
                                            section.blocks.length,
                                            index + 1,
                                        );
                                        onChange(moved);
                                        setOpen(fresh.uid);
                                    }}
                                >
                                    <Copy className="size-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    tone="danger"
                                    aria-label={d.remove}
                                    disabled={section.blocks.length <= (blocks.min ?? 0)}
                                    onClick={() => onChange(removeBlock(document, section.uid, block.uid))}
                                >
                                    <Trash2 className="size-4" aria-hidden />
                                </IconButton>
                            </div>
                            {expanded && (
                                <div className="space-y-5 border-t border-slate-100 p-3">
                                    {Object.keys(blocks.fields)
                                        .filter(name => !custom || !ELEMENT_STYLE.has(name))
                                        .map(name => fieldRow(block, name))}
                                    {custom && block.settings.kind !== 'spacer' && (
                                        <details className="group rounded-md border border-slate-200">
                                            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-slate-800">
                                                <ChevronDown
                                                    className="size-4 text-slate-500 transition-transform group-open:rotate-180"
                                                    aria-hidden
                                                />
                                                {d.styleElement}
                                            </summary>
                                            <div className="space-y-5 border-t border-slate-100 p-3">
                                                {[...ELEMENT_STYLE].map(name => fieldRow(block, name))}
                                            </div>
                                        </details>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            <Button
                variant="secondary"
                size="sm"
                className="mt-3 w-full justify-center"
                disabled={section.blocks.length >= blocks.max}
                aria-expanded={custom ? picking : undefined}
                onClick={() => {
                    if (custom) {
                        setPicking(!picking);
                        return;
                    }
                    const next = addBlock(document, section.uid);
                    onChange(next);
                    setOpen(next.sections.find(item => item.uid === section.uid)!.blocks.at(-1)!.uid);
                }}
            >
                <Plus className="size-4" aria-hidden />
                {d.addBlock(label)}
            </Button>
            {custom && picking && (
                <ul className="mt-2 grid grid-cols-3 gap-1.5" aria-label={d.chooseElement}>
                    {kinds.map(option => {
                        const Icon = ELEMENT_ICONS[option.value] ?? Type;
                        return (
                            <li key={option.value}>
                                <button
                                    type="button"
                                    onClick={() => addElement(option.value)}
                                    className="flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-1 text-center text-xs font-medium text-slate-800 hover:border-teal-600 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-teal-600"
                                >
                                    <Icon className="size-5 text-teal-700" aria-hidden />
                                    {option.label[ui]}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

const BACKGROUND_SWATCH: Record<SectionStyle['background'], string> = {
    none: 'bg-white',
    subtle: 'bg-slate-100',
    accent: 'bg-teal-700',
    dark: 'bg-slate-900',
    image: 'bg-slate-50',
};

function StyleForm({
    section,
    document,
    onChange,
    issue,
    landing,
}: {
    section: SectionData;
    document: LayoutDocument;
    onChange(document: LayoutDocument, key?: string): void;
    issue?: string;
    landing?: boolean;
}) {
    const { messages: m, language: ui } = useI18n();
    const s = m.design.styleLabels;
    const style = section.style;
    const anchorId = useId();
    const set = (patch: Partial<SectionStyle>, key?: string) =>
        onChange(setStyle(document, section.uid, patch), key);
    const options = <K extends keyof typeof STYLE_CHOICES>(key: K) =>
        STYLE_CHOICES[key].map(choice => ({
            value: choice.value as SectionStyle[K],
            label: choice.label[ui],
        }));
    return (
        <div className="space-y-5 p-4">
            <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-slate-800">{s.background}</legend>
                <div className="grid grid-cols-5 gap-2" role="radiogroup">
                    {STYLE_CHOICES.background.map(choice => {
                        const on = style.background === choice.value;
                        return (
                            <button
                                key={choice.value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => set({ background: choice.value })}
                                className="group flex flex-col items-center gap-1 text-center"
                            >
                                <span
                                    className={cn(
                                        'flex h-9 w-full items-center justify-center rounded border border-slate-300 text-slate-400',
                                        BACKGROUND_SWATCH[choice.value],
                                        on && 'ring-2 ring-teal-600 ring-offset-2',
                                    )}
                                >
                                    {choice.value === 'image' && <ImageIcon className="size-4" aria-hidden />}
                                </span>
                                <span
                                    className={cn(
                                        'text-[11px] leading-tight',
                                        on ? 'font-medium text-slate-900' : 'text-slate-600',
                                    )}
                                >
                                    {choice.label[ui]}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </fieldset>
            {style.background === 'image' || style.backgroundImage ? (
                <div>
                    <p className="mb-1.5 text-sm font-medium text-slate-800">{s.backgroundImage}</p>
                    <ImageUpload
                        maxMegabytes={10}
                        value={
                            style.backgroundImage
                                ? {
                                      id: style.backgroundImage.assetId,
                                      preview: style.backgroundImage.preview,
                                  }
                                : null
                        }
                        onChange={image =>
                            set({
                                backgroundImage: image ? { assetId: image.id, preview: image.preview } : null,
                                background: image
                                    ? 'image'
                                    : style.background === 'image'
                                      ? 'none'
                                      : style.background,
                            })
                        }
                    />
                </div>
            ) : null}
            <Segmented
                label={s.text}
                value={style.text}
                onChange={text => set({ text })}
                options={options('text')}
            />
            <Segmented
                label={s.spacing}
                value={style.spacing}
                onChange={spacing => set({ spacing })}
                options={options('spacing')}
            />
            <Segmented
                label={s.width}
                value={style.width}
                onChange={width => set({ width })}
                options={options('width')}
            />
            <Segmented
                label={s.align}
                value={style.align}
                onChange={align => set({ align })}
                options={options('align')}
            />
            <Segmented
                label={s.hideOn}
                value={style.hideOn}
                onChange={hideOn => set({ hideOn })}
                options={options('hideOn')}
            />
            <div>
                <label htmlFor={anchorId} className="mb-1.5 block text-sm font-medium text-slate-800">
                    {s.anchor}
                </label>
                <div className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white focus-within:outline-2 focus-within:outline-teal-600">
                    <span className="pl-3 text-slate-500" aria-hidden>
                        #
                    </span>
                    <input
                        id={anchorId}
                        className="min-w-0 flex-1 bg-transparent py-2 pr-3 pl-1 text-base outline-none"
                        value={style.anchor}
                        placeholder="order-form"
                        aria-invalid={issue ? true : undefined}
                        // Cleaned as typed; the server trims stray hyphens when it saves.
                        onChange={event =>
                            set(
                                {
                                    anchor: event.target.value
                                        .toLowerCase()
                                        .replace(/[^a-z0-9-]+/g, '-')
                                        .slice(0, 40),
                                },
                                `${section.uid}.anchor`,
                            )
                        }
                    />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{s.anchorHint}</p>
                {issue && <p className="mt-1 text-xs text-red-700">{issue}</p>}
            </div>
            <Switch
                checked={style.animate}
                onChange={animate => set({ animate })}
                label={s.animate}
                description={s.animateHint}
            />
            {landing && section.type !== 'order-form' && (
                <Switch
                    checked={style.orderButton}
                    onChange={orderButton => set({ orderButton })}
                    label={s.orderButton}
                    description={s.orderButtonHint}
                />
            )}
        </div>
    );
}
