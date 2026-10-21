import {
    renderSmsTemplate,
    SMS_EVENTS,
    SMS_LIMITS,
    SMS_VARIABLES,
    smsSegments,
    type SmsEvent,
    type SmsLanguage,
    type SmsSettings,
    type SmsVariable,
} from '@ecommbd/shared/sms';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { TakaInput, useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Input, Select, Textarea } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const UPDATE = `
    mutation UpdateSmsSettings($input: JSON!) {
        updateBdSmsSettings(input: $input) { settings errors { path code } }
    }
`;

const USAGE = `
    {
        bdSmsUsage {
            today { messages segments }
            month { messages segments }
            provider
        }
    }
`;

interface SmsCount {
    messages: number;
    segments: number;
}

/** Typical values, so the count shows what a real message costs (a tracking link is about 45 characters). */
const SAMPLE: Record<SmsLanguage, Record<SmsVariable, string>> = {
    bn: {
        name: 'রহিম উদ্দিন',
        orderNumber: '1024',
        total: '1,310',
        codDue: '1,310',
        trackingUrl: `https://shop.example.com/t/${'x'.repeat(22)}`,
        storeName: 'রহিম ফ্যাশন',
        storePhone: '01711-000000',
        code: '123456',
    },
    en: {
        name: 'Rahim Uddin',
        orderNumber: '1024',
        total: '1,310',
        codDue: '1,310',
        trackingUrl: `https://shop.example.com/t/${'x'.repeat(22)}`,
        storeName: 'Rahim Fashion',
        storePhone: '01711-000000',
        code: '123456',
    },
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** SMS settings (roadmap phase 10): templates with a live length and cost, quiet hours, limits and usage. */
export function SmsSettingsPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const digits = useDigits();
    const format = useFormat();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');
    const query = useQuery({
        queryKey: ['smsSettings'],
        queryFn: () => adminApi<{ bdSmsSettings: SmsSettings }>('{ bdSmsSettings }').then(r => r.bdSmsSettings),
    });
    const usage = useQuery({
        queryKey: ['smsUsage'],
        queryFn: () =>
            adminApi<{ bdSmsUsage: { today: SmsCount; month: SmsCount; provider: string } }>(USAGE).then(
                r => r.bdSmsUsage,
            ),
    });
    const [draft, setDraft] = useState<SmsSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: SmsSettings) =>
            adminApi<{
                updateBdSmsSettings: {
                    settings: SmsSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdSmsSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(m.sms.saved);
                void queryClient.invalidateQueries({ queryKey: ['smsSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const s = m.sms;
    const set = (patch: Partial<SmsSettings>) => setDraft({ ...draft, ...patch });
    const event = (name: SmsEvent, patch: Partial<SmsSettings['events'][SmsEvent]>) =>
        set({ events: { ...draft.events, [name]: { ...draft.events[name], ...patch } } });
    const partsOf = (text: string, language: SmsLanguage) =>
        smsSegments(renderSmsTemplate(text, SAMPLE[language], language));
    const countLine = (text: string, language: SmsLanguage) => {
        const parts = partsOf(text, language);
        return s.segments(
            digits(parts.units),
            digits(parts.segments),
            format.money(parts.segments * draft.costPerSegment),
        );
    };
    const usageLine = (value: SmsCount | undefined) =>
        value ? s.usageLine(digits(value.messages), digits(value.segments)) : '…';

    return (
        <>
            <PageHeader title={s.title} description={s.description} />
            <div className="mb-4 space-y-3">
                {(usage.data?.provider === 'none' || usage.data?.provider === 'log') && (
                    <Alert tone="warning">{s.noProvider}</Alert>
                )}
                {!canEdit && <Alert>{s.readOnly}</Alert>}
            </div>
            <form
                className="space-y-4"
                onSubmit={submit => {
                    submit.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={s.usage} />
                    <CardBody>
                        <dl className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <dt className="text-sm text-slate-600">{s.today}</dt>
                                <dd className="font-medium">{usageLine(usage.data?.today)}</dd>
                            </div>
                            <div>
                                <dt className="text-sm text-slate-600">{s.month}</dt>
                                <dd className="font-medium">{usageLine(usage.data?.month)}</dd>
                            </div>
                        </dl>
                    </CardBody>
                </Card>

                <Card>
                    <CardBody>
                        <Field label={s.senderId} hint={s.senderIdHint} error={errors.senderId} optional>
                            {control => (
                                <Input
                                    {...control}
                                    className="w-48"
                                    maxLength={SMS_LIMITS.senderId}
                                    value={draft.senderId}
                                    disabled={!canEdit}
                                    onChange={change => set({ senderId: change.target.value })}
                                />
                            )}
                        </Field>
                    </CardBody>
                </Card>

                {SMS_EVENTS.map(name => {
                    const value = draft.events[name];
                    const variables = [...SMS_VARIABLES, ...(name === 'otp' ? (['code'] as const) : [])];
                    return (
                        <Card key={name}>
                            <CardHeader title={s.events[name]} />
                            <CardBody>
                                <Switch
                                    label={s.send}
                                    checked={value.enabled}
                                    disabled={!canEdit}
                                    onChange={checked => event(name, { enabled: checked })}
                                />
                                {value.enabled && (
                                    <>
                                        <Switch
                                            label={s.required}
                                            checked={value.required}
                                            disabled={!canEdit}
                                            onChange={checked => event(name, { required: checked })}
                                        />
                                        {(['bn', 'en'] as const).map(language => (
                                            <Field
                                                key={language}
                                                label={`${s.events[name]}: ${s[language]}`}
                                                hint={countLine(value[language], language)}
                                                error={errors[`events.${name}.${language}`]}
                                            >
                                                {control => (
                                                    <Textarea
                                                        {...control}
                                                        rows={3}
                                                        maxLength={SMS_LIMITS.template}
                                                        value={value[language]}
                                                        readOnly={!canEdit}
                                                        onChange={change =>
                                                            event(name, { [language]: change.target.value })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        ))}
                                        {(['bn', 'en'] as const).some(
                                            language => partsOf(value[language], language).segments >= 3,
                                        ) && <Alert tone="warning">{s.longWarning}</Alert>}
                                        <p className="text-sm text-slate-600">
                                            {s.variables}:{' '}
                                            {variables.map((variable, index) => (
                                                <span key={variable}>
                                                    {index > 0 && ', '}
                                                    <code className="rounded bg-slate-100 px-1">{`{${variable}}`}</code>{' '}
                                                    {s.variableNames[variable]}
                                                </span>
                                            ))}
                                        </p>
                                    </>
                                )}
                            </CardBody>
                        </Card>
                    );
                })}
                <p className="text-sm text-slate-600">{s.segmentsHint}</p>

                <Card>
                    <CardHeader title={s.quietHours} description={s.quietHoursHint} />
                    <CardBody>
                        <Switch
                            label={s.quietHoursOn}
                            checked={draft.quietHours.enabled}
                            disabled={!canEdit}
                            onChange={checked => set({ quietHours: { ...draft.quietHours, enabled: checked } })}
                        />
                        {draft.quietHours.enabled && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                {(['startHour', 'endHour'] as const).map(key => (
                                    <Field key={key} label={key === 'startHour' ? s.from : s.until}>
                                        {control => (
                                            <Select
                                                {...control}
                                                value={draft.quietHours[key]}
                                                disabled={!canEdit}
                                                onChange={change =>
                                                    set({
                                                        quietHours: {
                                                            ...draft.quietHours,
                                                            [key]: Number(change.target.value),
                                                        },
                                                    })
                                                }
                                            >
                                                {HOURS.map(hour => (
                                                    <option key={hour} value={hour}>
                                                        {s.hour(digits(String(hour).padStart(2, '0')))}
                                                    </option>
                                                ))}
                                            </Select>
                                        )}
                                    </Field>
                                ))}
                            </div>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={s.limits} />
                    <CardBody>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {(['perPhonePerDay', 'perStorePerDay'] as const).map(key => (
                                <Field
                                    key={key}
                                    label={key === 'perPhonePerDay' ? s.perPhone : s.perStore}
                                    error={errors[`caps.${key}`]}
                                >
                                    {control => (
                                        <Input
                                            {...control}
                                            inputMode="numeric"
                                            className="w-32"
                                            value={digits(draft.caps[key])}
                                            disabled={!canEdit}
                                            onChange={change =>
                                                set({
                                                    caps: {
                                                        ...draft.caps,
                                                        [key]: Number(
                                                            banglaToAsciiDigits(change.target.value.trim()) || 0,
                                                        ),
                                                    },
                                                })
                                            }
                                        />
                                    )}
                                </Field>
                            ))}
                            <Field label={s.cost} hint={s.costHint} error={errors.costPerSegment}>
                                {control => (
                                    <TakaInput
                                        {...control}
                                        value={draft.costPerSegment}
                                        disabled={!canEdit}
                                        onChange={value => set({ costPerSegment: value ?? 0 })}
                                    />
                                )}
                            </Field>
                        </div>
                    </CardBody>
                </Card>

                {canEdit && (
                    <Button type="submit" loading={save.isPending}>
                        {m.settings.save}
                    </Button>
                )}
            </form>
        </>
    );
}
