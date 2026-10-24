import { BROWSER_EVENTS, type MetaSettings, PURCHASE_TRIGGERS, PURCHASE_VALUES } from '@ecommbd/shared/meta';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import {
    Alert,
    Badge,
    type BadgeTone,
    Card,
    CardBody,
    CardHeader,
    PageHeader,
    PageSkeleton,
} from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useAgo } from '../lib/orders';
import { useToast } from '../lib/toast';

interface Setup {
    settings: MetaSettings;
    pixels: Array<{ pixelId: string; tokenSaved: boolean }>;
    tokenProblem: { pixelId: string; message: string } | null;
    keyringConfigured: boolean;
    graphVersion: string;
}

interface MetaEvent {
    id: string;
    createdAt: string;
    pixelId: string;
    eventName: string;
    eventId: string;
    source: string;
    status: string;
    payload: unknown;
    response: { events_received?: number; fbtrace_id?: string } | null;
    error: string | null;
}

const SETUP = `{ bdMetaSetup { settings keyringConfigured graphVersion pixels { pixelId tokenSaved } tokenProblem { pixelId message } } }`;
const UPDATE = `mutation ($input: JSON!) { updateBdMetaSettings(input: $input) { settings errors { path code } } }`;
const TOKEN = `mutation ($pixelId: String!, $token: String!) { saveBdMetaToken(pixelId: $pixelId, token: $token) { path code } }`;
const TEST = `mutation ($pixelId: String!) { sendBdMetaTestEvent(pixelId: $pixelId) { ok message eventsReceived fbtraceId } }`;
const EVENTS = `query ($eventName: String, $status: String) {
    bdMetaEvents(eventName: $eventName, status: $status, take: 50) {
        totalItems
        items { id createdAt pixelId eventName eventId source status payload response error }
    }
}`;

const TONES: Record<string, BadgeTone> = { queued: 'amber', sent: 'green', failed: 'red', skipped: 'slate' };

/**
 * Meta tracking (roadmap phase 20): Pixels, Conversions API tokens (write-only) with "Send test
 * event", when Purchase is sent, and the event log with Meta's answers.
 */
export function MetaTrackingPage() {
    const { messages: m } = useI18n();
    const t = m.meta;
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');
    const query = useQuery({
        queryKey: ['metaSetup'],
        queryFn: () => adminApi<{ bdMetaSetup: Setup }>(SETUP).then(r => r.bdMetaSetup),
    });
    const [draft, setDraft] = useState<MetaSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data.settings);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: MetaSettings) =>
            adminApi<{
                updateBdMetaSettings: {
                    settings: MetaSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, {
                input,
            }).then(r => r.updateBdMetaSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(t.saved);
                void queryClient.invalidateQueries({ queryKey: ['metaSetup'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft || !query.data) return <PageSkeleton />;
    const setup = query.data;
    const pixelIds = [draft.pixelIds[0] ?? '', draft.pixelIds[1] ?? ''];
    const setPixel = (index: number, value: string) => {
        const next = [...pixelIds];
        next[index] = value.replace(/\D/g, '');
        setDraft({ ...draft, pixelIds: next.filter(Boolean) });
    };

    return (
        <>
            <PageHeader title={t.title} description={t.description} />
            <div className="mb-4 space-y-2">
                {!canEdit && <Alert>{m.payments.settings.readOnly}</Alert>}
                {!setup.keyringConfigured && <Alert tone="warning">{t.noKeyring}</Alert>}
                {setup.tokenProblem && (
                    <Alert tone="error">
                        {t.tokenProblem(setup.tokenProblem.pixelId, setup.tokenProblem.message)}
                    </Alert>
                )}
            </div>
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardBody className="space-y-4">
                        <Switch
                            label={t.enabled}
                            checked={draft.enabled}
                            disabled={!canEdit}
                            onChange={checked => setDraft({ ...draft, enabled: checked })}
                        />
                        <Switch
                            label={t.browserPixel}
                            description={t.browserPixelHint}
                            checked={draft.browserPixel}
                            disabled={!canEdit}
                            onChange={checked => setDraft({ ...draft, browserPixel: checked })}
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                            {[0, 1].map(index => (
                                <Field
                                    key={index}
                                    label={t.pixel(index + 1)}
                                    hint={index === 0 ? t.pixelHint : undefined}
                                    error={
                                        errors[`pixelIds.${index}`] ??
                                        (index === 0 ? errors.pixelIds : undefined)
                                    }
                                    optional={index === 1}
                                >
                                    {control => (
                                        <Input
                                            {...control}
                                            inputMode="numeric"
                                            maxLength={20}
                                            value={pixelIds[index]}
                                            disabled={!canEdit}
                                            onChange={event => setPixel(index, event.target.value)}
                                        />
                                    )}
                                </Field>
                            ))}
                        </div>
                        <Field label={t.testCode} hint={t.testCodeHint} error={errors.testEventCode} optional>
                            {control => (
                                <Input
                                    {...control}
                                    maxLength={40}
                                    className="w-48"
                                    value={draft.testEventCode}
                                    disabled={!canEdit}
                                    onChange={event =>
                                        setDraft({ ...draft, testEventCode: event.target.value })
                                    }
                                />
                            )}
                        </Field>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={t.trigger} description={t.triggerHint} />
                    <CardBody className="space-y-4">
                        <fieldset className="space-y-2">
                            <legend className="sr-only">{t.trigger}</legend>
                            {PURCHASE_TRIGGERS.map(trigger => (
                                <label key={trigger} className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="trigger"
                                        className="size-4"
                                        checked={draft.purchaseTrigger === trigger}
                                        disabled={!canEdit}
                                        onChange={() => setDraft({ ...draft, purchaseTrigger: trigger })}
                                    />
                                    {t.triggers[trigger]}
                                </label>
                            ))}
                        </fieldset>
                        <Field label={t.value}>
                            {control => (
                                <Select
                                    {...control}
                                    className="w-72"
                                    value={draft.purchaseValue}
                                    disabled={!canEdit}
                                    onChange={event =>
                                        setDraft({
                                            ...draft,
                                            purchaseValue: event.target
                                                .value as MetaSettings['purchaseValue'],
                                        })
                                    }
                                >
                                    {PURCHASE_VALUES.map(value => (
                                        <option key={value} value={value}>
                                            {t.values[value]}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Switch
                            label={t.sendManual}
                            description={t.sendManualHint}
                            checked={draft.sendManualOrders}
                            disabled={!canEdit}
                            onChange={checked => setDraft({ ...draft, sendManualOrders: checked })}
                        />
                    </CardBody>
                </Card>
                {canEdit && (
                    <Button type="submit" loading={save.isPending}>
                        {m.settings.save}
                    </Button>
                )}
            </form>

            {canEdit && setup.keyringConfigured && setup.pixels.length > 0 && (
                <div className="mt-6 space-y-4">
                    {setup.pixels.map(pixel => (
                        <TokenCard
                            key={pixel.pixelId}
                            pixelId={pixel.pixelId}
                            saved={pixel.tokenSaved}
                            onSaved={() => void queryClient.invalidateQueries({ queryKey: ['metaSetup'] })}
                        />
                    ))}
                </div>
            )}
            <EventLog />
            <p className="mt-4 text-sm text-slate-500">{t.version(setup.graphVersion)}</p>
        </>
    );
}

function TokenCard({ pixelId, saved, onSaved }: { pixelId: string; saved: boolean; onSaved(): void }) {
    const { messages: m } = useI18n();
    const t = m.meta;
    const toast = useToast();
    const [token, setToken] = useState('');
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const save = useMutation({
        mutationFn: () =>
            adminApi<{ saveBdMetaToken: Array<{ path: string }> }>(TOKEN, { pixelId, token }).then(
                r => r.saveBdMetaToken,
            ),
        onSuccess: errors => {
            if (errors.length) return toast.error(m.settings.fixErrors);
            setToken('');
            toast.success(t.tokenSaved);
            onSaved();
        },
        onError: () => toast.error(m.errors.generic),
    });
    const test = useMutation({
        mutationFn: () =>
            adminApi<{
                sendBdMetaTestEvent: {
                    ok: boolean;
                    message: string | null;
                    eventsReceived: number | null;
                    fbtraceId: string | null;
                };
            }>(TEST, { pixelId }).then(r => r.sendBdMetaTestEvent),
        onSuccess: answer =>
            setResult(
                answer.ok
                    ? { ok: true, text: t.testOk(answer.eventsReceived ?? 0, answer.fbtraceId ?? '') }
                    : { ok: false, text: t.testFailed(answer.message ?? '') },
            ),
        onError: () => toast.error(m.errors.generic),
    });
    return (
        <Card>
            <CardHeader
                title={`${t.token} · ${pixelId}`}
                description={saved ? t.tokenSaved : t.tokenMissing}
            />
            <CardBody>
                <form
                    className="space-y-3"
                    onSubmit={event => {
                        event.preventDefault();
                        save.mutate();
                    }}
                >
                    <Field label={t.token} hint={t.tokenHint}>
                        {control => (
                            <Input
                                {...control}
                                type="password"
                                autoComplete="off"
                                value={token}
                                onChange={event => setToken(event.target.value)}
                            />
                        )}
                    </Field>
                    <div className="flex flex-wrap gap-2">
                        <Button type="submit" loading={save.isPending} disabled={!token.trim()}>
                            {t.saveToken}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            loading={test.isPending}
                            disabled={!saved}
                            onClick={() => test.mutate()}
                        >
                            {t.sendTest}
                        </Button>
                    </div>
                    {result && <Alert tone={result.ok ? 'info' : 'error'}>{result.text}</Alert>}
                </form>
            </CardBody>
        </Card>
    );
}

function EventLog() {
    const { messages: m } = useI18n();
    const l = m.meta.log;
    const ago = useAgo();
    const [eventName, setEventName] = useState('');
    const [status, setStatus] = useState('');
    const query = useQuery({
        queryKey: ['metaEvents', eventName, status],
        queryFn: () =>
            adminApi<{ bdMetaEvents: { totalItems: number; items: MetaEvent[] } }>(EVENTS, {
                eventName: eventName || null,
                status: status || null,
            }).then(r => r.bdMetaEvents),
        refetchInterval: 30_000,
    });
    const items = query.data?.items ?? [];
    return (
        <Card className="mt-6">
            <CardHeader title={l.title} />
            <CardBody className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    <Select
                        aria-label={l.event}
                        className="w-48"
                        value={eventName}
                        onChange={event => setEventName(event.target.value)}
                    >
                        <option value="">{l.all}</option>
                        {[...BROWSER_EVENTS, 'Purchase'].map(name => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </Select>
                    <Select
                        aria-label={l.status}
                        className="w-48"
                        value={status}
                        onChange={event => setStatus(event.target.value)}
                    >
                        <option value="">{l.allStatuses}</option>
                        {Object.entries(l.statuses).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                </div>
                {items.length === 0 ? (
                    <p className="text-sm text-slate-600">{l.empty}</p>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {items.map(event => (
                            <li key={event.id} className="py-2 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">{event.eventName}</span>
                                    <Badge tone={TONES[event.status] ?? 'slate'}>
                                        {l.statuses[event.status] ?? event.status}
                                    </Badge>
                                    <span className="text-slate-600">
                                        {l.sources[event.source] ?? event.source}
                                    </span>
                                    <span className="font-mono text-slate-500">{event.pixelId}</span>
                                    <span className="text-slate-500">{ago(event.createdAt)}</span>
                                    {event.response?.events_received !== undefined && (
                                        <span className="text-green-800">
                                            {l.received(event.response.events_received)}
                                        </span>
                                    )}
                                    {event.error && <span className="text-red-700">{event.error}</span>}
                                </div>
                                <details className="mt-1">
                                    <summary className="cursor-pointer text-slate-600">{l.details}</summary>
                                    <p className="mt-2 font-medium">{l.payload}</p>
                                    <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">
                                        {JSON.stringify(event.payload, null, 2)}
                                    </pre>
                                    {event.response && (
                                        <>
                                            <p className="mt-2 font-medium">{l.response}</p>
                                            <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">
                                                {JSON.stringify(event.response, null, 2)}
                                            </pre>
                                        </>
                                    )}
                                </details>
                            </li>
                        ))}
                    </ul>
                )}
            </CardBody>
        </Card>
    );
}
