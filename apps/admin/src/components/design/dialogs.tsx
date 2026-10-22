import {
    createSection,
    copySection,
    LANDING_CATEGORIES,
    LANDING_CATEGORY_NAMES,
    LANDING_TEMPLATES,
    type LayoutType,
    pick,
    SECTION_CATEGORIES,
    type SectionData,
    sectionsFor,
    STARTER_INFO,
    starterLayout,
    STARTERS,
    type StarterName,
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
import { Input } from '../ui/input';
import {
    createPreviewLink,
    deleteSavedSection,
    fetchSavedSections,
    fetchVersions,
    type LayoutConflict,
    saveSection,
} from './design-api';
import { IconButton } from './icon-button';
import { SectionIcon } from './section-icon';
import { SectionThumbnail } from './section-thumbnail';

/** The page editor's dialogs (roadmap phase 15). */

type LibraryTab = 'sections' | 'saved' | 'templates';

/** "Add section": the library by category, saved sections and (on the home page) templates. */
export function AddSectionDialog({
    open,
    onClose,
    layoutType,
    onAdd,
    onTemplate,
    onLandingTemplate,
    initialTab = 'sections',
}: {
    open: boolean;
    onClose(): void;
    layoutType: LayoutType;
    onAdd(section: SectionData): void;
    onTemplate(name: StarterName): void;
    /** Sales pages (phase 16) pick from their own twelve templates. */
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
    const tabs: Array<{ key: LibraryTab; label: string }> = [
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
            <div role="tablist" className="-mt-1 mb-4 flex gap-1 border-b border-slate-200">
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
                                ? 'border-teal-700 text-teal-800'
                                : 'border-transparent text-slate-600 hover:text-slate-900',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            {tab === 'sections' && (
                <div className="space-y-6">
                    {SECTION_CATEGORIES.map(category => {
                        const items = definitions.filter(definition => definition.category === category);
                        if (!items.length) return null;
                        return (
                            <section key={category}>
                                <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
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
                                                className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-teal-600 hover:shadow-md focus-visible:outline-2 focus-visible:outline-teal-600"
                                            >
                                                <span className="block border-b border-slate-100 bg-slate-50 p-2">
                                                    <SectionThumbnail
                                                        type={definition.type}
                                                        className="aspect-[16/10] w-full rounded shadow-sm ring-1 ring-slate-200 transition group-hover:ring-teal-600/40"
                                                    />
                                                </span>
                                                <span className="flex flex-1 flex-col gap-0.5 p-3">
                                                    <span className="flex items-center gap-1.5 text-sm font-medium">
                                                        <SectionIcon
                                                            type={definition.type}
                                                            className="size-4 text-teal-700"
                                                        />
                                                        {pick(definition.name, language)}
                                                    </span>
                                                    <span className="text-xs leading-snug text-slate-600">
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
                        <div className="flex flex-col items-center gap-2 py-12 text-center text-slate-600">
                            <Bookmark className="size-6 text-slate-400" aria-hidden />
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
                                    className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-teal-600 hover:shadow-md"
                                >
                                    <span className="block border-b border-slate-100 bg-slate-50 p-2">
                                        <SectionThumbnail
                                            type={item.section.type}
                                            className="aspect-[16/10] w-full rounded ring-1 ring-slate-200"
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
                    <p className="text-sm text-slate-600">{d.landingTemplatesDescription}</p>
                    {LANDING_CATEGORIES.map(category => (
                        <section key={category}>
                            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
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
                    <p className="mb-4 text-sm text-slate-600">{d.templatesDescription}</p>
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {STARTERS.map(name => {
                            const types = starterLayout(name)
                                .sections.filter(section => !section.hidden)
                                .map(section => section.type);
                            return (
                                <li key={name}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onTemplate(name);
                                            onClose();
                                        }}
                                        className="group flex w-full gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-teal-600 hover:shadow-md"
                                    >
                                        <span className="flex w-24 shrink-0 flex-col gap-1 rounded bg-slate-50 p-1.5 ring-1 ring-slate-200">
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
                                                    className="size-4 text-teal-700"
                                                    aria-hidden
                                                />
                                                {pick(STARTER_INFO[name].name, language)}
                                            </span>
                                            <span className="mt-1 block text-sm text-slate-600">
                                                {pick(STARTER_INFO[name].description, language)}
                                            </span>
                                            <span className="mt-3 inline-flex text-sm font-medium text-teal-800 group-hover:underline">
                                                {d.applyTemplate}
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
                'group flex w-full gap-3 rounded-lg border bg-white p-3 text-left transition hover:border-teal-600 hover:shadow-md focus-visible:outline-2 focus-visible:outline-teal-600',
                selected ? 'border-teal-600 ring-2 ring-teal-600/30' : 'border-slate-200',
            )}
        >
            <span className="flex w-20 shrink-0 flex-col gap-1 rounded bg-slate-50 p-1.5 ring-1 ring-slate-200">
                {types.slice(0, 5).map((type, index) => (
                    <SectionThumbnail key={`${type}-${index}`} type={type} className="w-full rounded-sm" />
                ))}
            </span>
            <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                    {selected ? (
                        <Check className="size-4 text-teal-700" aria-hidden />
                    ) : (
                        <LayoutTemplate className="size-4 text-teal-700" aria-hidden />
                    )}
                    {pick(template.name, language)}
                </span>
                <span className="mt-1 block text-sm text-slate-600">
                    {pick(template.description, language)}
                </span>
                <span className="mt-2 block text-xs text-slate-500">
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
            {versions.data?.length === 0 && <p className="py-8 text-center text-slate-600">{d.noHistory}</p>}
            <ol className="relative space-y-1 border-l border-slate-200 pl-5">
                {versions.data?.map(item => (
                    <li
                        key={item.version}
                        className="relative flex items-center gap-3 rounded-md py-2 pr-1 hover:bg-slate-50"
                    >
                        <span
                            className={cn(
                                'absolute top-1/2 -left-[26px] size-3 -translate-y-1/2 rounded-full border-2 border-white',
                                item.version === publishedVersion ? 'bg-teal-600' : 'bg-slate-300',
                            )}
                            aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 font-medium">
                                {d.version(digits(item.version))}
                                {item.version === publishedVersion && (
                                    <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-800">
                                        {d.liveNow}
                                    </span>
                                )}
                            </p>
                            <p className="truncate text-sm text-slate-600">
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
                    <p className="text-sm text-slate-600">
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
                            'inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50',
                            !url && 'pointer-events-none opacity-50',
                        )}
                        href={`https://wa.me/?text=${encodeURIComponent(url)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <MessageCircle className="size-4 text-green-700" aria-hidden />
                        {d.sendWhatsapp}
                    </a>
                    <a
                        className={cn(
                            'inline-flex min-h-11 items-center gap-2 rounded-md px-4 font-medium text-slate-700 hover:bg-slate-100',
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
