import {
    contrastRatio,
    type Device,
    DEVICES,
    effectiveStyle,
    elementDefinition,
    type Field,
    fieldShown,
    inheritedFrom,
    type LayoutDocument,
    NODE_STYLE_FIELDS,
    type NodeData,
    type NodeStyleProp,
    pasteStyle,
    type SectionData,
    styleCount,
    styleGroupsFor,
    withoutDevice,
} from '@ecommbd/sections';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { AnimatePresence, expand, m } from '../../lib/motion';
import { useToast } from '../../lib/toast';
import { Input } from '../ui/input';
import { fetchTheme, type LayoutWarning } from './design-api';
import { nodePath, setNodeProp, setNodeStyle, updateNode } from './document-ops';
import { ElementIcon } from './element-icon';
import { FieldControl, type Language } from './field-controls';
import { SmartContent } from './smart-content';

/**
 * One node's settings (roadmap phases 56 and 57). **Content** is generated from the element's
 * schema. **Design** is the node's look for the screen size chosen in the editor's top bar: the
 * same switch sizes the preview, so what is being styled is always what is being looked at.
 * Groups are closed until opened, a dot marks what is set on this screen size, and anything not
 * set follows the wider screen, then the theme.
 */

interface NodeSettingsProps {
    section: SectionData;
    node: NodeData;
    document: LayoutDocument;
    language: Language;
    warnings: LayoutWarning[];
    onChange(document: LayoutDocument, key?: string): void;
    device: Device;
    onDevice(device: Device): void;
    /** A container's own contents, drawn by the tree. */
    inside?: ReactNode;
}

const DEVICE_ICON: Record<Device, string> = { base: 'desktop', tablet: 'tablet', phone: 'phone' };
const CLIPBOARD = 'ecommbd:design-clipboard';
/** Below this, text is hard to read on its background (WCAG AA for body text). */
const READABLE = 4.5;

export function NodeSettings(props: NodeSettingsProps) {
    const { section, node, document, language, warnings, onChange, device, onDevice, inside } = props;
    const { messages: m_, language: ui } = useI18n();
    const d = m_.design;
    const t = d.tree;
    const toast = useToast();
    const [tab, setTab] = useState<'content' | 'design'>('content');
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<string | null>(null);
    const theme = useQuery({ queryKey: ['themeSettings'], queryFn: fetchTheme, staleTime: 60_000 });
    const definition = elementDefinition(node.type)!;
    const groups = styleGroupsFor(node.type);
    const digits = (text: string) =>
        ui === 'bn' ? text.replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : text;

    const issue = (field: string) => {
        const warning = warnings.find(
            item => item.sectionId === section.uid && item.blockId === node.uid && item.field === field,
        );
        return warning ? (d.issues[warning.code] ?? warning.code) : undefined;
    };

    const contentField = (name: string, field: Field) =>
        fieldShown(field, node.props) ? (
            <FieldControl
                key={`${node.uid}-${name}`}
                field={field}
                value={node.props[name]}
                language={language}
                document={document}
                issue={issue(name)}
                onChange={value =>
                    onChange(
                        setNodeProp(document, section.uid, node.uid, name, value),
                        `${node.uid}.${name}.${language}`,
                    )
                }
            />
        ) : null;

    /** A value as the panel says it: "40 px", "Bold", "#112233". */
    const say = (name: NodeStyleProp, value: unknown) => {
        const field: Field = NODE_STYLE_FIELDS[name];
        if (field.kind === 'select') {
            return field.options.find(option => option.value === value)?.label[ui] ?? String(value);
        }
        if (field.kind === 'size') return digits(`${String(value)} ${field.unit === 'x' ? '×' : field.unit}`);
        return String(value);
    };

    // The theme's own colours come first when picking one, then black and white.
    const palette = [
        ...new Set(
            [...Object.values(theme.data?.colours ?? {}), '#ffffff', '#000000'].map(hex => hex.toLowerCase()),
        ),
    ].filter(hex => /^#[0-9a-f]{6}$/.test(hex));

    const styleField = (name: NodeStyleProp) => {
        const field: Field = NODE_STYLE_FIELDS[name];
        const own = node.style[device]?.[name];
        const from = own === undefined ? inheritedFrom(node.style, device, name) : null;
        const set = (value: unknown) =>
            onChange(
                setNodeStyle(document, section.uid, node.uid, device, name, value),
                `${node.uid}.style.${device}.${name}`,
            );
        return (
            <div key={`${node.uid}-${device}-${name}`} className="relative">
                {own !== undefined && (
                    <span
                        className="absolute top-1.5 -left-3 size-1.5 rounded-full bg-accent"
                        title={t.setHere}
                        aria-label={t.setHere}
                    />
                )}
                <FieldControl
                    field={field}
                    value={own ?? (field.kind === 'size' ? null : '')}
                    language={language}
                    document={document}
                    onChange={set}
                />
                {field.kind === 'hex' && (
                    <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={t.themeColours}>
                        {palette.map(hex => (
                            <button
                                key={hex}
                                type="button"
                                title={hex}
                                aria-label={`${field.label[ui]}: ${hex}`}
                                aria-pressed={own === hex}
                                onClick={() => set(hex)}
                                style={{ backgroundColor: hex }}
                                className={cn(
                                    'size-6 rounded-sm border border-line-strong transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                                    own === hex && 'ring-2 ring-ink ring-offset-1',
                                )}
                            />
                        ))}
                    </div>
                )}
                {from && (
                    <p className="mt-1 text-xs text-ink-muted">
                        {t.from(t.devices[from] ?? from, say(name, node.style[from]![name]))}
                    </p>
                )}
            </div>
        );
    };

    // The text colour and the background behind it: this node's, else the nearest container's,
    // else the section's own Design colours.
    const chain = nodePath(section.children ?? [], node.uid).reverse();
    const nearest = (name: 'color' | 'background', fallback: string) =>
        chain.map(item => effectiveStyle(item.style, device)[name]).find(Boolean) ?? fallback;
    const ink = nearest('color', section.style.design.text);
    const paper = nearest('background', section.style.design.background);
    const lowContrast = !!ink && !!paper && contrastRatio(ink, paper) < READABLE;

    const matches = (label: string) => label.toLowerCase().includes(query.trim().toLowerCase());
    const searching = query.trim() !== '';
    const found = searching
        ? {
              content: Object.entries(definition.fields).filter(([, field]) => matches(field.label[ui])),
              style: groups
                  .flatMap(group => group.props)
                  .filter(name => matches(NODE_STYLE_FIELDS[name].label[ui])),
          }
        : null;

    const copyDesign = () => {
        try {
            window.localStorage.setItem(CLIPBOARD, JSON.stringify(node.style));
            toast.success(t.designCopied);
        } catch {
            toast.error(t.clipboardBlocked);
        }
    };
    const pasteDesign = () => {
        let copied: unknown = null;
        try {
            copied = JSON.parse(window.localStorage.getItem(CLIPBOARD) ?? 'null');
        } catch {
            // Nothing usable there.
        }
        if (!copied) {
            toast.info(t.nothingCopied);
            return;
        }
        onChange(
            updateNode(document, section.uid, node.uid, item => ({
                ...item,
                style: pasteStyle(copied, item.type),
            })),
        );
        toast.success(t.designPasted);
    };

    const content = node.section ? (
        <>
            <p className="text-sm text-ink-muted">{t.liveHint}</p>
            <SmartContent
                section={node.section}
                document={document}
                language={language}
                issueFor={issue}
                apply={(change, key) =>
                    onChange(
                        updateNode(document, section.uid, node.uid, item => ({
                            ...item,
                            section: change(item.section!),
                        })),
                        key,
                    )
                }
            />
        </>
    ) : (
        Object.entries(definition.fields).map(([name, field]) => contentField(name, field))
    );

    return (
        <div className="space-y-4">
            {groups.length > 0 && (
                <div className="space-y-3">
                    <Input
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={t.searchSettings}
                        aria-label={t.searchSettings}
                    />
                    {!searching && (
                        <div role="tablist" className="flex rounded-md bg-surface-muted p-0.5">
                            {(['content', 'design'] as const).map(key => (
                                <button
                                    key={key}
                                    type="button"
                                    role="tab"
                                    aria-selected={tab === key}
                                    onClick={() => setTab(key)}
                                    className={cn(
                                        'h-8 flex-1 rounded text-sm font-medium transition-colors',
                                        tab === key
                                            ? 'bg-surface text-ink shadow-sm'
                                            : 'text-ink-muted hover:text-ink',
                                    )}
                                >
                                    {key === 'content' ? d.content : d.designTab}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {found ? (
                <div className="space-y-5 pl-3">
                    {found.content.map(([name, field]) => contentField(name, field))}
                    {found.style.map(styleField)}
                    {found.content.length + found.style.length === 0 && (
                        <p className="text-sm text-ink-muted">{t.noSettingsFound}</p>
                    )}
                </div>
            ) : tab === 'content' || groups.length === 0 ? (
                <div className="space-y-5">
                    {content}
                    {inside}
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div
                            className="flex rounded-md bg-surface-muted p-0.5"
                            role="radiogroup"
                            aria-label={t.device}
                        >
                            {DEVICES.map(item => {
                                const count = styleCount(node.style, item);
                                return (
                                    <button
                                        key={item}
                                        type="button"
                                        role="radio"
                                        aria-checked={device === item}
                                        aria-label={
                                            count
                                                ? `${t.devices[item]} (${digits(String(count))})`
                                                : t.devices[item]
                                        }
                                        title={t.devices[item]}
                                        onClick={() => onDevice(item)}
                                        className={cn(
                                            'flex h-8 items-center gap-1 rounded px-2.5 text-xs font-medium tabular-nums transition-colors',
                                            device === item
                                                ? 'bg-surface text-ink shadow-sm'
                                                : 'text-ink-muted hover:text-ink',
                                        )}
                                    >
                                        <ElementIcon name={DEVICE_ICON[item]!} className="size-4" />
                                        {count > 0 && digits(String(count))}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-3 text-xs font-medium">
                            <button
                                type="button"
                                onClick={copyDesign}
                                className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                            >
                                {t.copyDesign}
                            </button>
                            <button
                                type="button"
                                onClick={pasteDesign}
                                className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                            >
                                {t.pasteDesign}
                            </button>
                        </div>
                    </div>
                    <p className="text-xs leading-relaxed text-ink-muted">
                        {t.deviceNote[device]}{' '}
                        {styleCount(node.style, device) > 0 && (
                            <button
                                type="button"
                                onClick={() =>
                                    onChange(
                                        updateNode(document, section.uid, node.uid, item => ({
                                            ...item,
                                            style: withoutDevice(item.style, device),
                                        })),
                                    )
                                }
                                className="font-medium text-ink underline underline-offset-2"
                            >
                                {t.resetDevice[device]}
                            </button>
                        )}
                    </p>
                    {lowContrast && <p className="text-sm text-danger">{t.lowContrast}</p>}
                    <ul className="-mx-4 border-t border-line">
                        {groups.map((group, index) => {
                            const key = `${node.type}-${group.key}`;
                            // The first group starts open: it's the one most often wanted.
                            const expanded = open === null ? index === 0 : open === key;
                            const count = group.props.filter(
                                name => node.style[device]?.[name] !== undefined,
                            ).length;
                            return (
                                <li key={group.key} className="border-b border-line">
                                    <button
                                        type="button"
                                        aria-expanded={expanded}
                                        onClick={() => setOpen(expanded ? '' : key)}
                                        className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-medium text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                                    >
                                        <ElementIcon
                                            name="chevron"
                                            className={cn(
                                                'size-4 text-ink-muted transition-transform duration-200',
                                                expanded && 'rotate-90',
                                            )}
                                        />
                                        <span className="flex-1">{group.label[ui]}</span>
                                        {count > 0 && (
                                            <span className="text-xs font-normal text-ink-muted tabular-nums">
                                                {t.setCount(digits(String(count)))}
                                            </span>
                                        )}
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {expanded && (
                                            <m.div {...expand} className="overflow-hidden">
                                                <div className="space-y-5 px-4 pt-1 pb-5 pl-7">
                                                    {group.props.map(styleField)}
                                                </div>
                                            </m.div>
                                        )}
                                    </AnimatePresence>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}
