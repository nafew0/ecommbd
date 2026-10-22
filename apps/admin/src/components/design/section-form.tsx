import {
    type Bilingual,
    fieldShown,
    type LayoutDocument,
    pick,
    type SectionData,
    sectionDefinition,
    type SectionStyle,
    STYLE_CHOICES,
} from '@ecommbd/sections';
import { ArrowDown, ArrowUp, ChevronDown, Copy, ImageIcon, Plus, Trash2 } from 'lucide-react';
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
 * every section shares. Problems found on save or publish show under their field.
 */

interface SectionFormProps {
    section: SectionData;
    document: LayoutDocument;
    language: Language;
    warnings: LayoutWarning[];
    onChange(document: LayoutDocument, key?: string): void;
}

export function SectionForm({ section, document, language, warnings, onChange }: SectionFormProps) {
    const { messages: m } = useI18n();
    const d = m.design;
    const [tab, setTab] = useState<'content' | 'style'>('content');
    const definition = sectionDefinition(section.type);
    if (!definition) return null;
    const tabs = [
        { key: 'content' as const, label: d.content },
        { key: 'style' as const, label: d.style },
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
            ) : (
                <StyleForm
                    section={section}
                    document={document}
                    onChange={onChange}
                    issue={issueFor('style.anchor')}
                />
            )}
        </div>
    );
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
    const titleOf = (settings: Record<string, unknown>, index: number) => {
        const value = blocks.titleField ? settings[blocks.titleField] : undefined;
        const text = value && typeof value === 'object' ? pick(value as Bilingual, language) : '';
        return text || `${label} ${digits(index + 1)}`;
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
                                    {Object.entries(blocks.fields).map(([name, field]) =>
                                        fieldShown(field, block.settings) ? (
                                            <FieldControl
                                                key={`${block.uid}-${name}`}
                                                field={field}
                                                value={block.settings[name]}
                                                language={language}
                                                document={document}
                                                issue={issueFor(name, block.uid)}
                                                onChange={value =>
                                                    onChange(
                                                        setBlockSetting(
                                                            document,
                                                            section.uid,
                                                            block.uid,
                                                            name,
                                                            value,
                                                        ),
                                                        `${block.uid}.${name}.${language}`,
                                                    )
                                                }
                                            />
                                        ) : null,
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
                onClick={() => {
                    const next = addBlock(document, section.uid);
                    onChange(next);
                    setOpen(next.sections.find(item => item.uid === section.uid)!.blocks.at(-1)!.uid);
                }}
            >
                <Plus className="size-4" aria-hidden />
                {d.addBlock(label)}
            </Button>
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
}: {
    section: SectionData;
    document: LayoutDocument;
    onChange(document: LayoutDocument, key?: string): void;
    issue?: string;
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
        </div>
    );
}
