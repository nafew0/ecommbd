import {
    type Device,
    DEVICES,
    findNode,
    type LayoutDocument,
    NODE_STYLE_FIELDS,
    type NodeData,
    readClasses,
    type SectionData,
} from '@ecommbd/sections';
import { useId, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Switch } from '../ui/switch';
import { moveNodeTo, moveTargets, nodeName, setNodeStyle, updateNode } from './document-ops';
import { FieldControl, type Language } from './field-controls';

/**
 * A node's Advanced tab (roadmap phase 58): the things most merchants never need, kept out of
 * the way. Move it somewhere else by choosing the place from lists (the way to move without
 * dragging, and the only way on a phone), hide it on a screen size, give it an ID that a button
 * can jump to, a name of its own in the editor, a CSS class, and an opacity.
 */

interface NodeAdvancedProps {
    section: SectionData;
    node: NodeData;
    document: LayoutDocument;
    language: Language;
    onChange(document: LayoutDocument, key?: string): void;
    device: Device;
    /** The problem with the ID, when another section or element already has it. */
    anchorIssue?: string;
}

export function NodeAdvanced({
    section,
    node,
    document,
    language,
    onChange,
    device,
    anchorIssue,
}: NodeAdvancedProps) {
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const t = d.tree;
    const toast = useToast();
    const ids = { name: useId(), to: useId(), at: useId(), anchor: useId(), css: useId() };
    const nodes = section.children ?? [];
    const here = findNode(nodes, node.uid);
    const targets = moveTargets(section, node.uid, ui);
    const [to, setTo] = useState(here?.parent?.uid ?? '');
    const siblings =
        (to ? findNode(nodes, to)?.node.children : nodes)?.filter(item => item.uid !== node.uid) ?? [];
    const [at, setAt] = useState(siblings.length);
    const change = (patch: Partial<NodeData>, key?: string) =>
        onChange(
            updateNode(document, section.uid, node.uid, item => {
                const next = { ...item, ...patch };
                // Empty options are left out of what's stored.
                if (!next.anchor) delete next.anchor;
                if (!next.cssClass) delete next.cssClass;
                if (!next.hideOn?.length) delete next.hideOn;
                return next;
            }),
            key,
        );
    const move = () => {
        const index = Math.min(at, siblings.length);
        // `index` counts the others; the move wants a place among everything there now.
        const list = (to ? findNode(nodes, to)?.node.children : nodes) ?? [];
        const before = siblings[index];
        const place = before ? list.indexOf(before) : list.length;
        const result = moveNodeTo(document, section.uid, node.uid, to || null, place);
        if (result.refused) toast.error(t.refused[result.refused] ?? result.refused);
        else {
            onChange(result.document);
            toast.success(t.moved);
        }
    };
    const title = 'mb-1.5 block text-sm font-medium text-ink';
    return (
        <div className="space-y-6">
            <fieldset className="space-y-3">
                <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    {t.moveTo}
                </legend>
                <div>
                    <label htmlFor={ids.to} className={title}>
                        {t.destination}
                    </label>
                    <Select
                        id={ids.to}
                        value={to}
                        onChange={event => {
                            setTo(event.target.value);
                            setAt(Number.MAX_SAFE_INTEGER);
                        }}
                    >
                        <option value="">{t.topOfSection}</option>
                        {targets.map(target => (
                            <option key={target.uid} value={target.uid}>
                                {target.label}
                            </option>
                        ))}
                    </Select>
                </div>
                <div>
                    <label htmlFor={ids.at} className={title}>
                        {t.position}
                    </label>
                    <Select
                        id={ids.at}
                        value={Math.min(at, siblings.length)}
                        onChange={event => setAt(Number(event.target.value))}
                    >
                        {siblings.map((item, index) => (
                            <option key={item.uid} value={index}>
                                {t.before(nodeName(item, ui))}
                            </option>
                        ))}
                        <option value={siblings.length}>{t.atTheEnd}</option>
                    </Select>
                </div>
                <Button variant="secondary" size="sm" onClick={move}>
                    {t.moveHere}
                </Button>
            </fieldset>

            <fieldset className="space-y-3 border-t border-line pt-5">
                <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    {t.visibility}
                </legend>
                {DEVICES.map(item => (
                    <Switch
                        key={item}
                        checked={node.hideOn?.includes(item) ?? false}
                        onChange={hide =>
                            change({
                                hideOn: DEVICES.filter(name =>
                                    name === item ? hide : node.hideOn?.includes(name),
                                ),
                            })
                        }
                        label={t.hideOn[item] ?? item}
                    />
                ))}
            </fieldset>

            <div className="space-y-5 border-t border-line pt-5">
                <div>
                    <label htmlFor={ids.anchor} className={title}>
                        {d.styleLabels.anchor}
                    </label>
                    <div className="flex min-h-11 items-center rounded-md border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-accent">
                        <span className="pl-3 text-ink-muted" aria-hidden>
                            #
                        </span>
                        <input
                            id={ids.anchor}
                            className="min-w-0 flex-1 bg-transparent py-2 pr-3 pl-1 text-base outline-none"
                            value={node.anchor ?? ''}
                            placeholder="size-guide"
                            aria-invalid={anchorIssue ? true : undefined}
                            // Cleaned as typed; the server trims stray hyphens when it saves.
                            onChange={event =>
                                change(
                                    {
                                        anchor: event.target.value
                                            .toLowerCase()
                                            .replace(/[^a-z0-9-]+/g, '-')
                                            .slice(0, 40),
                                    },
                                    `${node.uid}.anchor`,
                                )
                            }
                        />
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted">{t.anchorHint}</p>
                    {anchorIssue && <p className="mt-1 text-xs text-danger">{anchorIssue}</p>}
                </div>
                <div>
                    <label htmlFor={ids.name} className={title}>
                        {t.rename}
                    </label>
                    <Input
                        id={ids.name}
                        value={node.label}
                        maxLength={60}
                        placeholder={nodeName({ ...node, label: '' }, ui)}
                        onChange={event => change({ label: event.target.value }, `${node.uid}.label`)}
                    />
                    <p className="mt-1.5 text-xs text-ink-muted">{t.renameHint}</p>
                </div>
                <FieldControl
                    field={NODE_STYLE_FIELDS.opacity}
                    value={node.style[device]?.opacity ?? null}
                    language={language}
                    document={document}
                    onChange={value =>
                        onChange(
                            setNodeStyle(document, section.uid, node.uid, device, 'opacity', value),
                            `${node.uid}.style.${device}.opacity`,
                        )
                    }
                />
                <div>
                    <label htmlFor={ids.css} className={title}>
                        {t.cssClass}
                    </label>
                    <Input
                        id={ids.css}
                        defaultValue={node.cssClass ?? ''}
                        key={node.cssClass ?? ''}
                        spellCheck={false}
                        className="font-mono"
                        placeholder="my-class"
                        onBlur={event => {
                            const cssClass = readClasses(event.target.value);
                            if (cssClass !== (node.cssClass ?? '')) change({ cssClass });
                        }}
                    />
                    <p className="mt-1.5 text-xs text-ink-muted">{t.cssClassHint}</p>
                </div>
            </div>
        </div>
    );
}
