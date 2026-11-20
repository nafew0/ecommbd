import { copySection, type LayoutDocument, PAGE_CONTENT, type SectionData } from '@ecommbd/sections';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { m, rise } from '../../lib/motion';
import { useToast } from '../../lib/toast';
import { deleteSavedSection, fetchSavedSections, type SavedSection, updateSaved } from './design-api';
import { ElementIcon } from './element-icon';
import { IconButton } from './icon-button';
import { SectionThumbnail } from './section-thumbnail';

/**
 * My library (roadmap phase 59): what this store saved for itself. Three kinds: a **section** to
 * copy, a **linked section** (every page that uses it shows the library's copy, so one edit
 * reaches all of them) and a **page** (a whole page's sections, to start another page from).
 * Search, sort, and favourites that stay on top.
 */

type Kind = 'all' | SavedSection['kind'];
type Sort = 'newest' | 'name';

interface MyLibraryProps {
    /** Section types this kind of page can hold. */
    allowed: ReadonlySet<string>;
    /** Whole-page templates make sense on pages a merchant designs from nothing. */
    pages: boolean;
    onAdd(section: SectionData): void;
    onDesign(document: LayoutDocument, name: string): void;
    onClose(): void;
}

export function MyLibrary({ allowed, pages, onAdd, onDesign, onClose }: MyLibraryProps) {
    const { messages } = useI18n();
    const d = messages.design;
    const t = d.mine;
    const toast = useToast();
    const queryClient = useQueryClient();
    const [kind, setKind] = useState<Kind>('all');
    const [sort, setSort] = useState<Sort>('newest');
    const [search, setSearch] = useState('');
    const saved = useQuery({ queryKey: ['savedSections'], queryFn: fetchSavedSections });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['savedSections'] });
    const remove = useMutation({
        mutationFn: deleteSavedSection,
        onSuccess: refresh,
        onError: () => toast.error(messages.errors.generic),
    });
    const star = useMutation({
        mutationFn: (item: SavedSection) => updateSaved(item.id, { favourite: !item.favourite }),
        onSuccess: refresh,
        onError: () => toast.error(messages.errors.generic),
    });

    const all = (saved.data ?? []).filter(item =>
        item.kind === 'page' ? pages : allowed.has(item.section.type),
    );
    const words = search.trim().toLowerCase();
    const shown = all
        .filter(item => kind === 'all' || item.kind === kind)
        .filter(item => !words || item.name.toLowerCase().includes(words))
        .sort((a, b) => {
            // Favourites first, then the chosen order.
            if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
            return sort === 'name' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt);
        });
    const count = (key: Kind) => (key === 'all' ? all.length : all.filter(item => item.kind === key).length);
    const kinds: Kind[] = pages ? ['all', 'section', 'global', 'page'] : ['all', 'section', 'global'];

    const use = (item: SavedSection) => {
        if (item.kind === 'page' && item.document) {
            const sections = item.document.sections
                .filter(section => section.type !== PAGE_CONTENT && allowed.has(section.type))
                .map(copySection);
            onDesign({ sections }, item.name);
        } else if (item.kind === 'global') {
            onAdd({ ...copySection(item.section), linked: item.id });
        } else {
            onAdd(copySection(item.section));
        }
        onClose();
    };
    const confirmRemove = (item: SavedSection) => {
        if (item.kind !== 'global' || window.confirm(t.deleteLinkedConfirm)) remove.mutate(item.id);
    };

    if (saved.data && all.length === 0) {
        return (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
                <ElementIcon name="copy" className="size-6 text-ink-faint" />
                <p className="font-medium text-ink">{t.emptyTitle}</p>
                <p className="text-sm text-ink-muted">{t.emptyBody}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder={t.search}
                    aria-label={t.search}
                    className="h-9 min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent"
                />
                <select
                    value={sort}
                    onChange={event => setSort(event.target.value as Sort)}
                    aria-label={t.sort}
                    className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm outline-none focus:border-accent"
                >
                    <option value="newest">{t.sortNewest}</option>
                    <option value="name">{t.sortName}</option>
                </select>
            </div>
            <div role="radiogroup" aria-label={t.kindLabel} className="flex flex-wrap gap-1.5">
                {kinds.map(key => (
                    <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={kind === key}
                        onClick={() => setKind(key)}
                        className={cn(
                            'flex h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition-colors',
                            kind === key
                                ? 'bg-ink text-surface'
                                : 'bg-surface-muted text-ink-muted hover:text-ink',
                        )}
                    >
                        {t.kinds[key]}
                        <span className="tabular-nums opacity-70">{count(key)}</span>
                    </button>
                ))}
            </div>
            {kind === 'global' && <p className="text-sm text-ink-muted">{t.linkedHint}</p>}
            {shown.length === 0 ? (
                <p className="py-10 text-center text-sm text-ink-muted">{t.nothingFound}</p>
            ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {shown.map((item, index) => (
                        <m.li
                            key={item.id}
                            {...rise}
                            transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.025 }}
                            className="relative"
                        >
                            <button
                                type="button"
                                onClick={() => use(item)}
                                aria-label={`${t.use[item.kind]}: ${item.name}`}
                                className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left transition hover:border-accent hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent"
                            >
                                <span className="block border-b border-line bg-surface-muted p-2">
                                    <SectionThumbnail
                                        type={item.section.type}
                                        className="aspect-[16/10] w-full rounded ring-1 ring-line"
                                    />
                                </span>
                                <span className="block p-3 pb-10">
                                    <span className="block truncate text-sm font-medium text-ink">
                                        {item.name}
                                    </span>
                                    <span className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
                                        {item.kind !== 'section' && (
                                            <ElementIcon
                                                name={item.kind === 'global' ? 'link' : 'page'}
                                                className="size-3.5"
                                            />
                                        )}
                                        {item.kind === 'page'
                                            ? t.pageOf(item.document?.sections.length ?? 0)
                                            : t.kindOf[item.kind]}
                                    </span>
                                </span>
                            </button>
                            <span className="absolute right-1.5 bottom-1.5 left-1.5 flex justify-between">
                                <IconButton
                                    aria-label={`${item.favourite ? t.unfavourite : t.favourite}: ${item.name}`}
                                    aria-pressed={item.favourite}
                                    title={item.favourite ? t.unfavourite : t.favourite}
                                    onClick={() => star.mutate(item)}
                                    className={cn(item.favourite && 'text-warn')}
                                >
                                    <svg
                                        viewBox="0 0 20 20"
                                        className="size-4"
                                        fill={item.favourite ? 'currentColor' : 'none'}
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinejoin="miter"
                                        aria-hidden
                                    >
                                        <path d="M10 2.75l2.2 4.6 5.05.7-3.65 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.65-3.5 5.05-.7z" />
                                    </svg>
                                </IconButton>
                                <IconButton
                                    tone="danger"
                                    aria-label={`${d.deleteSaved}: ${item.name}`}
                                    title={d.deleteSaved}
                                    onClick={() => confirmRemove(item)}
                                >
                                    <ElementIcon name="trash" className="size-4" />
                                </IconButton>
                            </span>
                        </m.li>
                    ))}
                </ul>
            )}
        </div>
    );
}
