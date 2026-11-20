import { BRANCH_ZONES, type BranchSettings } from '@ecommbd/shared/branches';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { Input, Select } from '../components/ui/input';
import { SaveBar } from '../components/ui/save-bar';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Page } from '../components/ui/layout';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useDraft } from '../lib/use-draft';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

interface BranchOption {
    id: string;
    name: string;
}

/** Which branch ships each zone, and where each courier collects (phase 54). */
export function BranchSettingsPage() {
    const { messages: m } = useI18n();
    const b = m.branches;
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('ManageBranch');
    const query = useQuery({
        queryKey: ['branchSettings'],
        queryFn: () => adminApi<{ bdBranchSettings: BranchSettings }>('{ bdBranchSettings }').then(result => result.bdBranchSettings),
    });
    const branches = useQuery({
        queryKey: ['branchOptions'],
        queryFn: () => adminApi<{ bdBranches: BranchOption[] }>(`{ bdBranches { id name } }`).then(result => result.bdBranches),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<BranchSettings>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) load(query.data);
    }, [query.data, draft, load]);
    const save = useMutation({
        mutationFn: (input: BranchSettings) =>
            adminApi<{
                updateBdBranchSettings: { settings: BranchSettings | null; errors: Array<{ path: string; code: string }> };
            }>(
                `mutation ($input: JSON!) {
                    updateBdBranchSettings(input: $input) { settings errors { path code } }
                }`,
                { input },
            ).then(result => result.updateBdBranchSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                load(result.settings);
                toast.success(b.settingsSaved);
                void queryClient.invalidateQueries({ queryKey: ['branchSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const nameOf = (id: string) => branches.data?.find(branch => branch.id === id)?.name ?? b.none;
    const zone = (key: (typeof BRANCH_ZONES)[number], value: string) =>
        setDraft({ ...draft, zoneBranch: { ...draft.zoneBranch, [key]: value } });
    const pickup = (key: 'steadfast' | 'pathao', value: string) =>
        setDraft({ ...draft, pickupBranch: { ...draft.pickupBranch, [key]: value } });
    return (
        <Page width="narrow">
            <PageHeader title={b.settingsTitle} description={b.settingsDescription} />
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
                    <CardHeader title={b.zones} />
                    <CardBody>
                        <p className="text-sm text-ink-muted">{b.zonesHint}</p>
                        {BRANCH_ZONES.map(key => (
                            <Field key={key} label={m.delivery.zones[key]} error={errors[`zoneBranch.${key}`]}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.zoneBranch[key]}
                                        disabled={!canEdit}
                                        onChange={event => zone(key, event.target.value)}
                                    >
                                        <option value="">{b.none}</option>
                                        {(branches.data ?? []).map(branch => (
                                            <option key={branch.id} value={branch.id}>
                                                {branch.name}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                        ))}
                    </CardBody>
                </Card>
                <CollapsibleCard title={b.prefix} summary={draft.transferPrefix || b.none}>
                    <Field label={b.prefix} hint={b.prefixHint} error={errors.transferPrefix} optional>
                        {control => (
                            <Input
                                {...control}
                                value={draft.transferPrefix}
                                maxLength={6}
                                disabled={!canEdit}
                                className="w-40 uppercase"
                                onChange={event => setDraft({ ...draft, transferPrefix: event.target.value })}
                            />
                        )}
                    </Field>
                </CollapsibleCard>
                <CollapsibleCard
                    title={b.pickup}
                    summary={`${b.steadfast}: ${nameOf(draft.pickupBranch.steadfast)} · ${b.pathao}: ${nameOf(draft.pickupBranch.pathao)}`}
                >
                    <p className="text-sm text-ink-muted">{b.pickupHint}</p>
                    {(['steadfast', 'pathao'] as const).map(key => (
                        <Field key={key} label={b[key]} error={errors[`pickupBranch.${key}`]}>
                            {control => (
                                <Select
                                    {...control}
                                    value={draft.pickupBranch[key]}
                                    disabled={!canEdit}
                                    onChange={event => pickup(key, event.target.value)}
                                >
                                    <option value="">{b.none}</option>
                                    {(branches.data ?? []).map(branch => (
                                        <option key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                    ))}
                </CollapsibleCard>
                {canEdit && (
                    <SaveBar dirty={dirty} saving={save.isPending} saveLabel={m.settings.save} onDiscard={discard} />
                )}
            </form>
        </Page>
    );
}
