import {
    fillFromProduct,
    landingTemplate,
    LAYOUT_LIMITS,
    pick,
    type SectionData,
    sectionDefinition,
    starterLayout,
    type StarterName,
} from '@ecommbd/sections';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    CloudCheck,
    CloudOff,
    Compass,
    Copy,
    ExternalLink,
    Keyboard,
    Maximize2,
    Minimize2,
    History,
    LoaderCircle,
    Monitor,
    Redo2,
    Rocket,
    Settings2,
    Share2,
    Smartphone,
    Tablet,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
    type AdminLayout,
    createPreviewLink,
    duplicatePage,
    fetchLayout,
    fetchPages,
    fetchSalesPage,
    type LayoutKind,
    productsById,
    type SalesPage,
} from '../components/design/design-api';
import {
    AddSectionDialog,
    ConflictDialog,
    HistoryDialog,
    ShortcutsDialog,
    SaveSectionDialog,
    ShareDialog,
} from '../components/design/dialogs';
import { insertSection } from '../components/design/document-ops';
import { IconButton } from '../components/design/icon-button';
import {
    type Device,
    type PreviewHandle,
    type PreviewMessage,
    PreviewFrame,
} from '../components/design/preview-frame';
import { SectionForm } from '../components/design/section-form';
import { SectionIcon } from '../components/design/section-icon';
import { SalesSettingsPanel } from '../components/design/sales-settings';
import { RowMenu, SectionList } from '../components/design/section-list';
import { useCanvas } from '../components/design/use-canvas';
import { useLayoutEditor } from '../components/design/use-layout-editor';
import { Button } from '../components/ui/button';
import { EDITOR_TOUR_KEY, markTourDone, shouldStartTour, Tour } from '../layout/tour';
import { PageSkeleton } from '../components/ui/misc';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useMediaQuery } from '../lib/use-media-query';

/**
 * The page editor (roadmap phase 15), full screen: the page's sections on the left, the live
 * preview in the middle (phone view first), the selected section's settings on the right. On a
 * phone the sections and the preview are two tabs, and a section's settings open over the list.
 */
export function PageEditorPage() {
    const { kind = 'home', pageId } = useParams();
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const layoutKind: LayoutKind =
        kind === 'product' ? 'product' : kind === 'page' ? 'page' : kind === 'landing' ? 'landing' : 'home';
    const query = useQuery({
        queryKey: ['pageLayout', layoutKind, pageId ?? ''],
        queryFn: () => fetchLayout(layoutKind, pageId),
        staleTime: 0,
        gcTime: 0,
        refetchOnWindowFocus: false,
    });
    if (!can('EditStorefront')) {
        return <p className="p-10 text-center text-ink-muted">{m.errors.forbidden}</p>;
    }
    if (query.isPending) {
        return (
            <div className="mx-auto max-w-5xl p-6">
                <PageSkeleton />
            </div>
        );
    }
    if (!query.data) {
        return (
            <div className="mx-auto max-w-xl p-10 text-center">
                <p className="mb-4 text-ink-muted">{m.notFound.body}</p>
                <Link
                    to={layoutKind === 'landing' ? '/sales-pages' : '/store/pages'}
                    className="font-medium text-accent underline"
                >
                    {m.design.back}
                </Link>
            </div>
        );
    }
    return (
        <Editor
            key={query.data.id}
            initial={query.data}
            salesPageId={layoutKind === 'landing' ? pageId : undefined}
        />
    );
}

const RENEW_PREVIEW_MS = 12 * 60_000;

/** The editor's tour, in this order: each step after the welcome points at its `data-tour` part. */
const EDITOR_TOUR = [
    'welcome',
    'editorSections',
    'editorCanvas',
    'editorSettings',
    'editorDevices',
    'editorPublish',
] as const;

function Editor({ initial, salesPageId }: { initial: AdminLayout; salesPageId?: string }) {
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const toast = useToast();
    const confirm = useConfirm();
    const format = useFormat();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const editor = useLayoutEditor(initial);
    const { layout, document } = editor;
    const [language, setLanguage] = useState<'bn' | 'en'>(ui);
    const [device, setDevice] = useState<Device>('phone');
    const [selected, setSelected] = useState<string | null>(null);
    // The node chosen inside the selected free section (phase 58): on the canvas, in the Navigator
    // or in the settings panel, it's the same one everywhere.
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const select = useCallback((sectionUid: string | null, nodeUid: string | null = null) => {
        setSelected(sectionUid);
        setSelectedNode(sectionUid ? nodeUid : null);
    }, []);
    /** Where "Add section" on the canvas puts the new one (null: after the selected one). */
    const [insertAt, setInsertAt] = useState<number | null>(null);
    const [addInside, setAddInside] = useState<{ uid: string | null; at: number } | null>(null);
    /** The canvas alone, without the side panels. */
    const [expanded, setExpanded] = useState(false);
    /** Percent, or null to fit the space. */
    const [zoom, setZoom] = useState<number | null>(null);
    const [fit, setFit] = useState(100);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    // A first visit to the editor gets a short tour (phase 62); it can be skipped at any step and
    // started again from the "More" menu.
    const [tourOpen, setTourOpen] = useState(() => shouldStartTour(EDITOR_TOUR_KEY));
    const closeTour = useCallback(() => {
        markTourDone(EDITOR_TOUR_KEY);
        setTourOpen(false);
    }, []);
    const [mobileTab, setMobileTab] = useState<'sections' | 'preview'>('sections');
    const [library, setLibrary] = useState<null | 'sections' | 'templates'>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [saving, setSaving] = useState<SectionData | null>(null);
    const [publishing, setPublishing] = useState(false);
    // A sales page's own settings (phase 16), in place of a section's.
    const [pageSettings, setPageSettings] = useState(false);
    const landing = initial.type === 'landing';
    const salesPage = useQuery({
        queryKey: ['salesPage', salesPageId],
        queryFn: () => fetchSalesPage(salesPageId!),
        enabled: landing && !!salesPageId,
    });
    const preview = useRef<PreviewHandle>(null);
    // One settings form at a time: beside the preview on computers, over the list on phones.
    const wide = useMediaQuery('(min-width: 1024px)');
    const digits = useCallback(
        (n: number) =>
            ui === 'bn' ? String(n).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(n),
        [ui],
    );

    const pages = useQuery({ queryKey: ['designPages'], queryFn: fetchPages, staleTime: 60_000 });
    const link = useQuery({
        queryKey: ['editorPreview', layout.id, language],
        queryFn: () => createPreviewLink(layout.id, language),
        staleTime: Infinity,
        gcTime: 0,
    });
    const src = link.data?.url ?? null;
    const liveUrl = src
        ? (() => {
              const url = new URL(src, window.location.href);
              return `${url.origin}${url.pathname}`;
          })()
        : null;

    // The frame's token lasts 15 minutes: hand it a new one before then, without a reload.
    useEffect(() => {
        const timer = window.setInterval(async () => {
            try {
                const renewed = await createPreviewLink(layout.id, language);
                preview.current?.post({ type: 'token', url: renewed.url });
            } catch {
                // Next time.
            }
        }, RENEW_PREVIEW_MS);
        return () => window.clearInterval(timer);
    }, [layout.id, language]);

    // After every save the preview redraws its sections from the draft.
    const firstSave = useRef(editor.savedCount);
    useEffect(() => {
        if (editor.savedCount !== firstSave.current) preview.current?.post({ type: 'refresh' });
    }, [editor.savedCount]);

    useEffect(() => {
        preview.current?.post({ type: 'select', uid: selected, node: selectedNode });
    }, [selected, selectedNode]);

    const canvas = useCanvas({
        document,
        change: editor.change,
        undo: editor.undo,
        redo: editor.redo,
        flush: editor.flush,
        selected,
        selectedNode,
        select,
        language,
        post: message => preview.current?.post(message),
        addSectionAt: index => {
            setInsertAt(index);
            setLibrary('sections');
        },
        addInside: uid => setAddInside({ uid, at: Date.now() }),
        toggleExpanded: () => setExpanded(value => !value),
        showShortcuts: () => setShortcutsOpen(true),
        expanded,
        say: {
            refused: d.tree.refused,
            copied: d.tree.copied,
            pasted: d.tree.pasted,
            nothingToPaste: d.tree.nothingToPaste,
            pasteNeedsSection: d.tree.pasteNeedsSection,
            savedNow: d.tree.savedNow,
            tooMany: d.tooMany(digits(LAYOUT_LIMITS.sections)),
        },
        toast,
    });

    const onPreviewMessage = (message: PreviewMessage) => {
        if (message.type === 'ready') {
            preview.current?.post({ type: 'select', uid: selected, node: selectedNode });
        }
        if (message.type === 'select' && typeof message.uid === 'string') {
            select(message.uid, typeof message.node === 'string' ? message.node : null);
            setMobileTab('sections');
        }
        if (message.type === 'expired') void link.refetch();
        if (canvas.onMessage(message) && message.type === 'add-inside') setMobileTab('sections');
    };

    // Shortcuts (the list is under "?"), outside text fields, which keep their own keys. The
    // preview frame sends on the same keys when it has the keyboard.
    const runKey = useRef(canvas.runKey);
    runKey.current = canvas.runKey;
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            // A dialog that is open has the keyboard to itself (Escape closes it).
            if (window.document.querySelector('dialog[open]')) return;
            if (target.closest('input, textarea, [contenteditable="true"], select')) return;
            if (event.altKey) return;
            const command = event.ctrlKey || event.metaKey;
            // Arrow keys on a drag handle or in a list reorder or scroll there.
            if (
                !command &&
                event.key.startsWith('Arrow') &&
                target.closest('button, [role="radio"], [role="tab"]')
            ) {
                return;
            }
            const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
            if (runKey.current(key, command, event.shiftKey)) event.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const selectedSection = document.sections.find(section => section.uid === selected) ?? null;
    useEffect(() => {
        if (selected && !selectedSection) select(null);
    }, [selected, selectedSection, select]);
    // Choosing a section closes the page settings, and opening them unselects the section.
    useEffect(() => {
        if (selected) setPageSettings(false);
    }, [selected]);

    const addSection = (section: SectionData) => {
        if (document.sections.length >= LAYOUT_LIMITS.sections) {
            toast.error(d.tooMany(digits(LAYOUT_LIMITS.sections)));
            return;
        }
        const at =
            insertAt ??
            (selectedSection ? document.sections.indexOf(selectedSection) + 1 : document.sections.length);
        editor.change(insertSection(document, section, at));
        select(section.uid);
    };

    const applyTemplate = async (name: StarterName) => {
        if (
            document.sections.length &&
            !(await confirm({ title: d.useTemplate, body: d.replaceConfirm, confirmLabel: d.applyTemplate }))
        ) {
            return;
        }
        editor.change(starterLayout(name));
        select(null);
        toast.success(d.templateApplied);
    };

    /** Sales pages (phase 16): another of the twelve templates, filled from the page's product. */
    const applyLandingTemplate = async (id: string) => {
        const template = landingTemplate(id);
        if (!template) return;
        if (
            document.sections.length &&
            !(await confirm({ title: d.useTemplate, body: d.replaceConfirm, confirmLabel: d.applyTemplate }))
        ) {
            return;
        }
        const productId = salesPage.data?.productId;
        const product = productId ? (await productsById([productId]))[0] : undefined;
        const name = product?.name ?? salesPage.data?.title ?? '';
        editor.change(fillFromProduct(template.build({ name: { bn: name, en: name } }), {}));
        select(null);
        toast.success(d.templateApplied);
    };

    const publish = async (force = false) => {
        setPublishing(true);
        try {
            const result = await editor.publish(force);
            if (result.ok) {
                toast.success(d.publishedToast);
                void queryClient.invalidateQueries({ queryKey: ['layoutVersions', layout.id] });
            } else if (result.errors.length) {
                toast.error(d.publishBlocked);
                const first = result.errors.find(error => error.sectionId);
                if (first) {
                    select(first.sectionId, first.blockId ?? null);
                    setMobileTab('sections');
                }
            }
        } catch {
            toast.error(d.saveFailed);
        } finally {
            setPublishing(false);
        }
    };

    /** Saved page settings change what's around the sections too: reload the preview. */
    const onSalesSaved = (page: SalesPage) => {
        queryClient.setQueryData(['salesPage', salesPageId], page);
        void link.refetch();
    };

    const reloadTheirs = async () => {
        const fresh = await fetchLayout(layout.type, layout.pageId ?? undefined);
        if (fresh) editor.reset(fresh);
    };

    const pageTitle =
        layout.type === 'home'
            ? d.homePage
            : layout.type === 'product'
              ? d.productPage
              : (salesPage.data?.title ?? layout.title) || d.untitled;
    const pageValue = layout.type === 'page' ? `page:${layout.pageId}` : layout.type;

    const status = (() => {
        switch (editor.status) {
            case 'saving':
            case 'pending':
                return {
                    icon: LoaderCircle,
                    text: d.saving,
                    tone: 'text-ink-muted',
                    spin: editor.status === 'saving',
                };
            case 'offline':
                return { icon: CloudOff, text: d.offline, tone: 'text-warn', spin: false };
            case 'error':
                return { icon: CloudOff, text: d.saveFailed, tone: 'text-danger', spin: false };
            default:
                return { icon: CloudCheck, text: d.saved, tone: 'text-ink-muted', spin: false };
        }
    })();
    const liveText = layout.publishedVersion
        ? editor.hasChanges
            ? d.unpublishedChanges
            : d.live(digits(layout.publishedVersion))
        : d.notPublished;

    const moreItems = [
        { label: d.history, icon: History, run: () => setHistoryOpen(true) },
        { label: d.tree.shortcuts, icon: Keyboard, run: () => setShortcutsOpen(true) },
        { label: m.tour.again, icon: Compass, run: () => setTourOpen(true) },
        { label: d.share, icon: Share2, run: () => setShareOpen(true) },
        ...(liveUrl && layout.publishedVersion
            ? [
                  {
                      label: d.viewLive,
                      icon: ExternalLink,
                      run: () => window.open(liveUrl, '_blank', 'noopener'),
                  },
              ]
            : []),
        ...(layout.type === 'page' && layout.pageId
            ? [
                  {
                      label: d.duplicatePage,
                      icon: Copy,
                      run: async () => {
                          await editor.flush();
                          const copy = await duplicatePage(layout.pageId!);
                          if (copy) {
                              toast.success(d.duplicated);
                              navigate(`/store/design/page/${copy.id}`);
                          }
                      },
                  },
              ]
            : []),
        ...(layout.publishedVersion
            ? [
                  {
                      label: d.discard,
                      icon: Trash2,
                      danger: true,
                      run: async () => {
                          if (
                              await confirm({
                                  title: d.discard,
                                  body: d.discardConfirm,
                                  danger: true,
                                  confirmLabel: d.discard,
                              })
                          ) {
                              if (await editor.discard()) toast.success(d.discarded);
                          }
                      },
                  },
              ]
            : []),
    ];

    const definition = selectedSection ? sectionDefinition(selectedSection.type) : undefined;

    return (
        <div className="flex h-dvh flex-col bg-surface-muted text-ink">
            {/* Top bar */}
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
                <Link
                    to={layout.type === 'page' ? '/store/pages' : landing ? '/sales-pages' : '/'}
                    className="flex size-10 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
                    aria-label={d.back}
                    title={d.back}
                >
                    <ArrowLeft className="size-5" aria-hidden />
                </Link>
                <div className="min-w-0">
                    {landing ? (
                        <p className="max-w-44 truncate font-semibold sm:max-w-64">{pageTitle}</p>
                    ) : (
                        <>
                            <label htmlFor="editor-page" className="sr-only">
                                {d.choosePage}
                            </label>
                            <select
                                id="editor-page"
                                value={pageValue}
                                onChange={async event => {
                                    await editor.flush();
                                    const value = event.target.value;
                                    navigate(
                                        value.startsWith('page:')
                                            ? `/store/design/page/${value.slice(5)}`
                                            : `/store/design/${value}`,
                                    );
                                }}
                                className="block min-h-9 max-w-44 truncate rounded-md border border-transparent bg-surface pr-7 pl-2 font-semibold text-ink hover:border-line-strong focus:outline-2 focus:outline-accent sm:max-w-64"
                            >
                                <option value="home">{d.homePage}</option>
                                <option value="product">{d.productPage}</option>
                                {(pages.data?.length ?? 0) > 0 && (
                                    <optgroup label={d.pagesGroup}>
                                        {pages.data!.map(page => {
                                            const translation =
                                                page.translations.find(item => item.languageCode === ui) ??
                                                page.translations[0];
                                            return (
                                                <option key={page.id} value={`page:${page.id}`}>
                                                    {translation?.title}
                                                </option>
                                            );
                                        })}
                                    </optgroup>
                                )}
                            </select>
                            <p className="sr-only">{pageTitle}</p>
                        </>
                    )}
                </div>
                <div
                    className={cn('hidden items-center gap-1.5 text-xs md:flex', status.tone)}
                    role="status"
                    aria-live="polite"
                >
                    <status.icon className={cn('size-4', status.spin && 'animate-spin')} aria-hidden />
                    <span className="max-w-56 truncate">{status.text}</span>
                    <span className="text-ink-faint" aria-hidden>
                        ·
                    </span>
                    <span
                        className={cn(
                            editor.hasChanges && layout.publishedVersion ? 'text-warn' : 'text-ink-muted',
                        )}
                    >
                        {liveText}
                    </span>
                </div>
                <div className="ml-auto flex items-center gap-1">
                    <div
                        className="hidden rounded-md bg-surface-muted p-0.5 lg:flex"
                        role="radiogroup"
                        aria-label={d.previewSize}
                        data-tour="editorDevices"
                    >
                        {(
                            [
                                { key: 'phone', icon: Smartphone, label: d.phone },
                                { key: 'tablet', icon: Tablet, label: d.tablet },
                                { key: 'desktop', icon: Monitor, label: d.desktop },
                            ] as const
                        ).map(item => (
                            <button
                                key={item.key}
                                type="button"
                                role="radio"
                                aria-checked={device === item.key}
                                aria-label={item.label}
                                title={item.label}
                                onClick={() => setDevice(item.key)}
                                className={cn(
                                    'flex size-8 items-center justify-center rounded',
                                    device === item.key
                                        ? 'bg-surface text-accent shadow-sm'
                                        : 'text-ink-muted hover:text-ink',
                                )}
                            >
                                <item.icon className="size-4" aria-hidden />
                            </button>
                        ))}
                    </div>
                    <div
                        className="flex rounded-md bg-surface-muted p-0.5"
                        role="radiogroup"
                        aria-label={d.textLanguage}
                        title={d.textLanguage}
                    >
                        {(['bn', 'en'] as const).map(code => (
                            <button
                                key={code}
                                type="button"
                                role="radio"
                                aria-checked={language === code}
                                onClick={() => setLanguage(code)}
                                className={cn(
                                    'h-8 rounded px-2 text-xs font-medium',
                                    language === code
                                        ? 'bg-surface text-accent shadow-sm'
                                        : 'text-ink-muted hover:text-ink',
                                )}
                            >
                                {code === 'bn' ? 'বাং' : 'EN'}
                            </button>
                        ))}
                    </div>
                    <div className="hidden items-center sm:flex">
                        <IconButton
                            aria-label={d.undo}
                            title={`${d.undo} (${d.keyboardHint})`}
                            disabled={!editor.canUndo}
                            onClick={editor.undo}
                        >
                            <Undo2 className="size-4" aria-hidden />
                        </IconButton>
                        <IconButton
                            aria-label={d.redo}
                            title={d.redo}
                            disabled={!editor.canRedo}
                            onClick={editor.redo}
                        >
                            <Redo2 className="size-4" aria-hidden />
                        </IconButton>
                    </div>
                    {landing && salesPage.data && (
                        <Button
                            variant={pageSettings ? 'primary' : 'secondary'}
                            size="sm"
                            aria-pressed={pageSettings}
                            onClick={() => {
                                select(null);
                                setPageSettings(!pageSettings);
                                setMobileTab('sections');
                            }}
                        >
                            <Settings2 className="size-4" aria-hidden />
                            <span className="hidden sm:inline">{d.pageSettings}</span>
                        </Button>
                    )}
                    <RowMenu label={d.more} items={moreItems} />
                    <Button
                        size="sm"
                        data-tour="editorPublish"
                        loading={publishing}
                        disabled={publishing || (!editor.hasChanges && layout.publishedVersion > 0)}
                        onClick={() => void publish()}
                        className="ml-1"
                    >
                        <Rocket className="size-4" aria-hidden />
                        {d.publish}
                    </Button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                {/* Sections (and, on phones, the selected section's settings over them) */}
                <aside
                    data-tour="editorSections"
                    className={cn(
                        'flex w-full min-w-0 flex-col border-r border-line bg-surface lg:w-[300px] lg:shrink-0',
                        mobileTab === 'preview' && 'max-lg:hidden',
                        expanded && 'lg:hidden',
                    )}
                >
                    {selectedSection && definition && !wide ? (
                        <div className="flex min-h-0 flex-1 flex-col">
                            <PanelHeader
                                title={pick(definition.name, ui)}
                                type={selectedSection.type}
                                onClose={() => select(null)}
                                closeLabel={d.back}
                            />
                            <div className="relative min-h-0 flex-1 overflow-y-auto">
                                <SectionForm
                                    section={selectedSection}
                                    document={document}
                                    language={language}
                                    warnings={editor.warnings}
                                    onChange={editor.change}
                                    landing={landing}
                                    device={device === 'desktop' ? 'base' : device}
                                    onDevice={next => setDevice(next === 'base' ? 'desktop' : next)}
                                    node={selectedNode}
                                    onNode={uid => setSelectedNode(uid)}
                                    addInside={addInside}
                                    onDragNew={canvas.dragNew}
                                />
                            </div>
                        </div>
                    ) : null}
                    {pageSettings && salesPage.data && !wide ? (
                        <div className="flex min-h-0 flex-1 flex-col">
                            <PanelHeader
                                title={d.pageSettings}
                                type="settings"
                                onClose={() => setPageSettings(false)}
                                closeLabel={d.back}
                            />
                            <div className="relative min-h-0 flex-1 overflow-y-auto">
                                <SalesSettingsPanel
                                    page={salesPage.data}
                                    language={language}
                                    onSaved={onSalesSaved}
                                />
                            </div>
                        </div>
                    ) : null}
                    <div
                        className={cn(
                            'flex min-h-0 flex-1 flex-col',
                            (selectedSection || (pageSettings && salesPage.data)) && !wide && 'hidden',
                        )}
                    >
                        {document.sections.length === 0 ? (
                            <EmptyLayout
                                onAdd={() => setLibrary('sections')}
                                onTemplate={() => setLibrary('templates')}
                                canTemplate={layout.type !== 'product'}
                            />
                        ) : (
                            <SectionList
                                document={document}
                                selected={selected}
                                warnings={editor.warnings}
                                language={language}
                                selectedNode={selectedNode}
                                onSelect={uid => select(uid)}
                                onSelectNode={select}
                                onChange={editor.change}
                                onAdd={() => setLibrary('sections')}
                                onSaveForReuse={setSaving}
                                onRemoved={() => toast.info(d.removed)}
                            />
                        )}
                    </div>
                </aside>

                {/* Live preview */}
                <main
                    className={cn(
                        'flex min-w-0 flex-1 flex-col p-2 lg:p-4 lg:pt-2',
                        mobileTab === 'sections' && 'max-lg:hidden',
                    )}
                >
                    {/* The canvas's own controls: its size, and the page alone without the panels. */}
                    <div className="mb-2 hidden items-center justify-end gap-1 text-xs lg:flex">
                        <div
                            className="flex items-center rounded-md bg-surface text-ink-muted shadow-sm ring-1 ring-line"
                            role="group"
                            aria-label={d.tree.zoom}
                        >
                            <button
                                type="button"
                                className="h-7 w-7 rounded-l-md hover:bg-surface-muted hover:text-ink"
                                aria-label={`${d.tree.zoom} −`}
                                onClick={() =>
                                    setZoom(Math.max(30, Math.round(((zoom ?? fit) - 10) / 10) * 10))
                                }
                            >
                                −
                            </button>
                            <button
                                type="button"
                                className="h-7 min-w-16 px-1 font-medium tabular-nums hover:bg-surface-muted hover:text-ink"
                                title={d.tree.zoomFit}
                                onClick={() => setZoom(null)}
                            >
                                {zoom === null ? `${d.tree.zoomFit} · ` : ''}
                                {digits(zoom ?? fit)}%
                            </button>
                            <button
                                type="button"
                                className="h-7 w-7 rounded-r-md hover:bg-surface-muted hover:text-ink"
                                aria-label={`${d.tree.zoom} +`}
                                onClick={() =>
                                    setZoom(Math.min(150, Math.round(((zoom ?? fit) + 10) / 10) * 10))
                                }
                            >
                                +
                            </button>
                        </div>
                        <button
                            type="button"
                            aria-pressed={expanded}
                            onClick={() => setExpanded(!expanded)}
                            className="flex h-7 items-center gap-1.5 rounded-md bg-surface px-2.5 font-medium text-ink-muted shadow-sm ring-1 ring-line hover:text-ink"
                        >
                            {expanded ? (
                                <Minimize2 className="size-3.5" aria-hidden />
                            ) : (
                                <Maximize2 className="size-3.5" aria-hidden />
                            )}
                            {expanded ? d.tree.exitExpanded : d.tree.expandCanvas}
                        </button>
                    </div>
                    <div className="min-h-0 flex-1" data-tour="editorCanvas">
                        <PreviewFrame
                            ref={preview}
                            src={src}
                            device={device}
                            title={d.previewTitle}
                            onMessage={onPreviewMessage}
                            zoom={zoom}
                            onFit={setFit}
                        />
                    </div>
                </main>

                {/* Selected section's settings (computers) */}
                <aside
                    data-tour="editorSettings"
                    className={cn(
                        'hidden w-[360px] shrink-0 flex-col border-l border-line bg-surface',
                        !expanded && 'lg:flex',
                    )}
                >
                    {selectedSection && definition && wide ? (
                        <>
                            <PanelHeader
                                title={pick(definition.name, ui)}
                                type={selectedSection.type}
                                onClose={() => select(null)}
                                closeLabel={m.common.close}
                            />
                            <div className="relative min-h-0 flex-1 overflow-y-auto">
                                <SectionForm
                                    key={selectedSection.uid}
                                    section={selectedSection}
                                    document={document}
                                    language={language}
                                    warnings={editor.warnings}
                                    onChange={editor.change}
                                    landing={landing}
                                    device={device === 'desktop' ? 'base' : device}
                                    onDevice={next => setDevice(next === 'base' ? 'desktop' : next)}
                                    node={selectedNode}
                                    onNode={uid => setSelectedNode(uid)}
                                    addInside={addInside}
                                    onDragNew={canvas.dragNew}
                                />
                            </div>
                        </>
                    ) : pageSettings && salesPage.data && wide ? (
                        <>
                            <PanelHeader
                                title={d.pageSettings}
                                type="settings"
                                onClose={() => setPageSettings(false)}
                                closeLabel={m.common.close}
                            />
                            <div className="relative min-h-0 flex-1 overflow-y-auto">
                                <SalesSettingsPanel
                                    page={salesPage.data}
                                    language={language}
                                    onSaved={onSalesSaved}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                            <div className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
                                <SectionIcon type="hero" className="size-6" />
                            </div>
                            <p className="font-medium">{d.noSelection}</p>
                            <p className="text-sm text-ink-muted">{d.noSelectionHint}</p>
                            {layout.publishedAt && (
                                <p className="mt-4 text-xs text-ink-muted">
                                    {d.versionMeta(
                                        layout.publishedBy || d.someoneElse,
                                        format.dateTime(layout.publishedAt),
                                        digits(document.sections.length),
                                    )}
                                </p>
                            )}
                        </div>
                    )}
                </aside>
            </div>

            {/* Phones: switch between the sections and the preview */}
            <nav className="flex shrink-0 border-t border-line bg-surface lg:hidden" aria-label={d.sections}>
                {(
                    [
                        { key: 'sections', label: d.sections },
                        { key: 'preview', label: d.previewTitle },
                    ] as const
                ).map(item => (
                    <button
                        key={item.key}
                        type="button"
                        aria-pressed={mobileTab === item.key}
                        onClick={() => setMobileTab(item.key)}
                        className={cn(
                            'flex min-h-12 flex-1 items-center justify-center text-sm font-medium',
                            mobileTab === item.key
                                ? 'text-accent shadow-[inset_0_2px_0_0_#0f766e]'
                                : 'text-ink-muted',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>

            <AddSectionDialog
                open={library !== null}
                initialTab={library ?? 'sections'}
                key={library ?? 'closed'}
                onClose={() => {
                    setLibrary(null);
                    setInsertAt(null);
                }}
                layoutType={layout.type}
                onAdd={addSection}
                onTemplate={name => void applyTemplate(name)}
                onLandingTemplate={id => void applyLandingTemplate(id)}
            />
            <SaveSectionDialog section={saving} onClose={() => setSaving(null)} />
            <HistoryDialog
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
                layoutId={layout.id}
                publishedVersion={layout.publishedVersion}
                onRestore={async version => {
                    if (await editor.restore(version)) toast.success(d.restored(digits(version)));
                }}
            />
            <ShareDialog
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                layoutId={layout.id}
                language={language}
            />
            <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
            <Tour
                open={tourOpen && wide && !expanded}
                steps={EDITOR_TOUR}
                copy={d.tour}
                onClose={closeTour}
            />
            <ConflictDialog
                conflict={editor.conflict}
                onClose={editor.dismissConflict}
                onReload={() => void reloadTheirs()}
                onKeepMine={() => void editor.keepMine()}
                onPublishAnyway={() => {
                    editor.dismissConflict();
                    void publish(true);
                }}
            />
        </div>
    );
}

function PanelHeader({
    title,
    type,
    onClose,
    closeLabel,
}: {
    title: string;
    type: string;
    onClose(): void;
    closeLabel: string;
}) {
    return (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
            <span className="flex size-7 items-center justify-center rounded bg-accent text-white">
                <SectionIcon type={type} className="size-4" />
            </span>
            <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
            <IconButton aria-label={closeLabel} title={closeLabel} onClick={onClose}>
                <X className="size-4" aria-hidden />
            </IconButton>
        </div>
    );
}

function EmptyLayout({
    onAdd,
    onTemplate,
    canTemplate,
}: {
    onAdd(): void;
    onTemplate(): void;
    canTemplate: boolean;
}) {
    const { messages: m } = useI18n();
    const d = m.design;
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid grid-cols-2 gap-1.5 opacity-80" aria-hidden>
                {['hero', 'product-grid', 'trust-badges', 'faq'].map(type => (
                    <span
                        key={type}
                        className="flex size-12 items-center justify-center rounded-md bg-surface-muted text-ink-muted"
                    >
                        <SectionIcon type={type} className="size-5" />
                    </span>
                ))}
            </div>
            <p className="mt-2 font-semibold">{d.emptyTitle}</p>
            <p className="text-sm text-ink-muted">{d.emptyBody}</p>
            <div className="mt-2 flex flex-col gap-2 self-stretch">
                <Button onClick={onAdd} className="justify-center">
                    {d.addSection}
                </Button>
                {canTemplate && (
                    <Button variant="secondary" onClick={onTemplate} className="justify-center">
                        {d.useTemplate}
                    </Button>
                )}
            </div>
        </div>
    );
}

export default PageEditorPage;
