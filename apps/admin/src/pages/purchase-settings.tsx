import type { CostMethod, PurchaseSettings } from '@ecommbd/shared/purchases';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Input, Select } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

const METHODS: CostMethod[] = ['average', 'latest'];

/** How a purchase updates cost, and the number prefixes. Set once, so it sits under More. */
export function PurchaseSettingsPage() {
    const { messages: m } = useI18n();
    const p = m.purchases;
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings') && can('ReadPurchase') && can('ReadCost');
    const query = useQuery({
        queryKey: ['purchaseSettings'],
        queryFn: () => adminApi<{ bdPurchaseSettings: PurchaseSettings }>('{ bdPurchaseSettings }').then(r => r.bdPurchaseSettings),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<PurchaseSettings>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) load(query.data);
    }, [query.data, draft, load]);
    const save = useMutation({
        mutationFn: (input: PurchaseSettings) =>
            adminApi<{ updateBdPurchaseSettings: { ok?: boolean; settings?: PurchaseSettings; errors?: Array<{ path: string; code: string }> } }>(
                `mutation ($input: JSON!) { updateBdPurchaseSettings(input: $input) }`,
                { input },
            ).then(result => result.updateBdPurchaseSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors ?? []));
            if (result.settings) {
                load(result.settings);
                toast.success(p.settingsSaved);
                void queryClient.invalidateQueries({ queryKey: ['purchaseSettings'] });
            } else toast.error(m.settings.fixErrors);
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const methodLabel = draft.costMethod === 'latest' ? p.costLatest : p.costAverage;
    return (
        <Page width="narrow">
            <PageHeader title={p.settingsTitle} description={p.settingsDescription} />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{m.settings.readOnly}</Alert>
                </div>
            )}
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    if (canEdit) save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={p.costMethod} />
                    <CardBody>
                        <Field label={p.costMethod} hint={p.costHint}>
                            {control => (
                                <Select
                                    {...control}
                                    value={draft.costMethod}
                                    disabled={!canEdit}
                                    onChange={event => setDraft({ ...draft, costMethod: event.target.value as CostMethod })}
                                >
                                    {METHODS.map(method => (
                                        <option key={method} value={method}>
                                            {method === 'latest' ? p.costLatest : p.costAverage}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                    </CardBody>
                </Card>
                <CollapsibleCard title={p.columns.number} summary={`${draft.purchasePrefix || '—'} · ${methodLabel}`}>
                    <Field label={p.purchasePrefix} hint={p.prefixHint} error={errors.purchasePrefix} optional>
                        {control => (
                            <Input
                                {...control}
                                value={draft.purchasePrefix}
                                disabled={!canEdit}
                                className="w-40 uppercase"
                                onChange={event => setDraft({ ...draft, purchasePrefix: event.target.value })}
                            />
                        )}
                    </Field>
                    <Field label={p.returnPrefix} error={errors.returnPrefix} optional>
                        {control => (
                            <Input
                                {...control}
                                value={draft.returnPrefix}
                                disabled={!canEdit}
                                className="w-40 uppercase"
                                onChange={event => setDraft({ ...draft, returnPrefix: event.target.value })}
                            />
                        )}
                    </Field>
                </CollapsibleCard>
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={discard} />}
            </form>
        </Page>
    );
}
