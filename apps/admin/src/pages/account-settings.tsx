import type { AccountSettings } from '@ecommbd/shared/accounts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { Select } from '../components/ui/input';
import { SaveBar } from '../components/ui/save-bar';
import { Page } from '../components/ui/layout';
import { Alert, Card, CardBody, PageHeader, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

const QUERY = `{
    bdAccountSettings { codAccountId gatewayAccountId bkashAccountId nagadAccountId rocketAccountId }
    bdAccounts(take: 100) { items { id name } }
}`;

const UPDATE = `
    mutation ($input: JSON!) {
        updateBdAccountSettings(input: $input) {
            settings { codAccountId gatewayAccountId bkashAccountId nagadAccountId rocketAccountId }
            errors { path code }
        }
    }
`;

/** Which account receives COD, the gateway and each mobile wallet (phase 53). */
export function AccountSettingsPage() {
    const { messages: m } = useI18n();
    const a = m.accounts;
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('ManageAccounts');
    const query = useQuery({
        queryKey: ['accountSettings'],
        queryFn: () =>
            adminApi<{
                bdAccountSettings: AccountSettings;
                bdAccounts: { items: Array<{ id: string; name: string }> };
            }>(QUERY),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<AccountSettings>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) load(query.data.bdAccountSettings);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: AccountSettings) =>
            adminApi<{
                updateBdAccountSettings: { settings: AccountSettings | null; errors: Array<{ path: string; code: string }> };
            }>(UPDATE, { input }).then(result => result.updateBdAccountSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                load(result.settings);
                toast.success(a.settingsSaved);
                void queryClient.invalidateQueries({ queryKey: ['accountSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const options = query.data?.bdAccounts.items ?? [];
    const fields: Array<{ key: keyof AccountSettings; label: string }> = [
        { key: 'codAccountId', label: a.cod },
        { key: 'gatewayAccountId', label: a.gateway },
        { key: 'bkashAccountId', label: a.bkash },
        { key: 'nagadAccountId', label: a.nagad },
        { key: 'rocketAccountId', label: a.rocket },
    ];
    return (
        <Page width="narrow">
            <PageHeader title={a.settingsTitle} description={a.settingsDescription} />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{a.readOnly}</Alert>
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
                    <CardBody>
                        <div className="space-y-4">
                            {fields.map(field => (
                                <Field key={field.key} label={field.label} error={errors[field.key]} optional>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={draft[field.key] ?? ''}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                setDraft({ ...draft, [field.key]: event.target.value || null })
                                            }
                                        >
                                            <option value="">{a.none}</option>
                                            {options.map(account => (
                                                <option key={account.id} value={account.id}>
                                                    {account.name}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </Field>
                            ))}
                        </div>
                    </CardBody>
                </Card>
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={discard} />}
            </form>
        </Page>
    );
}
