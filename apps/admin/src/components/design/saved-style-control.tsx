import {
    mergedStyle,
    newStyleKey,
    type NodeData,
    pasteStyle,
    SAVED_STYLE_LIMIT,
    type SavedStyle,
    savedStyleKind,
    styleCount,
    type ThemeSettings,
} from '@ecommbd/sections';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { AnimatePresence, expand, m } from '../../lib/motion';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { fetchTheme, updateTheme } from './design-api';
import { ElementIcon } from './element-icon';

/**
 * Saved styles on an element's Design tab (roadmap phase 62): pick a named look, save this
 * element's look under a name, or send what was changed here to the saved style, which every
 * element that uses it then follows. The styles are the store's (theme settings), not the page's.
 */

interface SavedStyleControlProps {
    node: NodeData;
    /** Sets the element's saved style and its own style (null: none). */
    onChange(change: Pick<NodeData, 'style'> & { styleRef: string | undefined }): void;
}

export function SavedStyleControl({ node, onChange }: SavedStyleControlProps) {
    const { messages } = useI18n();
    const t = messages.design.styles;
    const toast = useToast();
    const queryClient = useQueryClient();
    const theme = useQuery({ queryKey: ['themeSettings'], queryFn: fetchTheme, staleTime: 60_000 });
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    const kind = savedStyleKind(node.type);
    const save = useMutation({
        mutationFn: (styles: SavedStyle[]) => updateTheme({ ...(theme.data as ThemeSettings), styles }),
        onSuccess: result => {
            if (result.settings) queryClient.setQueryData(['themeSettings'], result.settings);
            else toast.error(messages.errors.generic);
        },
        onError: () => toast.error(messages.errors.generic),
    });
    if (!kind || !theme.data) return null;

    const all = theme.data.styles ?? [];
    const styles = all.filter(style => style.kind === kind);
    const current = styles.find(style => style.key === node.styleRef);
    const ownCount =
        styleCount(node.style, 'base') + styleCount(node.style, 'tablet') + styleCount(node.style, 'phone');
    const full = all.length >= SAVED_STYLE_LIMIT;

    const saveNew = async () => {
        const label = name.trim();
        if (!label) return;
        const key = newStyleKey();
        // The element's whole look: its saved style, if it has one, with its own choices on top.
        const style = pasteStyle(current ? mergedStyle(current.style, node.style) : node.style, node.type);
        const result = await save.mutateAsync([...all, { key, name: label, kind, style }]);
        if (!result.settings) return;
        // The element now takes its look from the style, with nothing of its own on top.
        onChange({ styleRef: key, style: { base: {} } });
        setNaming(false);
        setName('');
        toast.success(t.saved(label));
    };
    const pushChanges = async () => {
        if (!current) return;
        const style = pasteStyle(mergedStyle(current.style, node.style), node.type);
        const result = await save.mutateAsync(
            all.map(item => (item.key === current.key ? { ...item, style } : item)),
        );
        if (!result.settings) return;
        onChange({ styleRef: current.key, style: { base: {} } });
        toast.success(t.updated(current.name));
    };
    const remove = async () => {
        if (!current || !window.confirm(t.deleteConfirm(current.name))) return;
        // This element keeps the look it had; others that used the style go back to their own.
        const style = pasteStyle(mergedStyle(current.style, node.style), node.type);
        const result = await save.mutateAsync(all.filter(item => item.key !== current.key));
        if (!result.settings) return;
        onChange({ styleRef: undefined, style });
        toast.success(t.deleted(current.name));
    };

    return (
        <div className="rounded-md border border-line bg-surface-muted p-3">
            <label htmlFor={`saved-style-${node.uid}`} className="mb-1.5 block text-sm font-medium">
                {t.label}
            </label>
            <div className="flex items-center gap-2">
                <select
                    id={`saved-style-${node.uid}`}
                    value={current?.key ?? ''}
                    onChange={event =>
                        onChange({ styleRef: event.target.value || undefined, style: node.style })
                    }
                    className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-sm outline-none focus:border-accent"
                >
                    <option value="">{t.none}</option>
                    {styles.map(style => (
                        <option key={style.key} value={style.key}>
                            {style.name}
                        </option>
                    ))}
                </select>
                {current && (
                    <button
                        type="button"
                        onClick={() => void remove()}
                        aria-label={t.delete(current.name)}
                        title={t.delete(current.name)}
                        className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface hover:text-danger"
                    >
                        <ElementIcon name="trash" className="size-4" />
                    </button>
                )}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                {current ? (ownCount > 0 ? t.hintChanged : t.hintUsing) : t.hint}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
                {current && ownCount > 0 && (
                    <button
                        type="button"
                        disabled={save.isPending}
                        onClick={() => void pushChanges()}
                        className="text-accent underline-offset-2 hover:underline disabled:opacity-50"
                    >
                        {t.update(current.name)}
                    </button>
                )}
                {!naming && (ownCount > 0 || current) && !full && (
                    <button
                        type="button"
                        onClick={() => setNaming(true)}
                        className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                        {t.saveNew}
                    </button>
                )}
                {full && <span className="font-normal text-ink-muted">{t.full}</span>}
            </div>
            <AnimatePresence initial={false}>
                {naming && (
                    <m.div {...expand} className="overflow-hidden">
                        <div className="mt-2 flex items-center gap-2">
                            <Input
                                autoFocus
                                maxLength={40}
                                value={name}
                                onChange={event => setName(event.target.value)}
                                placeholder={t.namePlaceholder[kind]}
                                aria-label={t.name}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') void saveNew();
                                    if (event.key === 'Escape') setNaming(false);
                                }}
                            />
                            <Button
                                size="sm"
                                loading={save.isPending}
                                disabled={!name.trim()}
                                onClick={() => void saveNew()}
                            >
                                {messages.common.save}
                            </Button>
                        </div>
                    </m.div>
                )}
            </AnimatePresence>
        </div>
    );
}
