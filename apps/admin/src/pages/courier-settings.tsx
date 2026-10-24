import {
    COURIER_CREDENTIAL_FIELDS,
    COURIERS,
    type Courier,
    type CourierMode,
    type CourierSettings,
    PATHAO_DELIVERY_TYPES,
    PATHAO_ITEM_TYPES,
} from '@ecommbd/shared/couriers';
import { SHIPPING_ZONES } from '@ecommbd/shared/shipping';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

interface CredentialsView {
    courier: Courier;
    mode: CourierMode;
    complete: boolean;
    fields: Array<{ name: string; saved: boolean; value: string | null }>;
}

interface Setup {
    settings: CourierSettings;
    credentials: CredentialsView[];
    webhooks: Array<{ courier: Courier; url: string | null; secret: string | null }>;
    keyringConfigured: boolean;
    pathaoCities: number;
}

const SETUP = `{
    bdCourierSetup {
        settings keyringConfigured pathaoCities
        credentials { courier mode complete fields { name saved value } }
        webhooks { courier url secret }
    }
}`;
const UPDATE = `mutation ($input: JSON!) { updateBdCourierSettings(input: $input) { settings errors { path code } } }`;
const SAVE = `mutation ($courier: String!, $mode: String!, $input: JSON!) {
    saveBdCourierCredentials(courier: $courier, mode: $mode, input: $input) { credentials { complete } errors { path code } }
}`;
const TEST = `mutation ($courier: String!, $mode: String!) { testBdCourierConnection(courier: $courier, mode: $mode) { ok message } }`;
const STORES = `{ bdPathaoStores { id name } }`;
const SYNC = `mutation { syncBdPathaoLocations { cities zones } }`;

/**
 * Couriers (roadmap phase 19): Steadfast and Pathao on or off, Pathao's store and mode, the default
 * courier for each delivery zone, credentials (write-only) with Test connection, and the webhook
 * address to paste into each courier's panel.
 */
export function CourierSettingsPage() {
    const { messages: m } = useI18n();
    const c = m.couriers.settings;
    const { can } = useAuth();
    const toast = useToast();
    const digits = useDigits();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');
    const query = useQuery({
        queryKey: ['courierSetup'],
        queryFn: () => adminApi<{ bdCourierSetup: Setup }>(SETUP).then(r => r.bdCourierSetup),
    });
    const pathaoReady = !!query.data?.credentials.find(
        item => item.courier === 'pathao' && item.mode === query.data?.settings.pathao.mode,
    )?.complete;
    const stores = useQuery({
        queryKey: ['pathaoStores', query.data?.settings.pathao.mode],
        queryFn: () =>
            adminApi<{ bdPathaoStores: Array<{ id: string; name: string }> }>(STORES).then(
                r => r.bdPathaoStores,
            ),
        enabled: pathaoReady,
    });
    const [draft, setDraft] = useState<CourierSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data.settings);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: CourierSettings) =>
            adminApi<{
                updateBdCourierSettings: {
                    settings: CourierSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(r => r.updateBdCourierSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(c.settingsSaved);
                void queryClient.invalidateQueries({ queryKey: ['courierSetup'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    const sync = useMutation({
        mutationFn: () =>
            adminApi<{ syncBdPathaoLocations: { cities: number; zones: number } }>(SYNC).then(
                r => r.syncBdPathaoLocations,
            ),
        onSuccess: result => {
            toast.success(c.synced(result.cities, result.zones));
            void queryClient.invalidateQueries({ queryKey: ['courierSetup'] });
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft || !query.data) return <PageSkeleton />;
    const setup = query.data;
    const name = (courier: string) => m.couriers.names[courier] ?? courier;

    return (
        <>
            <PageHeader title={c.title} description={c.description} />
            <div className="mb-4 space-y-2">
                {!canEdit && <Alert>{m.payments.settings.readOnly}</Alert>}
                {!setup.keyringConfigured && <Alert tone="warning">{c.noKeyring}</Alert>}
            </div>
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={name('steadfast')} />
                    <CardBody>
                        <Switch
                            label={c.on(name('steadfast'))}
                            checked={draft.steadfast.enabled}
                            disabled={!canEdit}
                            onChange={checked => setDraft({ ...draft, steadfast: { enabled: checked } })}
                        />
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={name('pathao')} />
                    <CardBody className="space-y-4">
                        <Switch
                            label={c.on(name('pathao'))}
                            checked={draft.pathao.enabled}
                            disabled={!canEdit}
                            onChange={checked =>
                                setDraft({ ...draft, pathao: { ...draft.pathao, enabled: checked } })
                            }
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label={c.mode}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.pathao.mode}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                pathao: {
                                                    ...draft.pathao,
                                                    mode: event.target.value as CourierMode,
                                                },
                                            })
                                        }
                                    >
                                        {(['sandbox', 'live'] as const).map(mode => (
                                            <option key={mode} value={mode}>
                                                {c.modes[mode]}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                            <Field
                                label={c.store}
                                hint={
                                    pathaoReady
                                        ? stores.data?.length === 0
                                            ? c.noStores
                                            : undefined
                                        : c.storeHint
                                }
                                error={errors['pathao.storeId']}
                            >
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.pathao.storeId}
                                        disabled={!canEdit || !pathaoReady}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                pathao: { ...draft.pathao, storeId: event.target.value },
                                            })
                                        }
                                    >
                                        <option value="">—</option>
                                        {draft.pathao.storeId &&
                                            !stores.data?.some(
                                                store => store.id === draft.pathao.storeId,
                                            ) && (
                                                <option value={draft.pathao.storeId}>
                                                    {draft.pathao.storeId}
                                                </option>
                                            )}
                                        {(stores.data ?? []).map(store => (
                                            <option key={store.id} value={store.id}>
                                                {store.name}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                            <Field label={c.deliveryType}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.pathao.deliveryType}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                pathao: {
                                                    ...draft.pathao,
                                                    deliveryType: Number(event.target.value) as 48 | 12,
                                                },
                                            })
                                        }
                                    >
                                        {PATHAO_DELIVERY_TYPES.map(type => (
                                            <option key={type} value={type}>
                                                {c.deliveryTypes[type]}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                            <Field label={c.itemType}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.pathao.itemType}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                pathao: {
                                                    ...draft.pathao,
                                                    itemType: Number(event.target.value) as 2 | 1,
                                                },
                                            })
                                        }
                                    >
                                        {PATHAO_ITEM_TYPES.map(type => (
                                            <option key={type} value={type}>
                                                {c.itemTypes[type]}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm text-slate-600">
                                {c.pathaoPlaces(setup.pathaoCities)}
                            </span>
                            {canEdit && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    loading={sync.isPending}
                                    disabled={!pathaoReady}
                                    onClick={() => sync.mutate()}
                                >
                                    {c.syncPlaces}
                                </Button>
                            )}
                        </div>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={c.defaults} description={c.defaultsHint} />
                    <CardBody className="grid gap-4 sm:grid-cols-2">
                        {SHIPPING_ZONES.map(zone => (
                            <Field key={zone} label={m.delivery.zones[zone]}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.defaultByZone[zone]}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                defaultByZone: {
                                                    ...draft.defaultByZone,
                                                    [zone]: event.target.value as Courier | '',
                                                },
                                            })
                                        }
                                    >
                                        <option value="">{c.chooseEachTime}</option>
                                        {COURIERS.map(courier => (
                                            <option key={courier} value={courier}>
                                                {name(courier)}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                        ))}
                        <Field label={c.weight} error={errors.defaultWeightGrams}>
                            {control => (
                                <div className="flex items-center gap-2">
                                    <div className="w-28 flex-none">
                                        <Input
                                            {...control}
                                            inputMode="numeric"
                                            value={digits(draft.defaultWeightGrams)}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                setDraft({
                                                    ...draft,
                                                    defaultWeightGrams: Number(
                                                        banglaToAsciiDigits(event.target.value.trim()) || 0,
                                                    ),
                                                })
                                            }
                                        />
                                    </div>
                                    <span className="text-sm text-slate-600">{c.grams}</span>
                                </div>
                            )}
                        </Field>
                    </CardBody>
                </Card>
                {canEdit && (
                    <Button type="submit" loading={save.isPending}>
                        {m.settings.save}
                    </Button>
                )}
            </form>

            {canEdit && setup.keyringConfigured && (
                <div className="mt-6 space-y-4">
                    {setup.credentials.map(view => (
                        <CredentialsCard
                            key={`${view.courier}-${view.mode}`}
                            view={view}
                            onSaved={() => void queryClient.invalidateQueries({ queryKey: ['courierSetup'] })}
                        />
                    ))}
                    {setup.webhooks
                        .filter(hook => hook.url)
                        .map(hook => (
                            <Card key={hook.courier}>
                                <CardHeader
                                    title={c.webhook(name(hook.courier))}
                                    description={c.webhookHint(name(hook.courier))}
                                />
                                <CardBody className="space-y-2 text-sm">
                                    <p>
                                        {c.webhookUrl}:{' '}
                                        <span className="font-mono break-all">{hook.url}</span>
                                    </p>
                                    <p>
                                        {c.webhookSecret}:{' '}
                                        <span className="font-mono break-all">{hook.secret}</span>
                                    </p>
                                </CardBody>
                            </Card>
                        ))}
                </div>
            )}
        </>
    );
}

function CredentialsCard({ view, onSaved }: { view: CredentialsView; onSaved(): void }) {
    const { messages: m } = useI18n();
    const c = m.couriers.settings;
    const toast = useToast();
    const [values, setValues] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [tested, setTested] = useState<{ ok: boolean; message: string | null } | null>(null);
    const save = useMutation({
        mutationFn: () =>
            adminApi<{
                saveBdCourierCredentials: {
                    credentials: { complete: boolean } | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(SAVE, { courier: view.courier, mode: view.mode, input: values }).then(
                r => r.saveBdCourierCredentials,
            ),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.credentials) {
                setValues({});
                setTested(null);
                toast.success(c.credentialsSaved);
                onSaved();
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    const test = useMutation({
        mutationFn: () =>
            adminApi<{ testBdCourierConnection: { ok: boolean; message: string | null } }>(TEST, {
                courier: view.courier,
                mode: view.mode,
            }).then(r => r.testBdCourierConnection),
        onSuccess: setTested,
        onError: () => toast.error(m.errors.generic),
    });
    const courierName = m.couriers.names[view.courier] ?? view.courier;
    return (
        <Card>
            <CardHeader
                title={c.credentials(courierName, c.modes[view.mode] ?? view.mode)}
                description={c.credentialsHint}
            />
            <CardBody>
                <form
                    className="space-y-4"
                    onSubmit={event => {
                        event.preventDefault();
                        save.mutate();
                    }}
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        {COURIER_CREDENTIAL_FIELDS[view.courier].map(field => {
                            const saved = view.fields.find(item => item.name === field);
                            const secret = saved?.value === null || saved?.value === undefined;
                            return (
                                <Field
                                    key={field}
                                    label={c.fields[field] ?? field}
                                    hint={
                                        saved?.saved
                                            ? saved.value
                                                ? `${c.saved}: ${saved.value}`
                                                : c.saved
                                            : c.notSaved
                                    }
                                    error={errors[field]}
                                >
                                    {control => (
                                        <Input
                                            {...control}
                                            type={secret ? 'password' : 'text'}
                                            autoComplete="off"
                                            value={values[field] ?? ''}
                                            onChange={event =>
                                                setValues({ ...values, [field]: event.target.value })
                                            }
                                        />
                                    )}
                                </Field>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button type="submit" loading={save.isPending}>
                            {c.saveCredentials}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            loading={test.isPending}
                            disabled={!view.complete}
                            onClick={() => test.mutate()}
                        >
                            {c.test}
                        </Button>
                    </div>
                    {tested && (
                        <Alert tone={tested.ok ? 'info' : 'error'}>
                            {tested.ok ? c.testOk : c.testFailed(tested.message ?? '')}
                        </Alert>
                    )}
                </form>
            </CardBody>
        </Card>
    );
}
