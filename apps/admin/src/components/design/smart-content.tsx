import {
    type Bilingual,
    fieldShown,
    type LayoutDocument,
    pick,
    type SectionData,
    sectionDefinition,
} from '@ecommbd/sections';
import { ArrowDown, ArrowUp, ChevronDown, Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { Button } from '../ui/button';
import {
    withBlockAdded,
    withBlockMoved,
    withBlockRemoved,
    withBlockSetting,
    withSetting,
} from './document-ops';
import { FieldControl, type Language } from './field-controls';
import { IconButton } from './icon-button';

/**
 * A ready-made section's own content (roadmap phase 15): its fields, then its blocks such as
 * slides or questions, generated from the section's schema. The same form edits a section on the
 * page and the one inside a free section's live block (phase 56): `apply` says where a change goes.
 */

export interface SmartContentProps {
    section: SectionData;
    document: LayoutDocument;
    language: Language;
    /** The problem to show under a field (of a block, when given). */
    issueFor(field: string, blockUid?: string): string | undefined;
    /** Applies a change to the section. Changes with the same `key` are one undo step. */
    apply(change: (section: SectionData) => SectionData, key?: string): void;
}

export function SmartContent(props: SmartContentProps) {
    const { section, document, language, issueFor, apply } = props;
    const definition = sectionDefinition(section.type);
    if (!definition) return null;
    return (
        <div className="space-y-5">
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
                            apply(
                                item => withSetting(item, name, value),
                                `${section.uid}.${name}.${language}`,
                            )
                        }
                    />
                ) : null,
            )}
            {definition.blocks && <Blocks {...props} />}
        </div>
    );
}

function Blocks({ section, document, language, issueFor, apply }: SmartContentProps) {
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
        <section className="border-t border-line pt-5">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{label}</h3>
                <span className="text-xs text-ink-muted">
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
                                'rounded-md border bg-surface',
                                hasIssue
                                    ? 'border-danger/30'
                                    : expanded
                                      ? 'border-accent ring-1 ring-accent/20'
                                      : 'border-line',
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
                                            'size-4 shrink-0 text-ink-muted transition-transform',
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
                                    onClick={() => apply(item => withBlockMoved(item, index, index - 1))}
                                >
                                    <ArrowUp className="size-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    aria-label={d.moveDown}
                                    disabled={index === section.blocks.length - 1}
                                    onClick={() => apply(item => withBlockMoved(item, index, index + 1))}
                                >
                                    <ArrowDown className="size-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    aria-label={d.duplicate}
                                    disabled={section.blocks.length >= blocks.max}
                                    onClick={() => {
                                        let fresh = '';
                                        apply(item => {
                                            const added = withBlockAdded(item);
                                            const copy = added.blocks.at(-1)!;
                                            fresh = copy.uid;
                                            copy.settings = structuredClone(block.settings);
                                            return withBlockMoved(added, added.blocks.length - 1, index + 1);
                                        });
                                        setOpen(fresh);
                                    }}
                                >
                                    <Copy className="size-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    tone="danger"
                                    aria-label={d.remove}
                                    disabled={section.blocks.length <= (blocks.min ?? 0)}
                                    onClick={() => apply(item => withBlockRemoved(item, block.uid))}
                                >
                                    <Trash2 className="size-4" aria-hidden />
                                </IconButton>
                            </div>
                            {expanded && (
                                <div className="space-y-5 border-t border-line p-3">
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
                                                    apply(
                                                        item =>
                                                            withBlockSetting(item, block.uid, name, value),
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
                    let fresh = '';
                    apply(item => {
                        const added = withBlockAdded(item);
                        fresh = added.blocks.at(-1)!.uid;
                        return added;
                    });
                    setOpen(fresh);
                }}
            >
                <Plus className="size-4" aria-hidden />
                {d.addBlock(label)}
            </Button>
        </section>
    );
}
