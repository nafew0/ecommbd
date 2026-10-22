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
    Copy,
    ExternalLink,
    History,
    LoaderCircle,
    Monitor,
    Redo2,
    Rocket,
    Settings2,
    Share2,
    Smartphone,
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
import { useLayoutEditor } from '../components/design/use-layout-editor';
import { Button } from '../components/ui/button';
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
        return <p className="p-10 text-center text-slate-700">{m.errors.forbidden}</p>;
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
                <p className="mb-4 text-slate-700">{m.notFound.body}</p>
                <Link
                    to={layoutKind === 'landing' ? '/sales-pages' : '/store/pages'}
                    className="font-medium text-teal-800 underline"
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
        preview.current?.post({ type: 'select', uid: selected });
    }, [selected]);

    const onPreviewMessage = useCallback(
        (message: PreviewMessage) => {
            if (message.type === 'ready') preview.current?.post({ type: 'select', uid: selected });
            if (message.type === 'select' && typeof message.uid === 'string') {
                setSelected(message.uid);
                setMobileTab('sections');
            }
            if (message.type === 'expired') void link.refetch();
        },
        [selected, link],
    );

    // Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) outside text fields, which keep their own undo.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('input, textarea, [contenteditable="true"], select')) return;
            if (!(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key === 'z' && !event.shiftKey) {
                event.preventDefault();
                editor.undo();
            } else if ((key === 'z' && event.shiftKey) || key === 'y') {
                event.preventDefault();
                editor.redo();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editor]);

    const selectedSection = document.sections.find(section => section.uid === selected) ?? null;
    useEffect(() => {
        if (selected && !selectedSection) setSelected(null);
    }, [selected, selectedSection]);
    // Choosing a section closes the page settings, and opening them unselects the section.
    useEffect(() => {
        if (selected) setPageSettings(false);
    }, [selected]);

    const addSection = (section: SectionData) => {
        if (document.sections.length >= LAYOUT_LIMITS.sections) {
            toast.error(d.tooMany(digits(LAYOUT_LIMITS.sections)));
            return;
        }
        const at = selectedSection
            ? document.sections.indexOf(selectedSection) + 1
            : document.sections.length;
        editor.change(insertSection(document, section, at));
        setSelected(section.uid);
    };

    const applyTemplate = async (name: StarterName) => {
        if (
            document.sections.length &&
            !(await confirm({ title: d.useTemplate, body: d.replaceConfirm, confirmLabel: d.applyTemplate }))
        ) {
            return;
        }
        editor.change(starterLayout(name));
        setSelected(null);
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
        setSelected(null);
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
                    setSelected(first.sectionId);
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
                    tone: 'text-slate-600',
                    spin: editor.status === 'saving',
                };
            case 'offline':
                return { icon: CloudOff, text: d.offline, tone: 'text-amber-700', spin: false };
            case 'error':
                return { icon: CloudOff, text: d.saveFailed, tone: 'text-red-700', spin: false };
            default:
                return { icon: CloudCheck, text: d.saved, tone: 'text-slate-600', spin: false };
        }
    })();
    const liveText = layout.publishedVersion
        ? editor.hasChanges
            ? d.unpublishedChanges
            : d.live(digits(layout.publishedVersion))
        : d.notPublished;

    const moreItems = [
        { label: d.history, icon: History, run: () => setHistoryOpen(true) },
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
        <div className="flex h-dvh flex-col bg-slate-100 text-slate-900">
            {/* Top bar */}
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 sm:px-3">
                <Link
                    to={layout.type === 'page' ? '/store/pages' : landing ? '/sales-pages' : '/'}
                    className="flex size-10 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                                className="block min-h-9 max-w-44 truncate rounded-md border border-transparent bg-white pr-7 pl-2 font-semibold text-slate-900 hover:border-slate-300 focus:outline-2 focus:outline-teal-600 sm:max-w-64"
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
                    <span className="text-slate-300" aria-hidden>
                        ·
                    </span>
                    <span
                        className={cn(
                            editor.hasChanges && layout.publishedVersion
                                ? 'text-amber-700'
                                : 'text-slate-500',
                        )}
                    >
                        {liveText}
                    </span>
                </div>
                <div className="ml-auto flex items-center gap-1">
                    <div
                        className="hidden rounded-md bg-slate-100 p-0.5 lg:flex"
                        role="radiogroup"
                        aria-label={d.previewSize}
                    >
                        {(
                            [
                                { key: 'phone', icon: Smartphone, label: d.phone },
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
                                        ? 'bg-white text-teal-800 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-900',
                                )}
                            >
                                <item.icon className="size-4" aria-hidden />
                            </button>
                        ))}
                    </div>
                    <div
                        className="flex rounded-md bg-slate-100 p-0.5"
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
                                        ? 'bg-white text-teal-800 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-900',
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
                                setSelected(null);
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
                    className={cn(
                        'flex w-full min-w-0 flex-col border-r border-slate-200 bg-white lg:w-[300px] lg:shrink-0',
                        mobileTab === 'preview' && 'max-lg:hidden',
                    )}
                >
                    {selectedSection && definition && !wide ? (
                        <div className="flex min-h-0 flex-1 flex-col">
                            <PanelHeader
                                title={pick(definition.name, ui)}
                                type={selectedSection.type}
                                onClose={() => setSelected(null)}
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
                                onSelect={setSelected}
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
                    className={cn('min-w-0 flex-1 p-2 lg:p-4', mobileTab === 'sections' && 'max-lg:hidden')}
                >
                    <PreviewFrame
                        ref={preview}
                        src={src}
                        device={device}
                        title={d.previewTitle}
                        onMessage={onPreviewMessage}
                    />
                </main>

                {/* Selected section's settings (computers) */}
                <aside className="hidden w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
                    {selectedSection && definition && wide ? (
                        <>
                            <PanelHeader
                                title={pick(definition.name, ui)}
                                type={selectedSection.type}
                                onClose={() => setSelected(null)}
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
                            <div className="flex size-12 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                                <SectionIcon type="hero" className="size-6" />
                            </div>
                            <p className="font-medium">{d.noSelection}</p>
                            <p className="text-sm text-slate-600">{d.noSelectionHint}</p>
                            {layout.publishedAt && (
                                <p className="mt-4 text-xs text-slate-500">
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
            <nav
                className="flex shrink-0 border-t border-slate-200 bg-white lg:hidden"
                aria-label={d.sections}
            >
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
                                ? 'text-teal-800 shadow-[inset_0_2px_0_0_#0f766e]'
                                : 'text-slate-600',
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
                onClose={() => setLibrary(null)}
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
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
            <span className="flex size-7 items-center justify-center rounded bg-teal-700 text-white">
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
                        className="flex size-12 items-center justify-center rounded-md bg-slate-100 text-slate-500"
                    >
                        <SectionIcon type={type} className="size-5" />
                    </span>
                ))}
            </div>
            <p className="mt-2 font-semibold">{d.emptyTitle}</p>
            <p className="text-sm text-slate-600">{d.emptyBody}</p>
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
