import type { CostSettings } from '@ecommbd/shared/cost';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { TakaInput, useDigits } from '../components/form/inputs';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Input, Select } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

const UPDATE = `
    mutation UpdateCostSettings($input: JSON!) {
        updateBdCostSettings(input: $input) { settings errors { path code } }
    }
`;

/** What an order costs the store (phase 51). Set once, so it sits under More in Settings. */
export function CostSettingsPage() {
    const { messages: m } = useI18n();
    const c = m.cost;
    const { can } = useAuth();
    const format = useFormat();
    const digits = useDigits();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings') && can('ReadCost');
    const query = useQuery({
        queryKey: ['costSettings'],
        queryFn: () =>
            adminApi<{ bdCostSettings: CostSettings }>('{ bdCostSettings }').then(r => r.bdCostSettings),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<CostSettings>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) load(query.data);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: CostSettings) =>
            adminApi<{
                updateBdCostSettings: {
                    settings: CostSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdCostSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                load(result.settings);
                toast.success(c.saved);
                void queryClient.invalidateQueries({ queryKey: ['costSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const number = (value: string) => {
        const text = banglaToAsciiDigits(value.trim());
        return text === '' ? null : Number(text);
    };
    const codSummary = () => {
        if (draft.codCharge.type === 'percent') {
            return draft.codCharge.percent == null ? c.notSet : `${digits(draft.codCharge.percent)}%`;
        }
        return draft.codCharge.flat == null ? c.notSet : format.money(draft.codCharge.flat);
    };
    return (
        <Page width="narrow">
            <PageHeader title={c.settingsTitle} description={c.settingsDescription} />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{m.settings.readOnly}</Alert>
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
                    <CardHeader title={c.courierTitle} />
                    <CardBody>
                        <Field label={c.courierFlat} hint={c.courierHint} error={errors.courierFlat} optional>
                            {control => (
                                <TakaInput
                                    {...control}
                                    value={draft.courierFlat}
                                    disabled={!canEdit}
                                    onChange={value => setDraft({ ...draft, courierFlat: value })}
                                />
                            )}
                        </Field>
                    </CardBody>
                </Card>
                <CollapsibleCard
                    title={c.codTitle}
                    summary={codSummary()}
                    forceOpen={
                        draft.codCharge.flat != null ||
                        draft.codCharge.percent != null ||
                        Object.keys(errors).some(key => key.startsWith('codCharge'))
                    }
                >
                    <p className="text-sm text-ink-muted">{c.codHint}</p>
                    <Field label={c.codType}>
                        {control => (
                            <Select
                                {...control}
                                value={draft.codCharge.type}
                                disabled={!canEdit}
                                onChange={event =>
                                    setDraft({
                                        ...draft,
                                        codCharge: {
                                            ...draft.codCharge,
                                            type: event.target.value as CostSettings['codCharge']['type'],
                                        },
                                    })
                                }
                            >
                                <option value="flat">{c.codFlat}</option>
                                <option value="percent">{c.codPercent}</option>
                            </Select>
                        )}
                    </Field>
                    {draft.codCharge.type === 'flat' ? (
                        <Field label={c.codAmount} error={errors['codCharge.flat']} optional>
                            {control => (
                                <TakaInput
                                    {...control}
                                    value={draft.codCharge.flat}
                                    disabled={!canEdit}
                                    onChange={value =>
                                        setDraft({ ...draft, codCharge: { ...draft.codCharge, flat: value } })
                                    }
                                />
                            )}
                        </Field>
                    ) : (
                        <Field label={c.codPercentValue} error={errors['codCharge.percent']} optional>
                            {control => (
                                <Input
                                    {...control}
                                    inputMode="numeric"
                                    value={
                                        draft.codCharge.percent == null ? '' : digits(draft.codCharge.percent)
                                    }
                                    disabled={!canEdit}
                                    className="w-28"
                                    onChange={event =>
                                        setDraft({
                                            ...draft,
                                            codCharge: {
                                                ...draft.codCharge,
                                                percent: number(event.target.value),
                                            },
                                        })
                                    }
                                />
                            )}
                        </Field>
                    )}
                </CollapsibleCard>
                <CollapsibleCard
                    title={c.gatewayTitle}
                    summary={
                        draft.gatewayFeePercent == null ? c.notSet : `${digits(draft.gatewayFeePercent)}%`
                    }
                    forceOpen={draft.gatewayFeePercent != null || !!errors.gatewayFeePercent}
                >
                    <Field
                        label={c.gatewayPercent}
                        hint={c.gatewayHint}
                        error={errors.gatewayFeePercent}
                        optional
                    >
                        {control => (
                            <Input
                                {...control}
                                inputMode="numeric"
                                value={draft.gatewayFeePercent == null ? '' : digits(draft.gatewayFeePercent)}
                                disabled={!canEdit}
                                className="w-28"
                                onChange={event =>
                                    setDraft({ ...draft, gatewayFeePercent: number(event.target.value) })
                                }
                            />
                        )}
                    </Field>
                </CollapsibleCard>
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={discard} />}
            </form>
        </Page>
    );
}
