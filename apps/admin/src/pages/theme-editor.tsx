import '@fontsource/noto-serif-bengali/400.css';
import '@fontsource/noto-serif-bengali/600.css';
import {
    checkThemeInput,
    contrastRatio,
    defaultThemeSettings,
    FONT_INFO,
    FONTS,
    normalizeHex,
    pick,
    readableOn,
    THEME_INFO,
    themeAttributes,
    themeVariables,
    THEMES,
    type ThemeName,
    type ThemeProblem,
    type ThemeSettings,
} from '@ecommbd/sections';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleAlert, CircleCheck, Monitor, RotateCcw, Smartphone } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
    createPreviewLink,
    fetchLayout,
    fetchStoreLogo,
    fetchTheme,
    updateTheme,
} from '../components/design/design-api';
import { Segmented } from '../components/design/field-controls';
import {
    type Device,
    type PreviewHandle,
    type PreviewMessage,
    PreviewFrame,
} from '../components/design/preview-frame';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

/**
 * Online store → Theme (roadmap phase 15): the two themes and the few settings a merchant may
 * change, with the home page beside them. Changes show in the preview as they're made (sent to
 * the storefront's preview script, nothing saved until "Save theme"); text that would be hard to
 * read can't be saved.
 */
export function ThemeEditorPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const theme = useQuery({ queryKey: ['themeSettings'], queryFn: fetchTheme, staleTime: 0 });
    if (!can('EditStorefront')) {
        return <p className="p-10 text-center text-slate-700">{m.errors.forbidden}</p>;
    }
    if (theme.isPending || !theme.data) {
        return (
            <div className="mx-auto max-w-5xl p-6">
                <PageSkeleton />
            </div>
        );
    }
    return <ThemeEditor saved={theme.data} />;
}

const COLOUR_KEYS = ['background', 'text', 'accent', 'sale'] as const;

function ThemeEditor({ saved }: { saved: ThemeSettings }) {
    const { messages: m, language: ui } = useI18n();
    const t = m.themeEditor;
    const d = m.design;
    const toast = useToast();
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<ThemeSettings>(saved);
    const [baseline, setBaseline] = useState(saved);
    const [device, setDevice] = useState<Device>('phone');
    const [mobileTab, setMobileTab] = useState<'settings' | 'preview'>('settings');
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const preview = useRef<PreviewHandle>(null);
    const dirty = JSON.stringify(settings) !== JSON.stringify(baseline);
    const checked = useMemo(() => checkThemeInput(settings), [settings]);
    const problem = (key: string, list: ThemeProblem[]) => list.find(item => item.path === `colours.${key}`);
    const digits = (text: string) =>
        ui === 'bn' ? text.replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : text;

    const home = useQuery({
        queryKey: ['pageLayout', 'home', ''],
        queryFn: () => fetchLayout('home'),
        staleTime: 60_000,
    });
    const link = useQuery({
        queryKey: ['themePreview', home.data?.id, ui],
        enabled: !!home.data,
        queryFn: () => createPreviewLink(home.data!.id, ui),
        staleTime: Infinity,
        gcTime: 0,
    });
    const store = useQuery({ queryKey: ['storeLogo'], queryFn: fetchStoreLogo, staleTime: 60_000 });

    // The preview follows every change before it's saved.
    const sendTheme = useCallback(() => {
        preview.current?.post({
            type: 'theme',
            attributes: themeAttributes(settings),
            variables: themeVariables(settings),
            announcement: {
                enabled: settings.announcement.enabled,
                text: pick(settings.announcement.text, ui),
            },
        });
    }, [settings, ui]);
    useEffect(sendTheme, [sendTheme]);
    const onMessage = useCallback(
        (message: PreviewMessage) => message.type === 'ready' && sendTheme(),
        [sendTheme],
    );

    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (dirty) event.preventDefault();
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const save = useMutation({
        mutationFn: () => updateTheme(settings),
        onSuccess: result => {
            if (result.settings) {
                setSettings(result.settings);
                setBaseline(result.settings);
                queryClient.setQueryData(['themeSettings'], result.settings);
                toast.success(t.saved);
            } else {
                toast.error(t.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });

    const set = (patch: Partial<ThemeSettings>) => setSettings(current => ({ ...current, ...patch }));
    const switchTheme = (theme: ThemeName) => {
        if (theme === settings.theme) return;
        setSettings(defaultThemeSettings(theme, settings.announcement));
        setDrafts({});
        toast.info(t.switchedTheme);
    };
    const setColour = (key: (typeof COLOUR_KEYS)[number], value: string) => {
        setDrafts(current => ({ ...current, [key]: value }));
        const hex = normalizeHex(value);
        if (hex) setSettings(current => ({ ...current, colours: { ...current.colours, [key]: hex } }));
    };

    return (
        <div className="flex h-dvh flex-col bg-slate-100 text-slate-900">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 sm:px-3">
                <Link
                    to="/"
                    className="flex size-10 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    aria-label={d.back}
                    title={d.back}
                >
                    <ArrowLeft className="size-5" aria-hidden />
                </Link>
                <h1 className="font-semibold">{t.title}</h1>
                {dirty && <span className="hidden text-xs text-amber-700 sm:inline">{t.unsaved}</span>}
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
                    <Button
                        size="sm"
                        loading={save.isPending}
                        disabled={!dirty || checked.errors.length > 0}
                        onClick={() => save.mutate()}
                    >
                        {t.save}
                    </Button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                <aside
                    className={cn(
                        'relative w-full min-w-0 overflow-y-auto border-r border-slate-200 bg-white lg:w-[380px] lg:shrink-0',
                        mobileTab === 'preview' && 'max-lg:hidden',
                    )}
                >
                    <p className="border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
                        {t.description}
                    </p>

                    <Group title={t.theme}>
                        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t.theme}>
                            {THEMES.map(name => (
                                <button
                                    key={name}
                                    type="button"
                                    role="radio"
                                    aria-checked={settings.theme === name}
                                    onClick={() => switchTheme(name)}
                                    className={cn(
                                        'overflow-hidden rounded-lg border text-left transition',
                                        settings.theme === name
                                            ? 'border-teal-700 ring-2 ring-teal-700/20'
                                            : 'border-slate-200 hover:border-slate-400',
                                    )}
                                >
                                    <ThemeSwatch name={name} />
                                    <span className="flex items-center justify-between gap-2 px-3 pt-2 font-medium">
                                        {pick(THEME_INFO[name].name, ui)}
                                        {settings.theme === name && (
                                            <Check className="size-4 text-teal-700" aria-hidden />
                                        )}
                                    </span>
                                    <span className="block px-3 pt-0.5 pb-3 text-xs leading-snug text-slate-600">
                                        {pick(THEME_INFO[name].description, ui)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </Group>

                    <Group
                        title={t.colours}
                        action={
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:underline"
                                onClick={() => {
                                    set({ colours: defaultThemeSettings(settings.theme).colours });
                                    setDrafts({});
                                }}
                            >
                                <RotateCcw className="size-3.5" aria-hidden />
                                {t.resetColours}
                            </button>
                        }
                    >
                        <div className="space-y-4">
                            {COLOUR_KEYS.map(key => {
                                const value = settings.colours[key];
                                const draft = drafts[key] ?? value;
                                const invalid = normalizeHex(draft) === null;
                                const error = problem(key, checked.errors);
                                const warning = problem(key, checked.warnings);
                                const ratio =
                                    key === 'text' || key === 'background'
                                        ? contrastRatio(settings.colours.text, settings.colours.background)
                                        : contrastRatio(value, readableOn(value));
                                const ratioText = digits((Math.floor(ratio * 10) / 10).toFixed(1));
                                const id = `colour-${key}`;
                                return (
                                    <div key={key}>
                                        <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
                                            {t.colourLabels[key]}
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={value}
                                                aria-label={t.colourLabels[key]}
                                                onChange={event => setColour(key, event.target.value)}
                                                className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-1"
                                            />
                                            <Input
                                                id={id}
                                                value={draft}
                                                maxLength={7}
                                                spellCheck={false}
                                                aria-invalid={invalid || !!error ? true : undefined}
                                                onChange={event => setColour(key, event.target.value)}
                                                onBlur={() =>
                                                    setDrafts(current => ({ ...current, [key]: value }))
                                                }
                                                className="font-mono uppercase"
                                            />
                                        </div>
                                        {invalid ? (
                                            <p className="mt-1 text-xs text-red-700">{t.invalidColour}</p>
                                        ) : error && key === 'text' ? (
                                            <Note tone="error">{t.contrastLow(ratioText)}</Note>
                                        ) : warning ? (
                                            <Note tone="warning">
                                                {t.contrastWeak(digits(String(warning.ratio ?? '')))}
                                            </Note>
                                        ) : key !== 'background' ? (
                                            <Note tone="ok">{t.contrastOk(ratioText)}</Note>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </Group>

                    <Group title={t.font}>
                        <div className="space-y-2" role="radiogroup" aria-label={t.font}>
                            {FONTS.map(font => (
                                <button
                                    key={font}
                                    type="button"
                                    role="radio"
                                    aria-checked={settings.font === font}
                                    onClick={() => set({ font })}
                                    className={cn(
                                        'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left',
                                        settings.font === font
                                            ? 'border-teal-700 bg-teal-50/60'
                                            : 'border-slate-200 hover:border-slate-400',
                                    )}
                                >
                                    <span className="min-w-0">
                                        <span className="block text-xs text-slate-500">
                                            {pick(FONT_INFO[font].name, ui)}
                                        </span>
                                        <span
                                            className="block truncate text-lg"
                                            style={{ fontFamily: FONT_INFO[font].family }}
                                        >
                                            {t.fontSample}
                                        </span>
                                    </span>
                                    {settings.font === font && (
                                        <Check className="size-4 shrink-0 text-teal-700" aria-hidden />
                                    )}
                                </button>
                            ))}
                        </div>
                    </Group>

                    <Group title={t.buttons}>
                        <Segmented
                            label={t.buttons}
                            value={settings.buttons}
                            onChange={buttons => set({ buttons })}
                            options={(['solid', 'outline', 'rounded'] as const).map(value => ({
                                value,
                                label: t.buttonOptions[value]!,
                            }))}
                        />
                        <div className="mt-3 flex gap-2" aria-hidden>
                            <span
                                className={cn(
                                    'inline-flex h-9 items-center px-4 text-sm font-medium',
                                    settings.buttons === 'rounded' ? 'rounded' : 'rounded-none',
                                    settings.buttons === 'outline' ? 'border-2' : '',
                                )}
                                style={
                                    settings.buttons === 'outline'
                                        ? {
                                              borderColor: settings.colours.accent,
                                              color: settings.colours.accent,
                                          }
                                        : {
                                              background: settings.colours.accent,
                                              color: readableOn(settings.colours.accent),
                                          }
                                }
                            >
                                {t.buttonSample}
                            </span>
                        </div>
                    </Group>

                    <Group title={t.header}>
                        <OptionCards
                            value={settings.header}
                            onChange={header => set({ header })}
                            options={(['left', 'center'] as const).map(value => ({
                                value,
                                label: t.headerOptions[value]!,
                                drawing: <HeaderDrawing layout={value} />,
                            }))}
                        />
                    </Group>

                    <Group title={t.cards}>
                        <OptionCards
                            value={settings.cards}
                            onChange={cards => set({ cards })}
                            options={(['plain', 'card'] as const).map(value => ({
                                value,
                                label: t.cardOptions[value]!,
                                drawing: <CardDrawing style={value} />,
                            }))}
                        />
                    </Group>

                    <Group title={t.logo}>
                        <div className="mb-3 flex items-center gap-3">
                            <span className="flex h-14 w-28 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 px-2">
                                {store.data?.logo ? (
                                    <img
                                        src={`${store.data.logo.preview}?preset=small`}
                                        alt=""
                                        className="max-h-10 w-auto"
                                    />
                                ) : (
                                    <span className="truncate text-sm font-semibold">
                                        {store.data ? pick(store.data.storeName, ui) : ''}
                                    </span>
                                )}
                            </span>
                            <div className="min-w-0 text-sm">
                                {!store.data?.logo && <p className="text-slate-600">{t.noLogo}</p>}
                                <Link
                                    to="/settings/store"
                                    className="font-medium text-teal-800 hover:underline"
                                >
                                    {t.changeLogo}
                                </Link>
                            </div>
                        </div>
                        <Segmented
                            label={t.logoSize}
                            value={settings.logoSize}
                            onChange={logoSize => set({ logoSize })}
                            options={(['s', 'm', 'l'] as const).map(value => ({
                                value,
                                label: t.logoSizes[value]!,
                            }))}
                        />
                    </Group>

                    <Group title={t.announcement}>
                        <Switch
                            checked={settings.announcement.enabled}
                            onChange={enabled => set({ announcement: { ...settings.announcement, enabled } })}
                            label={t.showAnnouncement}
                        />
                        {settings.announcement.enabled && (
                            <div className="mt-4 space-y-3">
                                {(['bn', 'en'] as const).map(code => (
                                    <div key={code}>
                                        <label
                                            htmlFor={`announcement-${code}`}
                                            className="mb-1.5 flex items-center justify-between text-sm font-medium"
                                        >
                                            {t.announcementText}
                                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                                {code === 'bn' ? 'বাংলা' : 'English'}
                                            </span>
                                        </label>
                                        <Input
                                            id={`announcement-${code}`}
                                            lang={code}
                                            maxLength={120}
                                            value={settings.announcement.text[code]}
                                            onChange={event =>
                                                set({
                                                    announcement: {
                                                        ...settings.announcement,
                                                        text: {
                                                            ...settings.announcement.text,
                                                            [code]: event.target.value,
                                                        },
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </Group>
                </aside>

                <main
                    className={cn('min-w-0 flex-1 p-2 lg:p-4', mobileTab === 'settings' && 'max-lg:hidden')}
                >
                    <PreviewFrame
                        ref={preview}
                        src={link.data?.url ?? null}
                        device={device}
                        title={d.previewTitle}
                        onMessage={onMessage}
                    />
                </main>
            </div>

            <nav className="flex shrink-0 border-t border-slate-200 bg-white lg:hidden">
                {(
                    [
                        { key: 'settings', label: t.title },
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
        </div>
    );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="border-b border-slate-100 px-4 py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function Note({ tone, children }: { tone: 'ok' | 'warning' | 'error'; children: string }) {
    const Icon = tone === 'ok' ? CircleCheck : CircleAlert;
    return (
        <p
            className={cn(
                'mt-1.5 flex items-start gap-1.5 text-xs',
                tone === 'ok' ? 'text-slate-600' : tone === 'warning' ? 'text-amber-700' : 'text-red-700',
            )}
        >
            <Icon className={cn('mt-px size-3.5 shrink-0', tone === 'ok' && 'text-teal-700')} aria-hidden />
            {children}
        </p>
    );
}

function OptionCards<T extends string>({
    value,
    onChange,
    options,
}: {
    value: T;
    onChange(value: T): void;
    options: Array<{ value: T; label: string; drawing: ReactNode }>;
}) {
    return (
        <div className="grid grid-cols-2 gap-3" role="radiogroup">
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={value === option.value}
                    onClick={() => onChange(option.value)}
                    className={cn(
                        'rounded-lg border p-2 text-left transition',
                        value === option.value
                            ? 'border-teal-700 ring-2 ring-teal-700/20'
                            : 'border-slate-200 hover:border-slate-400',
                    )}
                >
                    <span className="block overflow-hidden rounded border border-slate-100 bg-white">
                        {option.drawing}
                    </span>
                    <span className="mt-2 block text-sm font-medium">{option.label}</span>
                </button>
            ))}
        </div>
    );
}

/** A tiny storefront in each theme's own colours, for the theme cards. */
function ThemeSwatch({ name }: { name: ThemeName }) {
    const { colours, cards } = defaultThemeSettings(name);
    const bazaar = name === 'bazaar';
    return (
        <svg viewBox="0 0 160 96" className="block w-full border-b border-slate-100" aria-hidden>
            <rect width={160} height={96} fill={colours.background} />
            <rect width={160} height={16} fill={bazaar ? colours.accent : colours.background} />
            <rect
                x={bazaar ? 64 : 8}
                y={6}
                width={32}
                height={4}
                rx={1}
                fill={bazaar ? readableOn(colours.accent) : colours.text}
            />
            {!bazaar && <rect y={16} width={160} height={0.75} fill="#e3e3e3" />}
            {(bazaar ? [0, 1, 2, 3] : [0, 1, 2]).map(index => {
                const columns = bazaar ? 4 : 3;
                const gap = bazaar ? 4 : 8;
                const width = (160 - 16 - gap * (columns - 1)) / columns;
                const x = 8 + index * (width + gap);
                return (
                    <g key={index}>
                        {cards === 'card' && (
                            <rect
                                x={x - 1}
                                y={23}
                                width={width + 2}
                                height={66}
                                rx={2}
                                fill="none"
                                stroke="#e2e6e4"
                            />
                        )}
                        <rect x={x} y={24} width={width} height={width} fill="#e8ecea" />
                        <rect
                            x={x}
                            y={28 + width}
                            width={width * 0.7}
                            height={3}
                            rx={1}
                            fill={colours.text}
                            opacity={0.6}
                        />
                        <rect
                            x={x}
                            y={34 + width}
                            width={width * 0.45}
                            height={3.5}
                            rx={1}
                            fill={bazaar ? colours.accent : colours.text}
                        />
                    </g>
                );
            })}
        </svg>
    );
}

function HeaderDrawing({ layout }: { layout: 'left' | 'center' }) {
    return (
        <svg viewBox="0 0 120 40" className="block w-full" aria-hidden>
            <rect width={120} height={40} fill="#ffffff" />
            {layout === 'left' ? (
                <>
                    <rect x={8} y={14} width={24} height={6} rx={1} fill="#334155" />
                    <rect x={40} y={15} width={12} height={4} rx={1} fill="#94a3b8" />
                    <rect x={56} y={15} width={12} height={4} rx={1} fill="#94a3b8" />
                    <rect x={86} y={12} width={26} height={10} rx={1} fill="none" stroke="#cbd5e1" />
                </>
            ) : (
                <>
                    <rect x={8} y={9} width={22} height={8} rx={1} fill="none" stroke="#cbd5e1" />
                    <rect x={48} y={9} width={24} height={7} rx={1} fill="#334155" />
                    <rect x={104} y={10} width={8} height={6} rx={1} fill="#94a3b8" />
                    <rect x={36} y={26} width={14} height={4} rx={1} fill="#94a3b8" />
                    <rect x={54} y={26} width={14} height={4} rx={1} fill="#94a3b8" />
                    <rect x={72} y={26} width={14} height={4} rx={1} fill="#94a3b8" />
                </>
            )}
            <rect y={39} width={120} height={1} fill="#e2e8f0" />
        </svg>
    );
}

function CardDrawing({ style }: { style: 'plain' | 'card' }) {
    return (
        <svg viewBox="0 0 120 60" className="block w-full" aria-hidden>
            <rect width={120} height={60} fill="#ffffff" />
            {[0, 1, 2].map(index => {
                const x = 8 + index * 36;
                return (
                    <g key={index}>
                        {style === 'card' && (
                            <rect
                                x={x - 2}
                                y={5}
                                width={36}
                                height={50}
                                rx={2}
                                fill="none"
                                stroke="#cbd5e1"
                            />
                        )}
                        <rect x={x} y={7} width={32} height={28} fill="#e2e8f0" />
                        <rect x={x} y={39} width={24} height={3} rx={1} fill="#94a3b8" />
                        <rect x={x} y={45} width={14} height={4} rx={1} fill="#334155" />
                    </g>
                );
            })}
        </svg>
    );
}
