import {
    DESIGN_FIELDS,
    DESIGN_GROUPS,
    findNode,
    hasDesign,
    isSystemLayout,
    PAGE_CONTENT,
    pick,
    SYSTEM_PAGES,
    type Device as StyleDevice,
    type LayoutDocument,
    type NodeData,
    opensToElements,
    readDesign,
    type SectionData,
    sectionDefinition,
    type SectionDesign,
    type SectionStyle,
    STYLE_CHOICES,
} from '@ecommbd/sections';
import { ImageIcon, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { ImageUpload } from '../form/image-upload';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import type { LayoutWarning } from './design-api';
import { openUpSection, setStyle, updateSection } from './document-ops';
import { ElementIcon } from './element-icon';
import { FieldControl, type Language, Segmented } from './field-controls';
import { NodeTree } from './node-tree';
import { SmartContent } from './smart-content';

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
    /** The node chosen inside a free section (on the canvas, in the Navigator or here). */
    node: string | null;
    onNode(uid: string | null): void;
    /** "Add inside" pressed on the canvas: the container whose picker should open. */
    addInside?: { uid: string | null; at: number } | null;
    /** An element or layout picked up from the list, to drop on the canvas. */
    onDragNew?(make: (() => NodeData) | null): void;
    /** The screen size being styled in a free section: the same one the preview shows. */
    device: StyleDevice;
    onDevice(device: StyleDevice): void;
    /** The kind of page being edited: a system page's own part explains itself by it. */
    layoutType?: string;
}

export function SectionForm(props: SectionFormProps) {
    const { section, document, language, warnings, onChange, landing, device, onDevice } = props;
    const { messages: m } = useI18n();
    const d = m.design;
    const toast = useToast();
    const [tab, setTab] = useState<'content' | 'style' | 'design'>('content');
    // A free section's open node: its settings take the panel over, so the section's tabs step aside.
    const { node: nodeUid, onNode: setNodeUid } = props;
    const inNode = tab === 'content' && !!nodeUid && !!findNode(section.children ?? [], nodeUid);
    const definition = sectionDefinition(section.type);
    if (!definition) return null;
    if (section.type === PAGE_CONTENT) return <LockedBlock layoutType={props.layoutType} />;
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
            {!inNode && (
                <div role="tablist" className="sticky top-0 z-10 flex border-b border-line bg-surface px-4">
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
                                    ? 'border-accent text-accent'
                                    : 'border-transparent text-ink-muted hover:text-ink',
                            )}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
            {general.length > 0 && (
                <ul className="mx-4 mt-4 space-y-1 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
                    {general.map(item => (
                        <li key={`${item.code}-${item.blockId ?? ''}`}>{d.issues[item.code] ?? item.code}</li>
                    ))}
                </ul>
            )}
            {tab === 'content' ? (
                <div className="space-y-5 p-4">
                    {definition.tree ? (
                        <NodeTree
                            section={section}
                            document={document}
                            language={language}
                            warnings={warnings}
                            onChange={onChange}
                            device={device}
                            onDevice={onDevice}
                            selected={nodeUid}
                            onSelect={setNodeUid}
                            landing={landing}
                            addInside={props.addInside}
                            onDragNew={props.onDragNew}
                        />
                    ) : (
                        <>
                            <SmartContent
                                section={section}
                                document={document}
                                language={language}
                                issueFor={issueFor}
                                apply={(change, key) =>
                                    onChange(updateSection(document, section.uid, change), key)
                                }
                            />
                            <div className="border-t border-line pt-4">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="w-full justify-center"
                                    onClick={() => {
                                        onChange(openUpSection(document, section.uid));
                                        toast.info(d.tree.opened);
                                    }}
                                >
                                    <ElementIcon name="open" className="size-4" />
                                    {d.tree.openUp}
                                </Button>
                                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                                    {opensToElements(section.type)
                                        ? d.tree.openUpHint
                                        : d.tree.openUpLiveHint}
                                </p>
                            </div>
                        </>
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
            <p className="text-sm text-ink-muted">{d.designIntro}</p>
            {DESIGN_GROUPS.map(group => (
                <fieldset
                    key={group.label.en}
                    className="space-y-4 border-t border-line pt-4 first-of-type:border-0 first-of-type:pt-0"
                >
                    <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
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

const BACKGROUND_SWATCH: Record<SectionStyle['background'], string> = {
    none: 'bg-surface',
    subtle: 'bg-surface-muted',
    accent: 'bg-accent',
    dark: 'bg-ink',
    image: 'bg-surface-muted',
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
                <legend className="mb-1.5 text-sm font-medium text-ink">{s.background}</legend>
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
                                        'flex h-9 w-full items-center justify-center rounded border border-line-strong text-ink-faint',
                                        BACKGROUND_SWATCH[choice.value],
                                        on && 'ring-2 ring-accent ring-offset-2',
                                    )}
                                >
                                    {choice.value === 'image' && <ImageIcon className="size-4" aria-hidden />}
                                </span>
                                <span
                                    className={cn(
                                        'text-[11px] leading-tight',
                                        on ? 'font-medium text-ink' : 'text-ink-muted',
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
                    <p className="mb-1.5 text-sm font-medium text-ink">{s.backgroundImage}</p>
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
                <label htmlFor={anchorId} className="mb-1.5 block text-sm font-medium text-ink">
                    {s.anchor}
                </label>
                <div className="flex min-h-11 items-center rounded-md border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-accent">
                    <span className="pl-3 text-ink-muted" aria-hidden>
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
                <p className="mt-1.5 text-xs text-ink-muted">{s.anchorHint}</p>
                {issue && <p className="mt-1 text-xs text-danger">{issue}</p>}
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

/** A system page's own part (phase 60): nothing to set, so the panel says what it is and why. */
function LockedBlock({ layoutType }: { layoutType?: string }) {
    const { messages: m, language } = useI18n();
    const page = layoutType && isSystemLayout(layoutType) ? SYSTEM_PAGES[layoutType] : null;
    if (!page) return null;
    return (
        <div className="space-y-3 p-4">
            <div className="flex items-start gap-3 rounded-md border border-line bg-surface-muted p-3">
                <ElementIcon name="lock" className="mt-0.5 size-5 shrink-0 text-ink-muted" />
                <div className="min-w-0 text-sm">
                    <p className="font-medium text-ink">{pick(page.block, language)}</p>
                    <p className="mt-1 text-ink-muted">{pick(page.blockHint, language)}</p>
                </div>
            </div>
            <p className="text-sm text-ink-muted">
                {page.required ? m.design.system.lockedRequired : m.design.system.lockedOptional}
            </p>
        </div>
    );
}
