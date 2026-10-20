import { formatTaka } from '@ecommbd/shared/money';
import {
    changedSettingsPaths,
    parseStoreSettings,
    POLICY_KEYS,
    type PolicyKey,
    SETTINGS_LIMITS,
    type StoreSettings,
} from '@ecommbd/shared/store-settings';
import { formatDhaka } from '@ecommbd/shared/time';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Lock, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useBlocker } from 'react-router';
import { AddressForm } from '../components/address/address-form';
import { Field } from '../components/form/field';
import { ImageUpload, type UploadedImage } from '../components/form/image-upload';
import { PhoneInput } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Input, Textarea } from '../components/ui/input';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useConfirm } from '../lib/confirm';
import { errorMap, getIn, setIn } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import type { Messages } from '../messages/en';

const SETTINGS_QUERY = `
    query StoreSettings {
        bdStoreSettings {
            settings
            logo { id preview }
            favicon { id preview }
            history { at administratorName fields }
            warnings
        }
    }
`;

const UPDATE_SETTINGS = `
    mutation UpdateStoreSettings($input: JSON!) {
        updateBdStoreSettings(input: $input) {
            settings
            errors { path code }
        }
    }
`;

interface SettingsData {
    bdStoreSettings: {
        settings: StoreSettings;
        logo: UploadedImage | null;
        favicon: UploadedImage | null;
        history: Array<{ at: string; administratorName: string; fields: string[] }>;
        warnings: Array<'currencyNotBdt' | 'pricesExcludeTax'>;
    };
}

type Tab = 'profile' | 'policies' | 'locale';
const TABS: Tab[] = ['profile', 'policies', 'locale'];
const TAB_OF_PATH: Record<string, Tab> = { profile: 'profile', policies: 'policies', locale: 'locale' };

/** Everything the tab sections need to read and change the draft. */
interface Editor {
    draft: StoreSettings;
    set(path: string, value: unknown): void;
    error(path: string): string | undefined;
    m: Messages;
}

export function StoreSettingsPage() {
    const { messages: m, language } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');

    const query = useQuery({
        queryKey: ['storeSettings'],
        queryFn: () => adminApi<SettingsData>(SETTINGS_QUERY),
    });
    const saved = query.data?.bdStoreSettings.settings;
    const [draft, setDraft] = useState<StoreSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<Tab>('profile');
    const [images, setImages] = useState<{ logo: UploadedImage | null; favicon: UploadedImage | null }>({
        logo: null,
        favicon: null,
    });

    useEffect(() => {
        if (query.data && draft === null) {
            setDraft(query.data.bdStoreSettings.settings);
            setImages({ logo: query.data.bdStoreSettings.logo, favicon: query.data.bdStoreSettings.favicon });
        }
    }, [query.data, draft]);

    // Compared field by field: the database may return the keys in another order.
    const dirty = draft !== null && saved !== undefined && changedSettingsPaths(saved, draft).length > 0;

    // Unsaved changes: ask before leaving the page or closing the tab.
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
    );
    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        void confirm({
            title: m.confirm.discardTitle,
            body: m.confirm.discardBody,
            confirmLabel: m.common.discard,
            danger: true,
        }).then(leave => (leave ? blocker.proceed() : blocker.reset()));
    }, [blocker, confirm, m]);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const mutation = useMutation({
        mutationFn: (input: StoreSettings) =>
            adminApi<{
                updateBdStoreSettings: {
                    settings: StoreSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE_SETTINGS, { input }),
    });

    const showErrors = (list: Array<{ path: string; code: string }>) => {
        setErrors(errorMap(list));
        const first = list[0]?.path.split('.')[0];
        if (first && TAB_OF_PATH[first]) setTab(TAB_OF_PATH[first]);
        toast.error(m.settings.fixErrors);
        requestAnimationFrame(() => {
            const field = document.querySelector<HTMLElement>(
                '[data-field-error="true"] :is(input, textarea, select, button)',
            );
            field?.focus();
            field?.scrollIntoView({ block: 'center' });
        });
    };

    const save = async () => {
        if (!draft) return;
        if (!dirty) {
            toast.info(m.settings.noChanges);
            return;
        }
        const checked = parseStoreSettings(draft);
        if (!checked.ok) {
            showErrors(checked.errors);
            return;
        }
        try {
            // If the session has expired, the API client asks to sign in again and then retries:
            // the draft stays on screen the whole time.
            const { updateBdStoreSettings: result } = await mutation.mutateAsync(draft);
            if (result.errors.length || !result.settings) {
                showErrors(result.errors);
                return;
            }
            setErrors({});
            setDraft(result.settings);
            queryClient.setQueryData<SettingsData>(['storeSettings'], old =>
                old ? { bdStoreSettings: { ...old.bdStoreSettings, settings: result.settings! } } : old,
            );
            void queryClient.invalidateQueries({ queryKey: ['storeSettings'] });
            toast.success(m.settings.saved);
        } catch (error) {
            toast.error(
                error instanceof ApiError && error.code === 'FORBIDDEN'
                    ? m.errors.forbidden
                    : error instanceof ApiError && error.code === 'NETWORK'
                      ? m.errors.network
                      : m.errors.generic,
            );
        }
    };

    if (query.isError) {
        return (
            <Alert tone="error">
                <p>{m.errors.generic}</p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={() => void query.refetch()}>
                    {m.common.retry}
                </Button>
            </Alert>
        );
    }
    if (!draft || !query.data) {
        return <PageSkeleton />;
    }

    const editor: Editor = {
        draft,
        m,
        set: (path, value) => {
            setDraft(current => (current ? setIn(current, path, value) : current));
            if (errors[path]) setErrors(({ [path]: _removed, ...rest }) => rest);
        },
        error: path => errors[path],
    };
    const tabHasError = (name: Tab) => Object.keys(errors).some(path => path.startsWith(`${name}.`));
    const { history, warnings } = query.data.bdStoreSettings;
    const lastChange = history[0];

    return (
        <>
            <PageHeader title={m.settings.title} description={m.settings.description} />
            <div className="space-y-4">
                {warnings.map(warning => (
                    <Alert key={warning} tone="warning">
                        {m.settings.warnings[warning]}
                    </Alert>
                ))}
                {!canEdit && <Alert tone="info">{m.settings.readOnly}</Alert>}

                <div
                    role="tablist"
                    aria-label={m.settings.title}
                    className="flex gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1"
                >
                    {TABS.map(name => (
                        <button
                            key={name}
                            type="button"
                            role="tab"
                            id={`tab-${name}`}
                            aria-controls={`panel-${name}`}
                            aria-selected={tab === name}
                            onClick={() => setTab(name)}
                            className={cn(
                                'flex min-h-10 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-medium whitespace-nowrap',
                                tab === name
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900',
                            )}
                        >
                            {m.settings.tabs[name]}
                            {tabHasError(name) && (
                                <span className="size-2 rounded-full bg-red-600" aria-hidden />
                            )}
                        </button>
                    ))}
                </div>

                <form
                    onSubmit={event => {
                        event.preventDefault();
                        void save();
                    }}
                    noValidate
                >
                    <fieldset disabled={!canEdit || mutation.isPending} className="min-w-0 space-y-4">
                        <div
                            role="tabpanel"
                            id={`panel-${tab}`}
                            aria-labelledby={`tab-${tab}`}
                            className="space-y-4"
                        >
                            {tab === 'profile' && (
                                <ProfileTab
                                    editor={editor}
                                    images={images}
                                    onImage={(field, image) => {
                                        setImages(current => ({ ...current, [field]: image }));
                                        editor.set(`profile.${field}AssetId`, image?.id ?? null);
                                    }}
                                />
                            )}
                            {tab === 'policies' && <PoliciesTab editor={editor} />}
                            {tab === 'locale' && <LocaleTab editor={editor} language={language} />}
                        </div>
                    </fieldset>

                    {history.length > 0 && (
                        <details className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                            <summary className="flex cursor-pointer items-center gap-2 text-slate-700">
                                <History className="size-4" aria-hidden />
                                {lastChange &&
                                    m.settings.history.lastChanged(
                                        lastChange.administratorName,
                                        formatDhaka(new Date(lastChange.at), {
                                            withTime: true,
                                            banglaDigits: language === 'bn',
                                        }),
                                    )}
                            </summary>
                            <h2 className="mt-3 mb-1 font-medium">{m.settings.history.title}</h2>
                            <ul className="space-y-1 text-slate-600">
                                {history.slice(0, 10).map(entry => (
                                    <li key={entry.at}>
                                        {formatDhaka(new Date(entry.at), {
                                            withTime: true,
                                            banglaDigits: language === 'bn',
                                        })}{' '}
                                        · {entry.administratorName} ·{' '}
                                        {m.settings.history.fields(entry.fields.length)}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}

                    {canEdit && (
                        <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
                            {dirty && (
                                <span className="mr-auto text-sm text-amber-800">
                                    {m.common.unsavedChanges}
                                </span>
                            )}
                            <Button
                                type="submit"
                                loading={mutation.isPending}
                                className="w-full justify-center sm:w-auto"
                            >
                                {mutation.isPending ? m.common.saving : m.settings.save}
                            </Button>
                        </div>
                    )}
                </form>
            </div>
        </>
    );
}

function Section({
    title,
    description,
    badge,
    children,
}: {
    title: string;
    description?: string;
    badge?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Card>
            <CardHeader title={title} description={description} actions={badge} />
            <CardBody>{children}</CardBody>
        </Card>
    );
}

function TextField({
    editor,
    path,
    label,
    hint,
    optional,
    multiline,
    maxLength,
    type = 'text',
}: {
    editor: Editor;
    path: string;
    label: string;
    hint?: string;
    optional?: boolean;
    multiline?: boolean;
    maxLength?: number;
    type?: string;
}) {
    const value = String(getIn(editor.draft, path) ?? '');
    return (
        <Field label={label} hint={hint} optional={optional} error={editor.error(path)}>
            {control =>
                multiline ? (
                    <Textarea
                        {...control}
                        rows={3}
                        maxLength={maxLength}
                        value={value}
                        onChange={event => editor.set(path, event.target.value)}
                    />
                ) : (
                    <Input
                        {...control}
                        type={type}
                        maxLength={maxLength}
                        value={value}
                        onChange={event => editor.set(path, event.target.value)}
                    />
                )
            }
        </Field>
    );
}

function ProfileTab({
    editor,
    images,
    onImage,
}: {
    editor: Editor;
    images: { logo: UploadedImage | null; favicon: UploadedImage | null };
    onImage(field: 'logo' | 'favicon', image: UploadedImage | null): void;
}) {
    const { draft, m } = editor;
    const f = m.settings.fields;
    const phones = draft.profile.phones.length ? draft.profile.phones : [''];
    const address = draft.profile.address;
    return (
        <>
            <p className="text-sm text-slate-600">{m.settings.publicHint}</p>
            <Section title={m.settings.sections.name} description={f.storeNameHint}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                        editor={editor}
                        path="profile.storeName.bn"
                        label={f.storeNameBn}
                        maxLength={SETTINGS_LIMITS.storeName}
                    />
                    <TextField
                        editor={editor}
                        path="profile.storeName.en"
                        label={f.storeNameEn}
                        maxLength={SETTINGS_LIMITS.storeName}
                    />
                </div>
                {editor.error('profile.storeName') && (
                    <p className="text-sm text-red-700" data-field-error="true">
                        {m.errors.required}
                    </p>
                )}
            </Section>

            <Section title={m.settings.sections.images}>
                <div className="grid gap-6 sm:grid-cols-2">
                    <Field
                        label={f.logo}
                        hint={f.logoHint}
                        optional
                        error={editor.error('profile.logoAssetId')}
                    >
                        {control => (
                            <ImageUpload
                                {...control}
                                value={images.logo}
                                onChange={image => onImage('logo', image)}
                            />
                        )}
                    </Field>
                    <Field
                        label={f.favicon}
                        hint={f.faviconHint}
                        optional
                        error={editor.error('profile.faviconAssetId')}
                    >
                        {control => (
                            <ImageUpload
                                {...control}
                                value={images.favicon}
                                maxMegabytes={1}
                                onChange={image => onImage('favicon', image)}
                            />
                        )}
                    </Field>
                </div>
            </Section>

            <Section title={m.settings.sections.contact}>
                <fieldset className="space-y-2">
                    <legend className="font-medium">{f.phones}</legend>
                    <p className="text-sm text-slate-600">{f.phonesHint}</p>
                    {phones.map((phone, index) => (
                        <div key={index} className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <Field
                                    label={`${f.phones} ${m.common.number(index + 1)}`}
                                    error={editor.error(`profile.phones.${index}`)}
                                >
                                    {control => (
                                        <PhoneInput
                                            {...control}
                                            value={phone}
                                            onChange={value =>
                                                editor.set(
                                                    'profile.phones',
                                                    phones.map((p, i) => (i === index ? value : p)),
                                                )
                                            }
                                        />
                                    )}
                                </Field>
                            </div>
                            {phones.length > 1 && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="mt-8"
                                    aria-label={f.removePhone}
                                    onClick={() =>
                                        editor.set(
                                            'profile.phones',
                                            phones.filter((_, i) => i !== index),
                                        )
                                    }
                                >
                                    <Trash2 className="size-4" aria-hidden />
                                </Button>
                            )}
                        </div>
                    ))}
                    {phones.length < SETTINGS_LIMITS.phones && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => editor.set('profile.phones', [...phones, ''])}
                        >
                            <Plus className="size-4" aria-hidden />
                            {f.addPhone}
                        </Button>
                    )}
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={f.whatsapp} optional error={editor.error('profile.whatsapp')}>
                        {control => (
                            <PhoneInput
                                {...control}
                                value={draft.profile.whatsapp}
                                onChange={value => editor.set('profile.whatsapp', value)}
                            />
                        )}
                    </Field>
                    <TextField editor={editor} path="profile.email" label={f.email} type="email" optional />
                    <TextField
                        editor={editor}
                        path="profile.messengerUrl"
                        label={f.messenger}
                        hint="m.me/yourpage"
                        optional
                    />
                    <TextField
                        editor={editor}
                        path="profile.tradeLicenceNumber"
                        label={f.tradeLicence}
                        optional
                        maxLength={SETTINGS_LIMITS.tradeLicence}
                    />
                </div>
            </Section>

            <Section title={m.settings.sections.address}>
                <AddressForm
                    value={address}
                    onChange={value => editor.set('profile.address', value)}
                    errors={{
                        line: editor.error('profile.address.line'),
                        area: editor.error('profile.address.area'),
                        districtId: editor.error('profile.address.districtId'),
                        thanaId: editor.error('profile.address.thanaId'),
                    }}
                />
            </Section>

            <Section title={m.settings.sections.social}>
                <div className="grid gap-4 sm:grid-cols-2">
                    {(['facebook', 'instagram', 'youtube', 'tiktok'] as const).map(network => (
                        <TextField
                            key={network}
                            editor={editor}
                            path={`profile.social.${network}`}
                            label={f[network]}
                            optional
                            type="url"
                        />
                    ))}
                </div>
            </Section>

            <Section title={m.settings.sections.about}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                        editor={editor}
                        path="profile.businessHours.bn"
                        label={f.businessHoursBn}
                        hint={f.businessHoursHint}
                        optional
                    />
                    <TextField
                        editor={editor}
                        path="profile.businessHours.en"
                        label={f.businessHoursEn}
                        optional
                    />
                    <TextField
                        editor={editor}
                        path="profile.shortDescription.bn"
                        label={f.shortDescriptionBn}
                        optional
                        multiline
                        maxLength={SETTINGS_LIMITS.shortDescription}
                    />
                    <TextField
                        editor={editor}
                        path="profile.shortDescription.en"
                        label={f.shortDescriptionEn}
                        optional
                        multiline
                        maxLength={SETTINGS_LIMITS.shortDescription}
                    />
                </div>
            </Section>

            <Section
                title={m.settings.sections.private}
                badge={
                    <Badge tone="slate">
                        <Lock className="size-3" aria-hidden />
                        {m.settings.privateBadge}
                    </Badge>
                }
            >
                <Field
                    label={f.ownerPhone}
                    hint={f.ownerPhoneHint}
                    optional
                    error={editor.error('profile.ownerPhone')}
                >
                    {control => (
                        <PhoneInput
                            {...control}
                            value={draft.profile.ownerPhone}
                            onChange={value => editor.set('profile.ownerPhone', value)}
                        />
                    )}
                </Field>
            </Section>
        </>
    );
}

function PoliciesTab({ editor }: { editor: Editor }) {
    const { draft, m } = editor;
    const p = m.settings.policies;
    return (
        <>
            {POLICY_KEYS.map((key: PolicyKey) => {
                const policy = draft.policies[key];
                return (
                    <Section
                        key={key}
                        title={p[key]}
                        description={policy.isTemplate ? p.templateHelp : undefined}
                        badge={
                            policy.isTemplate ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone="amber">{p.templateBadge}</Badge>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => editor.set(`policies.${key}.isTemplate`, false)}
                                    >
                                        {p.markReviewed}
                                    </Button>
                                </div>
                            ) : (
                                <Badge tone="teal">{p.reviewed}</Badge>
                            )
                        }
                    >
                        {(['bn', 'en'] as const).map(lang => (
                            <Field
                                key={lang}
                                label={lang === 'bn' ? p.inBangla : p.inEnglish}
                                error={editor.error(`policies.${key}.${lang}`)}
                            >
                                {control => (
                                    <Textarea
                                        {...control}
                                        lang={lang}
                                        rows={8}
                                        maxLength={SETTINGS_LIMITS.policy}
                                        value={policy[lang]}
                                        onChange={event => {
                                            editor.set(`policies.${key}.${lang}`, event.target.value);
                                            if (policy.isTemplate)
                                                editor.set(`policies.${key}.isTemplate`, false);
                                        }}
                                    />
                                )}
                            </Field>
                        ))}
                    </Section>
                );
            })}
        </>
    );
}

function LocaleTab({ editor, language }: { editor: Editor; language: 'bn' | 'en' }) {
    const { draft, m } = editor;
    const l = m.settings.locale;
    const today = new Date();
    const longDate = (lang: 'bn' | 'en') =>
        new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Dhaka',
        }).format(today);
    const radio = 'size-4 accent-teal-700';
    return (
        <Card>
            <CardBody className="space-y-6">
                <fieldset className="space-y-2">
                    <legend className="font-medium">{l.defaultLanguage}</legend>
                    <p className="text-sm text-slate-600">{l.defaultLanguageHint}</p>
                    {(['bn', 'en'] as const).map(option => (
                        <label key={option} className="flex min-h-10 items-center gap-3">
                            <input
                                type="radio"
                                name="defaultLanguage"
                                className={radio}
                                checked={draft.locale.defaultLanguage === option}
                                onChange={() => editor.set('locale.defaultLanguage', option)}
                            />
                            <span lang={option}>{m.language[option]}</span>
                        </label>
                    ))}
                </fieldset>
                <Switch
                    checked={draft.locale.banglaDigits}
                    onChange={checked => editor.set('locale.banglaDigits', checked)}
                    label={l.banglaDigits}
                    description={l.banglaDigitsExample(
                        formatTaka(125000, { banglaDigits: true }),
                        formatTaka(125000),
                    )}
                />
                <fieldset className="space-y-2">
                    <legend className="font-medium">{l.dateFormat}</legend>
                    {(['numeric', 'long'] as const).map(option => (
                        <label key={option} className="flex min-h-10 items-center gap-3">
                            <input
                                type="radio"
                                name="dateFormat"
                                className={radio}
                                checked={draft.locale.dateFormat === option}
                                onChange={() => editor.set('locale.dateFormat', option)}
                            />
                            <span>
                                {option === 'numeric' ? l.dateNumeric : l.dateLong}
                                <span className="ml-2 text-sm text-slate-600">
                                    {option === 'numeric'
                                        ? formatDhaka(today, { banglaDigits: language === 'bn' })
                                        : longDate(language)}
                                </span>
                            </span>
                        </label>
                    ))}
                </fieldset>
            </CardBody>
        </Card>
    );
}
