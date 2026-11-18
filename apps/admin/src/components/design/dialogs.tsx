import {
    type CheckItem,
    type CheckLevel,
    createSection,
    copySection,
    LANDING_CATEGORIES,
    LANDING_CATEGORY_NAMES,
    LANDING_TEMPLATES,
    type LayoutDocument,
    type LayoutType,
    PAGE_DESIGNS,
    pick,
    READY_CATEGORIES,
    READY_CATEGORY_NAMES,
    type ReadyCategory,
    readySectionsFor,
    SECTION_CATEGORIES,
    type SectionData,
    sectionsFor,
    STARTER_INFO,
    starterLayout,
    STARTERS,
    STORE_DESIGNS,
    STORE_TYPE_NAMES,
    STORE_TYPES,
    type StoreType,
} from '@ecommbd/sections';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Check, Copy, ExternalLink, LayoutTemplate, MessageCircle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Select } from '../ui/input';
import {
    createPreviewLink,
    deleteSavedSection,
    fetchSavedSections,
    fetchStoreLogo,
    fetchVersions,
    type LayoutConflict,
    saveSection,
} from './design-api';
import { IconButton } from './icon-button';
import { SectionIcon } from './section-icon';
import { SectionThumbnail } from './section-thumbnail';

/** The page editor's dialogs (roadmap phase 15). */

export type LibraryTab = 'ready' | 'sections' | 'saved' | 'templates';

/**
 * "Add section" (phases 15 and 59): ready sections first, filtered by the kind of store and by
 * category; then the plain section types, the merchant's saved sections, and whole designs (home
 * pages for each kind of store, ready pages, sales page templates).
 */
export function AddSectionDialog({
    open,
    onClose,
    layoutType,
    onAdd,
    onDesign,
    onLandingTemplate,
    initialTab = 'ready',
}: {
    open: boolean;
    onClose(): void;
    layoutType: LayoutType;
    onAdd(section: SectionData): void;
    /** A whole design chosen: the page's sections are replaced by it (the editor lets it be tried first). */
    onDesign(document: LayoutDocument, name: string): void;
    /** Sales pages (phase 16) pick from their own templates. */
    onLandingTemplate?(id: string): void;
    initialTab?: LibraryTab;
}) {
    const { messages: m, language } = useI18n();
    const d = m.design;
    const [tab, setTab] = useState<LibraryTab>(initialTab);
    const queryClient = useQueryClient();
    const saved = useQuery({ queryKey: ['savedSections'], queryFn: fetchSavedSections, enabled: open });
    const remove = useMutation({
        mutationFn: deleteSavedSection,
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['savedSections'] }),
    });
    const definitions = sectionsFor(layoutType);
    const [storeType, setStoreType] = useState<StoreType | 'all'>('all');
    const [category, setCategory] = useState<ReadyCategory | 'all'>('all');
    const [search, setSearch] = useState('');
    const store = useQuery({
        queryKey: ['storeLogo'],
        queryFn: fetchStoreLogo,
        enabled: open,
        staleTime: 60_000,
    });
    const storeInfo = { name: store.data ? pick(store.data.storeName, language) : '', description: '' };
    const words = search.trim().toLowerCase();
    // Ready sections are ordinary sections: only those this kind of page can hold are offered.
    const allowed = new Set(definitions.map(definition => definition.type));
    const readyList = readySectionsFor(storeType, category).filter(
        item =>
            !words ||
            `${item.name.bn} ${item.name.en} ${item.description.bn} ${item.description.en}`
                .toLowerCase()
                .includes(words),
    );
    const tabs: Array<{ key: LibraryTab; label: string }> = [
        { key: 'ready', label: d.lib.ready },
        { key: 'sections', label: d.sections },
        { key: 'saved', label: d.savedSections },
        ...(layoutType !== 'product' ? [{ key: 'templates' as const, label: d.templates }] : []),
    ];
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={d.library}
            description={d.libraryDescription}
            size="wide"
        >
            <div role="tablist" className="-mt-1 mb-4 flex gap-1 border-b border-line">
                {tabs.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => setTab(item.key)}
                        className={cn(
                            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                            tab === item.key
                                ? 'border-accent text-accent'
                                : 'border-transparent text-ink-muted hover:text-ink',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            {tab === 'ready' && (
                <div>
                    <div className="mb-4 flex flex-wrap items-end gap-3">
                        <div className="min-w-44 flex-1">
                            <label
                                htmlFor="ready-store-type"
                                className="mb-1.5 block text-sm font-medium text-ink"
                            >
                                {d.lib.storeType}
                            </label>
                            <Select
                                id="ready-store-type"
                                value={storeType}
                                onChange={event => setStoreType(event.target.value as StoreType | 'all')}
                            >
                                <option value="all">{d.lib.allStoreTypes}</option>
                                {STORE_TYPES.map(type => (
                                    <option key={type} value={type}>
                                        {pick(STORE_TYPE_NAMES[type], language)}
                                    </option>
                                ))}
                            </Select>
                        </div>
                        <div className="min-w-44 flex-1">
                            <label
                                htmlFor="ready-search"
                                className="mb-1.5 block text-sm font-medium text-ink"
                            >
                                {d.lib.search}
                            </label>
                            <Input
                                id="ready-search"
                                type="search"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </div>
                    </div>
                    <div
                        className="mb-4 flex flex-wrap gap-1.5"
                        role="radiogroup"
                        aria-label={d.lib.category}
                    >
                        {(['all', ...READY_CATEGORIES] as const).map(item => (
                            <button
                                key={item}
                                type="button"
                                role="radio"
                                aria-checked={category === item}
                                onClick={() => setCategory(item)}
                                className={cn(
                                    'min-h-9 rounded-md border px-3 text-sm font-medium transition-colors',
                                    category === item
                                        ? 'border-ink bg-ink text-white'
                                        : 'border-line-strong bg-surface text-ink hover:border-ink',
                                )}
                            >
                                {item === 'all'
                                    ? d.lib.allCategories
                                    : pick(READY_CATEGORY_NAMES[item], language)}
                            </button>
                        ))}
                    </div>
                    <p className="mb-3 text-xs text-ink-muted">{d.lib.readyCount(readyList.length)}</p>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {readyList.map(item => {
                            // Built once to know what it is; added fresh, with new IDs, when chosen.
                            const sample = item.build();
                            if (!allowed.has(sample.type)) return null;
                            return (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onAdd(item.build());
                                            onClose();
                                        }}
                                        className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left transition hover:border-ink hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent"
                                    >
                                        <span className="block border-b border-line bg-surface-muted p-2">
                                            <SectionThumbnail
                                                type={sample.type}
                                                className="aspect-[16/10] w-full rounded shadow-sm ring-1 ring-line"
                                            />
                                        </span>
                                        <span className="flex flex-1 flex-col gap-0.5 p-3">
                                            <span className="text-sm font-medium">
                                                {pick(item.name, language)}
                                            </span>
                                            <span className="text-xs leading-snug text-ink-muted">
                                                {pick(item.description, language)}
                                            </span>
                                            <span className="mt-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                                                {pick(READY_CATEGORY_NAMES[item.category], language)}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {readyList.length === 0 && (
                        <p className="py-10 text-center text-ink-muted">{d.lib.noneFound}</p>
                    )}
                </div>
            )}
            {tab === 'sections' && (
                <div className="space-y-6">
                    {SECTION_CATEGORIES.map(category => {
                        const items = definitions.filter(definition => definition.category === category);
                        if (!items.length) return null;
                        return (
                            <section key={category}>
                                <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                                    {d.categories[category]}
                                </h3>
                                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                                    {items.map(definition => (
                                        <li key={definition.type}>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onAdd(createSection(definition.type));
                                                    onClose();
                                                }}
                                                className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left transition hover:border-accent hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent"
                                            >
                                                <span className="block border-b border-line bg-surface-muted p-2">
                                                    <SectionThumbnail
                                                        type={definition.type}
                                                        className="aspect-[16/10] w-full rounded shadow-sm ring-1 ring-line transition group-hover:ring-accent/40"
                                                    />
                                                </span>
                                                <span className="flex flex-1 flex-col gap-0.5 p-3">
                                                    <span className="flex items-center gap-1.5 text-sm font-medium">
                                                        <SectionIcon
                                                            type={definition.type}
                                                            className="size-4 text-accent"
                                                        />
                                                        {pick(definition.name, language)}
                                                    </span>
                                                    <span className="text-xs leading-snug text-ink-muted">
                                                        {pick(definition.description, language)}
                                                    </span>
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            )}
            {tab === 'saved' && (
                <div>
                    {saved.data?.length === 0 && (
                        <div className="flex flex-col items-center gap-2 py-12 text-center text-ink-muted">
                            <Bookmark className="size-6 text-ink-faint" aria-hidden />
                            <p>{d.noSavedSections}</p>
                        </div>
                    )}
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {saved.data?.map(item => (
                            <li key={item.id} className="relative">
                                <button
                                    type="button"
                                    onClick={() => {
                                        onAdd(copySection(item.section));
                                        onClose();
                                    }}
                                    className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left transition hover:border-accent hover:shadow-md"
                                >
                                    <span className="block border-b border-line bg-surface-muted p-2">
                                        <SectionThumbnail
                                            type={item.section.type}
                                            className="aspect-[16/10] w-full rounded ring-1 ring-line"
                                        />
                                    </span>
                                    <span className="p-3 pr-10 text-sm font-medium">{item.name}</span>
                                </button>
                                <IconButton
                                    tone="danger"
                                    className="absolute right-1.5 bottom-1.5"
                                    aria-label={`${d.deleteSaved}: ${item.name}`}
                                    onClick={() => remove.mutate(item.id)}
                                >
                                    <Trash2 className="size-4" aria-hidden />
                                </IconButton>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {tab === 'templates' && layoutType === 'landing' && (
                <div className="space-y-6">
                    <p className="text-sm text-ink-muted">{d.landingTemplatesDescription}</p>
                    {LANDING_CATEGORIES.map(category => (
                        <section key={category}>
                            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                                {pick(LANDING_CATEGORY_NAMES[category], language)}
                            </h3>
                            <ul className="grid gap-3 sm:grid-cols-2">
                                {LANDING_TEMPLATES.filter(template => template.category === category).map(
                                    template => (
                                        <li key={template.id}>
                                            <LandingTemplateCard
                                                id={template.id}
                                                onPick={() => {
                                                    onLandingTemplate?.(template.id);
                                                    onClose();
                                                }}
                                            />
                                        </li>
                                    ),
                                )}
                            </ul>
                        </section>
                    ))}
                </div>
            )}
            {tab === 'templates' && layoutType !== 'landing' && (
                <div>
                    <p className="mb-4 text-sm text-ink-muted">{d.lib.designsDescription}</p>
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {(layoutType === 'page'
                            ? PAGE_DESIGNS.map(design => ({
                                  id: design.id,
                                  name: pick(design.name, language),
                                  description: pick(design.description, language),
                                  build: () => design.build(storeInfo),
                              }))
                            : [
                                  ...STORE_DESIGNS.map(design => ({
                                      id: design.id,
                                      name: pick(design.name, language),
                                      description: pick(design.description, language),
                                      build: () => design.build(storeInfo),
                                  })),
                                  ...STARTERS.map(name => ({
                                      id: `starter-${name}`,
                                      name: pick(STARTER_INFO[name].name, language),
                                      description: pick(STARTER_INFO[name].description, language),
                                      build: () => starterLayout(name),
                                  })),
                              ]
                        ).map(design => {
                            const types = design
                                .build()
                                .sections.filter(section => !section.hidden)
                                .map(section => section.type);
                            return (
                                <li key={design.id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onDesign(design.build(), design.name);
                                            onClose();
                                        }}
                                        className="group flex h-full w-full gap-3 rounded-lg border border-line bg-surface p-3 text-left transition hover:border-ink hover:shadow-md"
                                    >
                                        <span className="flex w-24 shrink-0 flex-col gap-1 rounded bg-surface-muted p-1.5 ring-1 ring-line">
                                            {types.slice(0, 5).map((type, index) => (
                                                <SectionThumbnail
                                                    key={`${type}-${index}`}
                                                    type={type}
                                                    className="w-full rounded-sm"
                                                />
                                            ))}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="flex items-center gap-1.5 font-medium">
                                                <LayoutTemplate
                                                    className="size-4 text-ink-muted"
                                                    aria-hidden
                                                />
                                                {design.name}
                                            </span>
                                            <span className="mt-1 block text-sm text-ink-muted">
                                                {design.description}
                                            </span>
                                            <span className="mt-3 inline-flex text-sm font-medium text-ink underline-offset-2 group-hover:underline">
                                                {d.lib.tryDesign}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </Dialog>
    );
}

/** A sales page template (phase 16): its sections in miniature, its name and what it's for. */
export function LandingTemplateCard({
    id,
    onPick,
    selected = false,
}: {
    id: string;
    onPick(): void;
    selected?: boolean;
}) {
    const { messages: m, language } = useI18n();
    const template = LANDING_TEMPLATES.find(item => item.id === id)!;
    const types = template
        .build({ name: { bn: '', en: '' } })
        .sections.filter(section => !section.hidden)
        .map(section => section.type);
    return (
        <button
            type="button"
            onClick={onPick}
            aria-pressed={selected}
            className={cn(
                'group flex w-full gap-3 rounded-lg border bg-surface p-3 text-left transition hover:border-accent hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent',
                selected ? 'border-accent ring-2 ring-accent/30' : 'border-line',
            )}
        >
            <span className="flex w-20 shrink-0 flex-col gap-1 rounded bg-surface-muted p-1.5 ring-1 ring-line">
                {types.slice(0, 5).map((type, index) => (
                    <SectionThumbnail key={`${type}-${index}`} type={type} className="w-full rounded-sm" />
                ))}
            </span>
            <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                    {selected ? (
                        <Check className="size-4 text-accent" aria-hidden />
                    ) : (
                        <LayoutTemplate className="size-4 text-accent" aria-hidden />
                    )}
                    {pick(template.name, language)}
                </span>
                <span className="mt-1 block text-sm text-ink-muted">
                    {pick(template.description, language)}
                </span>
                <span className="mt-2 block text-xs text-ink-muted">
                    {m.design.sectionCountShort(types.length)}
                </span>
            </span>
        </button>
    );
}

export function SaveSectionDialog({ section, onClose }: { section: SectionData | null; onClose(): void }) {
    const { messages: m } = useI18n();
    const d = m.design;
    const toast = useToast();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const save = useMutation({
        mutationFn: () => saveSection(name, section!),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['savedSections'] });
            toast.success(d.sectionSaved);
            setName('');
            onClose();
        },
        onError: () => toast.error(m.errors.generic),
    });
    return (
        <Dialog
            open={!!section}
            onClose={onClose}
            title={d.saveSectionTitle}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        {m.common.cancel}
                    </Button>
                    <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
                        {m.common.save}
                    </Button>
                </>
            }
        >
            <label className="mb-1.5 block text-sm font-medium" htmlFor="saved-section-name">
                {d.saveSectionName}
            </label>
            <Input
                id="saved-section-name"
                autoFocus
                maxLength={80}
                value={name}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => {
                    if (event.key === 'Enter' && name.trim()) save.mutate();
                }}
            />
        </Dialog>
    );
}

export function HistoryDialog({
    open,
    onClose,
    layoutId,
    publishedVersion,
    onRestore,
}: {
    open: boolean;
    onClose(): void;
    layoutId: string;
    publishedVersion: number;
    onRestore(version: number): Promise<void>;
}) {
    const { messages: m, language } = useI18n();
    const d = m.design;
    const format = useFormat();
    const versions = useQuery({
        queryKey: ['layoutVersions', layoutId, publishedVersion],
        queryFn: () => fetchVersions(layoutId),
        enabled: open,
    });
    const [busy, setBusy] = useState<number | null>(null);
    const digits = (n: number) =>
        language === 'bn' ? String(n).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(n);
    return (
        <Dialog open={open} onClose={onClose} title={d.historyTitle} description={d.historyDescription}>
            {versions.data?.length === 0 && <p className="py-8 text-center text-ink-muted">{d.noHistory}</p>}
            <ol className="relative space-y-1 border-l border-line pl-5">
                {versions.data?.map(item => (
                    <li
                        key={item.version}
                        className="relative flex items-center gap-3 rounded-md py-2 pr-1 hover:bg-surface-muted"
                    >
                        <span
                            className={cn(
                                'absolute top-1/2 -left-[26px] size-3 -translate-y-1/2 rounded-full border-2 border-white',
                                item.version === publishedVersion ? 'bg-accent' : 'bg-line',
                            )}
                            aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 font-medium">
                                {d.version(digits(item.version))}
                                {item.version === publishedVersion && (
                                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                                        {d.liveNow}
                                    </span>
                                )}
                            </p>
                            <p className="truncate text-sm text-ink-muted">
                                {d.versionMeta(
                                    item.publishedBy || d.someoneElse,
                                    format.dateTime(item.publishedAt),
                                    digits(item.sectionCount),
                                )}
                            </p>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={busy === item.version}
                            disabled={busy !== null}
                            onClick={async () => {
                                setBusy(item.version);
                                try {
                                    await onRestore(item.version);
                                    onClose();
                                } finally {
                                    setBusy(null);
                                }
                            }}
                        >
                            {d.restore}
                        </Button>
                    </li>
                ))}
            </ol>
        </Dialog>
    );
}

export function ShareDialog({
    open,
    onClose,
    layoutId,
    language,
}: {
    open: boolean;
    onClose(): void;
    layoutId: string;
    language: 'bn' | 'en';
}) {
    const { messages: m } = useI18n();
    const d = m.design;
    const format = useFormat();
    const [copied, setCopied] = useState(false);
    const link = useQuery({
        queryKey: ['shareLink', layoutId, language, open],
        enabled: open,
        gcTime: 0,
        queryFn: async () => {
            const created = await createPreviewLink(layoutId, language, true);
            return { ...created, url: new URL(created.url, window.location.href).href };
        },
    });
    const url = link.data?.url ?? '';
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={d.shareTitle}
            description={d.shareDescription}
            footer={
                <Button variant="secondary" onClick={onClose}>
                    {m.common.close}
                </Button>
            }
        >
            <div className="space-y-3">
                <div className="flex gap-2">
                    <Input
                        readOnly
                        value={url}
                        aria-label={d.shareTitle}
                        onFocus={event => event.currentTarget.select()}
                        className="font-mono text-sm"
                    />
                </div>
                {link.data && (
                    <p className="text-sm text-ink-muted">
                        {d.worksUntil(format.dateTime(link.data.expiresAt))}
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={!url}
                        onClick={async () => {
                            await navigator.clipboard.writeText(url);
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 2000);
                        }}
                    >
                        {copied ? (
                            <Check className="size-4" aria-hidden />
                        ) : (
                            <Copy className="size-4" aria-hidden />
                        )}
                        {copied ? d.copied : d.copyLink}
                    </Button>
                    <a
                        className={cn(
                            'inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 font-medium text-ink hover:bg-surface-muted',
                            !url && 'pointer-events-none opacity-50',
                        )}
                        href={`https://wa.me/?text=${encodeURIComponent(url)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <MessageCircle className="size-4 text-ok" aria-hidden />
                        {d.sendWhatsapp}
                    </a>
                    <a
                        className={cn(
                            'inline-flex min-h-11 items-center gap-2 rounded-md px-4 font-medium text-ink-muted hover:bg-surface-muted',
                            !url && 'pointer-events-none opacity-50',
                        )}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <ExternalLink className="size-4" aria-hidden />
                        {d.open}
                    </a>
                </div>
            </div>
        </Dialog>
    );
}

export function ConflictDialog({
    conflict,
    onReload,
    onKeepMine,
    onPublishAnyway,
    onClose,
}: {
    conflict: (LayoutConflict & { kind: 'draft' | 'publish' }) | null;
    onReload(): void;
    onKeepMine(): void;
    onPublishAnyway(): void;
    onClose(): void;
}) {
    const { messages: m } = useI18n();
    const d = m.design;
    const format = useFormat();
    if (!conflict) return null;
    const who = conflict.by || d.someoneElse;
    const when = format.dateTime(conflict.at);
    return (
        <Dialog
            open
            onClose={onClose}
            title={d.conflictTitle}
            description={
                conflict.kind === 'publish' ? d.publishConflict(who, when) : d.draftConflict(who, when)
            }
            footer={
                <>
                    <Button variant="secondary" onClick={onReload}>
                        {d.loadTheirs}
                    </Button>
                    {conflict.kind === 'publish' ? (
                        <Button variant="danger" onClick={onPublishAnyway}>
                            {d.publishAnyway}
                        </Button>
                    ) : (
                        <Button onClick={onKeepMine}>{d.keepMine}</Button>
                    )}
                </>
            }
        />
    );
}

/** The shortcut sheet (roadmap phase 58): how the editor is used, in four steps, then the keys. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
    const { messages: m } = useI18n();
    const t = m.design.tree;
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    const mod = mac ? '⌘' : 'Ctrl';
    const rows: Array<[string, string[]]> = [
        [t.shortcutList.undo!, [mod, 'Z']],
        [t.shortcutList.redo!, [mod, 'Shift', 'Z']],
        [t.shortcutList.save!, [mod, 'S']],
        [t.shortcutList.copy!, [mod, 'C']],
        [t.shortcutList.paste!, [mod, 'V']],
        [t.shortcutList.duplicate!, [mod, 'D']],
        [t.shortcutList.remove!, ['Delete']],
        [t.shortcutList.arrows!, ['↑', '↓']],
        [t.shortcutList.escape!, ['Esc']],
        [t.shortcutList.preview!, ['P']],
        [t.shortcutList.help!, ['?']],
    ];
    return (
        <Dialog open={open} onClose={onClose} title={t.shortcuts}>
            <ol className="mb-5 space-y-2 text-sm text-ink-muted">
                {t.shortcutSteps.map((step, index) => (
                    <li key={step} className="flex gap-3">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink">
                            {index + 1}
                        </span>
                        <span>{step}</span>
                    </li>
                ))}
            </ol>
            <dl className="divide-y divide-line border-t border-line text-sm">
                {rows.map(([label, keys]) => (
                    <div key={label} className="flex items-center justify-between gap-4 py-2">
                        <dt className="text-ink">{label}</dt>
                        <dd className="flex shrink-0 gap-1">
                            {keys.map(key => (
                                <kbd
                                    key={key}
                                    className="min-w-6 rounded border border-line-strong bg-surface-muted px-1.5 py-0.5 text-center font-sans text-xs font-medium text-ink"
                                >
                                    {key}
                                </kbd>
                            ))}
                        </dd>
                    </div>
                ))}
            </dl>
        </Dialog>
    );
}

/**
 * The pre-publish checklist (roadmap phase 62): what to look at before the page goes live, most
 * serious first. Each line opens the section or element it's about.
 */
export function ChecklistDialog({
    open,
    onClose,
    items,
    measuring,
    onShow,
    nameOf,
}: {
    open: boolean;
    onClose(): void;
    items: CheckItem[];
    /** The phone-width checks are still being measured on the page. */
    measuring: boolean;
    onShow(item: CheckItem): void;
    /** What the section or element is called, for the line. */
    nameOf(item: CheckItem): string;
}) {
    const { messages: m } = useI18n();
    const c = m.design.checklist;
    const levels: Array<{ level: CheckLevel; title: string }> = [
        { level: 'blocker', title: c.blockers },
        { level: 'warning', title: c.warnings },
        { level: 'tip', title: c.tips },
    ];
    return (
        <Dialog open={open} onClose={onClose} title={c.title} description={c.description}>
            {items.length === 0 && !measuring && (
                <p className="flex items-center gap-2 py-6 text-ink">
                    <Check className="size-5 text-ok" aria-hidden />
                    {c.allGood}
                </p>
            )}
            <div className="space-y-5">
                {levels.map(({ level, title }) => {
                    const found = items.filter(item => item.level === level);
                    if (!found.length) return null;
                    return (
                        <section key={level}>
                            <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                                <span
                                    className={cn(
                                        'size-2 rounded-full',
                                        level === 'blocker'
                                            ? 'bg-danger'
                                            : level === 'warning'
                                              ? 'bg-warn'
                                              : 'bg-ink-faint',
                                    )}
                                    aria-hidden
                                />
                                {title} · {found.length}
                            </h3>
                            <ul className="divide-y divide-line border-y border-line">
                                {found.map((item, index) => (
                                    <li key={`${item.code}-${item.sectionId}-${item.nodeId ?? ''}-${index}`}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onShow(item);
                                                onClose();
                                            }}
                                            className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-sm text-ink">
                                                    {c.codes[item.code] ?? item.code}
                                                </span>
                                                <span className="block truncate text-xs text-ink-muted">
                                                    {nameOf(item)}
                                                </span>
                                            </span>
                                            <span className="shrink-0 pt-0.5 text-xs font-medium text-ink underline underline-offset-2">
                                                {c.show}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    );
                })}
            </div>
            {measuring && <p className="mt-4 text-sm text-ink-muted">{c.measuring}</p>}
        </Dialog>
    );
}
