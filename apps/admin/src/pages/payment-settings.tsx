import {
    ADVANCE_RULES,
    ADVANCE_SCOPES,
    MFS_ACCOUNT_TYPES,
    MFS_PROVIDERS,
    type MfsAccountType,
    type MfsProvider,
    type PaymentSettings,
} from '@ecommbd/shared/payments';
import { SHIPPING_ZONES } from '@ecommbd/shared/shipping';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { PhoneInput, TakaInput, useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const UPDATE = `
    mutation UpdatePaymentSettings($input: JSON!) {
        updateBdPaymentSettings(input: $input) { settings errors { path code } }
    }
`;

/** Payment settings (roadmap phase 08): COD, bKash/Nagad/Rocket numbers and the advance. */
export function PaymentSettingsPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const digits = useDigits();
    const queryClient = useQueryClient();
    const canEdit = can('UpdatePaymentMethod');
    const query = useQuery({
        queryKey: ['paymentSettings'],
        queryFn: () =>
            adminApi<{ bdPaymentSettings: PaymentSettings }>('{ bdPaymentSettings }').then(
                r => r.bdPaymentSettings,
            ),
    });
    const [draft, setDraft] = useState<PaymentSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: PaymentSettings) =>
            adminApi<{
                updateBdPaymentSettings: {
                    settings: PaymentSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdPaymentSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(m.payments.settings.saved);
                void queryClient.invalidateQueries({ queryKey: ['paymentSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const s = m.payments.settings;
    const set = (patch: Partial<PaymentSettings>) => setDraft({ ...draft, ...patch });
    const account = (provider: MfsProvider, patch: Partial<PaymentSettings['mfs'][MfsProvider]>) =>
        set({ mfs: { ...draft.mfs, [provider]: { ...draft.mfs[provider], ...patch } } });
    const advance = (patch: Partial<PaymentSettings['advance']>) =>
        set({ advance: { ...draft.advance, ...patch } });

    return (
        <>
            <PageHeader title={s.title} description={s.description} />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{s.readOnly}</Alert>
                </div>
            )}
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={s.cod} />
                    <CardBody>
                        <Switch
                            label={s.codOn}
                            checked={draft.cod.enabled}
                            disabled={!canEdit}
                            onChange={checked => set({ cod: { ...draft.cod, enabled: checked } })}
                        />
                        {draft.cod.enabled && (
                            <>
                                <Field
                                    label={s.codMax}
                                    hint={s.codMaxHint}
                                    error={errors['cod.maxOrderTotal']}
                                    optional
                                >
                                    {control => (
                                        <TakaInput
                                            {...control}
                                            value={draft.cod.maxOrderTotal}
                                            disabled={!canEdit}
                                            onChange={value =>
                                                set({ cod: { ...draft.cod, maxOrderTotal: value } })
                                            }
                                        />
                                    )}
                                </Field>
                                <fieldset>
                                    <legend className="mb-1 text-sm font-medium">{s.codZones}</legend>
                                    <p className="mb-2 text-sm text-slate-600">{s.codZonesHint}</p>
                                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                                        {SHIPPING_ZONES.map(zone => (
                                            <label key={zone} className="flex items-center gap-2 text-sm">
                                                <input
                                                    type="checkbox"
                                                    className="size-4"
                                                    checked={draft.cod.zones.includes(zone)}
                                                    disabled={!canEdit}
                                                    onChange={event =>
                                                        set({
                                                            cod: {
                                                                ...draft.cod,
                                                                zones: event.target.checked
                                                                    ? [...draft.cod.zones, zone]
                                                                    : draft.cod.zones.filter(z => z !== zone),
                                                            },
                                                        })
                                                    }
                                                />
                                                {m.delivery.zones[zone]}
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            </>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={s.mfs} description={s.mfsHint} />
                    <CardBody>
                        {MFS_PROVIDERS.map(provider => {
                            const name = m.payments.providers[provider];
                            const value = draft.mfs[provider];
                            return (
                                <div
                                    key={provider}
                                    className="space-y-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0"
                                >
                                    <Switch
                                        label={s.providerOn(name)}
                                        checked={value.enabled}
                                        disabled={!canEdit}
                                        onChange={checked => account(provider, { enabled: checked })}
                                    />
                                    {value.enabled && (
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Field
                                                label={s.number(name)}
                                                error={errors[`mfs.${provider}.number`]}
                                            >
                                                {control => (
                                                    <PhoneInput
                                                        {...control}
                                                        value={value.number}
                                                        disabled={!canEdit}
                                                        onChange={number => account(provider, { number })}
                                                    />
                                                )}
                                            </Field>
                                            <Field label={s.accountType}>
                                                {control => (
                                                    <Select
                                                        {...control}
                                                        value={value.accountType}
                                                        disabled={!canEdit}
                                                        onChange={event =>
                                                            account(provider, {
                                                                accountType: event.target
                                                                    .value as MfsAccountType,
                                                            })
                                                        }
                                                    >
                                                        {MFS_ACCOUNT_TYPES.map(type => (
                                                            <option key={type} value={type}>
                                                                {s.accountTypes[type]}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                )}
                                            </Field>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={s.advance} description={s.advanceHint} />
                    <CardBody>
                        <Switch
                            label={s.advanceOn}
                            checked={draft.advance.enabled}
                            disabled={!canEdit}
                            onChange={checked => advance({ enabled: checked })}
                        />
                        {draft.advance.enabled && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={s.rule}>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={draft.advance.rule}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                advance({
                                                    rule: event.target
                                                        .value as PaymentSettings['advance']['rule'],
                                                })
                                            }
                                        >
                                            {ADVANCE_RULES.map(rule => (
                                                <option key={rule} value={rule}>
                                                    {s.rules[rule]}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </Field>
                                {draft.advance.rule === 'fixed' && (
                                    <Field label={s.fixed} error={errors['advance.fixed']}>
                                        {control => (
                                            <TakaInput
                                                {...control}
                                                value={draft.advance.fixed}
                                                disabled={!canEdit}
                                                onChange={value => advance({ fixed: value ?? 0 })}
                                            />
                                        )}
                                    </Field>
                                )}
                                {draft.advance.rule === 'percent' && (
                                    <Field label={s.percent} error={errors['advance.percent']}>
                                        {control => (
                                            <Input
                                                {...control}
                                                inputMode="decimal"
                                                value={digits(draft.advance.percent)}
                                                disabled={!canEdit}
                                                onChange={event =>
                                                    advance({
                                                        percent: Number(
                                                            banglaToAsciiDigits(event.target.value.trim()) ||
                                                                0,
                                                        ),
                                                    })
                                                }
                                            />
                                        )}
                                    </Field>
                                )}
                                <Field
                                    label={s.scope}
                                    hint={
                                        draft.advance.scope === 'products' ? s.scopeProductsHint : undefined
                                    }
                                >
                                    {control => (
                                        <Select
                                            {...control}
                                            value={draft.advance.scope}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                advance({
                                                    scope: event.target
                                                        .value as PaymentSettings['advance']['scope'],
                                                })
                                            }
                                        >
                                            {ADVANCE_SCOPES.map(scope => (
                                                <option key={scope} value={scope}>
                                                    {s.scopes[scope]}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </Field>
                            </div>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardBody>
                        <Field label={s.reminder} error={errors.reminderHours}>
                            {control => (
                                <Input
                                    {...control}
                                    inputMode="numeric"
                                    className="w-24"
                                    value={digits(draft.reminderHours)}
                                    disabled={!canEdit}
                                    onChange={event =>
                                        set({
                                            reminderHours: Number(
                                                banglaToAsciiDigits(event.target.value.trim()) || 0,
                                            ),
                                        })
                                    }
                                />
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
        </>
    );
}
