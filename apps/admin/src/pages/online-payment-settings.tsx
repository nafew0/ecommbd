import {
    GATEWAY_CREDENTIAL_FIELDS,
    GATEWAY_MODES,
    type GatewayMode,
    ONLINE_GATEWAYS,
    type OnlineGateway,
    type OnlinePaymentSettings,
} from '@ecommbd/shared/online-payments';
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
    gateway: OnlineGateway;
    mode: GatewayMode;
    complete: boolean;
    fields: Array<{ name: string; saved: boolean; value: string | null }>;
}

interface Setup {
    settings: OnlinePaymentSettings;
    credentials: CredentialsView[];
    health: Array<{ gateway: OnlineGateway; paused: boolean }>;
    keyringConfigured: boolean;
    publicUrlConfigured: boolean;
    ipnUrl: string | null;
}

const SETUP = `{
    bdOnlinePaymentSetup {
        settings keyringConfigured publicUrlConfigured ipnUrl
        credentials { gateway mode complete fields { name saved value } }
        health { gateway paused }
    }
}`;

const UPDATE = `mutation ($input: JSON!) {
    updateBdOnlinePaymentSettings(input: $input) { settings errors { path code } }
}`;

const SAVE_CREDENTIALS = `mutation ($gateway: String!, $mode: String!, $input: JSON!) {
    saveBdGatewayCredentials(gateway: $gateway, mode: $mode, input: $input) {
        credentials { complete }
        errors { path code }
    }
}`;

const TEST = `mutation ($gateway: String!, $mode: String!) {
    testBdGatewayConnection(gateway: $gateway, mode: $mode) { ok message }
}`;

/**
 * Online payments (roadmap phase 18): SSLCommerz and bKash on or off, sandbox or live, their
 * credentials (write-only: secrets are never shown again) with "Test connection", and how long an
 * unpaid online order waits.
 */
export function OnlinePaymentSettingsPage() {
    const { messages: m } = useI18n();
    const o = m.onlinePayments;
    const { can } = useAuth();
    const toast = useToast();
    const digits = useDigits();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');
    const query = useQuery({
        queryKey: ['onlinePaymentSetup'],
        queryFn: () => adminApi<{ bdOnlinePaymentSetup: Setup }>(SETUP).then(r => r.bdOnlinePaymentSetup),
    });
    const [draft, setDraft] = useState<OnlinePaymentSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data.settings);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: OnlinePaymentSettings) =>
            adminApi<{
                updateBdOnlinePaymentSettings: {
                    settings: OnlinePaymentSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(r => r.updateBdOnlinePaymentSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(o.settingsSaved);
                void queryClient.invalidateQueries({ queryKey: ['onlinePaymentSetup'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft || !query.data) return <PageSkeleton />;
    const setup = query.data;
    const gatewayPatch = (gateway: OnlineGateway, patch: Partial<OnlinePaymentSettings[OnlineGateway]>) =>
        setDraft({ ...draft, [gateway]: { ...draft[gateway], ...patch } });

    return (
        <>
            <PageHeader title={o.title} description={o.description} />
            <div className="mb-4 space-y-2">
                {!canEdit && <Alert>{m.payments.settings.readOnly}</Alert>}
                {!setup.keyringConfigured && <Alert tone="warning">{o.noKeyring}</Alert>}
                {!setup.publicUrlConfigured && <Alert tone="warning">{o.noPublicUrl}</Alert>}
            </div>
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                {ONLINE_GATEWAYS.map(gateway => {
                    const name = o.gateways[gateway] ?? gateway;
                    const settings = draft[gateway];
                    const credentials = setup.credentials.find(
                        item => item.gateway === gateway && item.mode === settings.mode,
                    );
                    const paused = setup.health.find(item => item.gateway === gateway)?.paused;
                    return (
                        <Card key={gateway}>
                            <CardHeader title={name} />
                            <CardBody className="space-y-4">
                                <Switch
                                    label={o.on(name)}
                                    checked={settings.enabled}
                                    disabled={!canEdit}
                                    onChange={checked => gatewayPatch(gateway, { enabled: checked })}
                                />
                                <Field label={o.mode}>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={settings.mode}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                gatewayPatch(gateway, {
                                                    mode: event.target.value as GatewayMode,
                                                })
                                            }
                                        >
                                            {GATEWAY_MODES.map(mode => (
                                                <option key={mode} value={mode}>
                                                    {o.modes[mode]}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </Field>
                                {settings.enabled && settings.mode === 'sandbox' && (
                                    <Alert tone="warning">{o.sandboxWarning}</Alert>
                                )}
                                {settings.enabled && !credentials?.complete && (
                                    <Alert tone="warning">{o.incomplete}</Alert>
                                )}
                                {settings.enabled && paused && <Alert tone="error">{o.paused}</Alert>}
                                {gateway === 'sslcommerz' && setup.ipnUrl && (
                                    <p className="text-sm text-slate-600">
                                        {o.ipnUrl}:{' '}
                                        <span className="font-mono break-all">{setup.ipnUrl}</span>
                                    </p>
                                )}
                            </CardBody>
                        </Card>
                    );
                })}

                <Card>
                    <CardBody className="space-y-4">
                        <Field label={o.waiting} hint={o.waitingHint} error={errors.expiryMinutes}>
                            {control => (
                                <div className="flex items-center gap-2">
                                    <div className="w-24 flex-none">
                                        <Input
                                            {...control}
                                            inputMode="numeric"
                                            value={digits(draft.expiryMinutes)}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                setDraft({
                                                    ...draft,
                                                    expiryMinutes: Number(
                                                        banglaToAsciiDigits(event.target.value.trim()) || 0,
                                                    ),
                                                })
                                            }
                                        />
                                    </div>
                                    <span className="text-sm text-slate-600">{o.minutes}</span>
                                </div>
                            )}
                        </Field>
                        <Switch
                            label={o.keepAdvance}
                            description={o.keepAdvanceHint}
                            checked={draft.keepAdvanceOrdersWaiting}
                            disabled={!canEdit}
                            onChange={checked => setDraft({ ...draft, keepAdvanceOrdersWaiting: checked })}
                        />
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
                    {ONLINE_GATEWAYS.flatMap(gateway =>
                        GATEWAY_MODES.map(mode => (
                            <CredentialsCard
                                key={`${gateway}-${mode}`}
                                gateway={gateway}
                                mode={mode}
                                view={setup.credentials.find(
                                    item => item.gateway === gateway && item.mode === mode,
                                )}
                                onSaved={() =>
                                    void queryClient.invalidateQueries({ queryKey: ['onlinePaymentSetup'] })
                                }
                            />
                        )),
                    )}
                </div>
            )}
        </>
    );
}

/** One gateway's credentials for one mode: the form never shows a saved secret. */
function CredentialsCard({
    gateway,
    mode,
    view,
    onSaved,
}: {
    gateway: OnlineGateway;
    mode: GatewayMode;
    view: CredentialsView | undefined;
    onSaved(): void;
}) {
    const { messages: m } = useI18n();
    const o = m.onlinePayments;
    const toast = useToast();
    const [values, setValues] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string | null } | null>(null);
    const save = useMutation({
        mutationFn: () =>
            adminApi<{
                saveBdGatewayCredentials: {
                    credentials: { complete: boolean } | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(SAVE_CREDENTIALS, { gateway, mode, input: values }).then(r => r.saveBdGatewayCredentials),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.credentials) {
                setValues({});
                setTestResult(null);
                toast.success(o.credentialsSaved);
                onSaved();
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    const test = useMutation({
        mutationFn: () =>
            adminApi<{ testBdGatewayConnection: { ok: boolean; message: string | null } }>(TEST, {
                gateway,
                mode,
            }).then(r => r.testBdGatewayConnection),
        onSuccess: setTestResult,
        onError: () => toast.error(m.errors.generic),
    });
    const title = `${o.gateways[gateway] ?? gateway} · ${o.credentials(o.modes[mode] ?? mode)}`;
    return (
        <Card>
            <CardHeader title={title} description={o.credentialsHint} />
            <CardBody>
                <form
                    className="space-y-4"
                    onSubmit={event => {
                        event.preventDefault();
                        save.mutate();
                    }}
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        {GATEWAY_CREDENTIAL_FIELDS[gateway].map(name => {
                            const field = view?.fields.find(item => item.name === name);
                            const secret = field?.value === null || field?.value === undefined;
                            return (
                                <Field
                                    key={name}
                                    label={o.fields[name] ?? name}
                                    hint={
                                        field?.saved
                                            ? field.value
                                                ? `${o.saved}: ${field.value}`
                                                : o.saved
                                            : o.notSaved
                                    }
                                    error={errors[name]}
                                >
                                    {control => (
                                        <Input
                                            {...control}
                                            type={secret ? 'password' : 'text'}
                                            autoComplete="off"
                                            value={values[name] ?? ''}
                                            onChange={event =>
                                                setValues({ ...values, [name]: event.target.value })
                                            }
                                        />
                                    )}
                                </Field>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button type="submit" loading={save.isPending}>
                            {o.saveCredentials}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            loading={test.isPending}
                            disabled={!view?.complete}
                            onClick={() => test.mutate()}
                        >
                            {o.test}
                        </Button>
                    </div>
                    {testResult && (
                        <Alert tone={testResult.ok ? 'info' : 'error'}>
                            {testResult.ok ? o.testOk : o.testFailed(testResult.message ?? '')}
                        </Alert>
                    )}
                </form>
            </CardBody>
        </Card>
    );
}
