import type { OrderSettings } from '@ecommbd/shared/order-settings';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const UPDATE = `
    mutation UpdateOrderSettings($input: JSON!) {
        updateBdOrderSettings(input: $input) { settings errors { path code } }
    }
`;

/** Order settings (roadmap phase 04): number prefix, packing prepaid orders, unanswered orders. */
export function OrderSettingsPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');
    const query = useQuery({
        queryKey: ['orderSettings'],
        queryFn: () =>
            adminApi<{ bdOrderSettings: OrderSettings }>('{ bdOrderSettings }').then(r => r.bdOrderSettings),
    });
    const [draft, setDraft] = useState<OrderSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: OrderSettings) =>
            adminApi<{
                updateBdOrderSettings: {
                    settings: OrderSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdOrderSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(m.orderSettings.saved);
                void queryClient.invalidateQueries({ queryKey: ['orderSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const s = m.orderSettings;
    const autoCancel = (patch: Partial<OrderSettings['autoCancel']>) =>
        setDraft({ ...draft, autoCancel: { ...draft.autoCancel, ...patch } });
    /** Bangla digits are fine; anything else is refused by the server's check. */
    const number = (value: string) => Number(banglaToAsciiDigits(value.trim()) || 0);
    return (
        <>
            <PageHeader title={s.title} description={s.description} />
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
                    <CardHeader title={s.numbers} />
                    <CardBody>
                        <Field label={s.prefix} hint={s.prefixHint} error={errors.orderNumberPrefix} optional>
                            {control => (
                                <Input
                                    {...control}
                                    value={draft.orderNumberPrefix}
                                    maxLength={6}
                                    disabled={!canEdit}
                                    className="w-40 uppercase"
                                    onChange={event =>
                                        setDraft({ ...draft, orderNumberPrefix: event.target.value })
                                    }
                                />
                            )}
                        </Field>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={s.packing} />
                    <CardBody>
                        <Switch
                            label={s.skipConfirmation}
                            checked={draft.skipConfirmationForPrepaid}
                            disabled={!canEdit}
                            onChange={checked => setDraft({ ...draft, skipConfirmationForPrepaid: checked })}
                        />
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={s.unanswered} />
                    <CardBody>
                        <Switch
                            label={s.suggest}
                            checked={draft.autoCancel.suggest}
                            disabled={!canEdit}
                            onChange={checked => autoCancel({ suggest: checked })}
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label={s.afterDays} error={errors['autoCancel.afterDays']}>
                                {control => (
                                    <Input
                                        {...control}
                                        inputMode="numeric"
                                        value={String(draft.autoCancel.afterDays)}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            autoCancel({ afterDays: number(event.target.value) })
                                        }
                                    />
                                )}
                            </Field>
                            <Field label={s.minFailedCalls} error={errors['autoCancel.minFailedCalls']}>
                                {control => (
                                    <Input
                                        {...control}
                                        inputMode="numeric"
                                        value={String(draft.autoCancel.minFailedCalls)}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            autoCancel({ minFailedCalls: number(event.target.value) })
                                        }
                                    />
                                )}
                            </Field>
                        </div>
                        <Switch
                            label={s.cancelAutomatically}
                            description={s.cancelAutomaticallyHint}
                            checked={draft.autoCancel.cancelAutomatically}
                            disabled={!canEdit}
                            onChange={checked => autoCancel({ cancelAutomatically: checked })}
                        />
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
