import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DistrictThanaPicker } from '../components/address/district-thana-picker';
import { Field } from '../components/form/field';
import { PhoneInput } from '../components/form/inputs';
import { MoreFields } from '../components/ui/disclosure';
import { Input, Textarea } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { Switch } from '../components/ui/switch';
import { ApiError, adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

interface Draft {
    name: string;
    phone: string;
    districtId: string;
    thanaId: string;
    addressLine: string;
    note: string;
    sellsOnline: boolean;
}

const empty = (): Draft => ({
    name: '',
    phone: '',
    districtId: '',
    thanaId: '',
    addressLine: '',
    note: '',
    sellsOnline: false,
});

/** One branch: name, address and whether the website sells from it. */
export function BranchPage() {
    const { id } = useParams();
    const isNew = !id;
    const { messages: m } = useI18n();
    const b = m.branches;
    const { can } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const canEdit = can('ManageBranch');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const query = useQuery({
        queryKey: ['branch', id],
        enabled: !isNew,
        queryFn: () =>
            adminApi<{ bdBranch: Draft | null }>(
                `query ($id: ID!) {
                    bdBranch(id: $id) { name phone districtId thanaId addressLine note sellsOnline }
                }`,
                { id },
            ).then(result => result.bdBranch),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<Draft>(isNew ? empty() : null);
    useEffect(() => {
        if (query.data) {
            load({
                name: query.data.name,
                phone: query.data.phone ?? '',
                districtId: query.data.districtId,
                thanaId: query.data.thanaId,
                addressLine: query.data.addressLine,
                note: query.data.note,
                sellsOnline: query.data.sellsOnline,
            });
        }
    }, [query.data, load]);
    const save = useMutation({
        mutationFn: (input: Draft) =>
            adminApi<{ saveBdBranch: { branch: { id: string } | null; errors: Array<{ path: string; code: string }> } }>(
                `mutation ($id: ID, $input: JSON!) {
                    saveBdBranch(id: $id, input: $input) { branch { id } errors { path code } }
                }`,
                { id: id ?? null, input },
            ).then(result => result.saveBdBranch),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (!result.branch) {
                toast.error(m.settings.fixErrors);
                return;
            }
            toast.success(b.saved);
            load(draft!);
            void queryClient.invalidateQueries({ queryKey: ['branches'] });
            if (isNew) navigate(`/products/branches/${result.branch.id}`, { replace: true });
            else void queryClient.invalidateQueries({ queryKey: ['branch', id] });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    const remove = useMutation({
        mutationFn: () => adminApi(`mutation ($id: ID!) { deleteBdBranch(id: $id) }`, { id }),
        onSuccess: () => {
            toast.success(b.deleted);
            void queryClient.invalidateQueries({ queryKey: ['branches'] });
            navigate('/products/branches');
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    if (!draft || (!isNew && query.isLoading)) return <PageSkeleton />;
    return (
        <Page width="narrow">
            <PageHeader
                back={{ to: '/products/branches', label: b.backBranches }}
                title={isNew ? b.addBranch : draft.name || b.branchesTitle}
                menu={
                    !isNew && canEdit
                        ? [
                              {
                                  label: b.delete,
                                  tone: 'danger',
                                  onSelect: () => {
                                      void confirm({ title: b.deleteTitle, body: b.deleteBody, danger: true }).then(yes => {
                                          if (yes) remove.mutate();
                                      });
                                  },
                              },
                          ]
                        : undefined
                }
            />
            <form
                onSubmit={event => {
                    event.preventDefault();
                    if (canEdit) save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={b.name} />
                    <CardBody>
                        <Field label={b.name} error={errors.name}>
                            {control => (
                                <Input
                                    {...control}
                                    value={draft.name}
                                    maxLength={80}
                                    disabled={!canEdit}
                                    onChange={event => setDraft({ ...draft, name: event.target.value })}
                                />
                            )}
                        </Field>
                        <DistrictThanaPicker
                            value={{ districtId: draft.districtId, thanaId: draft.thanaId }}
                            disabled={!canEdit}
                            allowOther={false}
                            errors={{ districtId: errors.districtId, thanaId: errors.thanaId }}
                            onChange={place => setDraft({ ...draft, districtId: place.districtId, thanaId: place.thanaId })}
                        />
                        <Field label={b.phone} error={errors.phone} optional>
                            {control => (
                                <PhoneInput
                                    {...control}
                                    value={draft.phone}
                                    disabled={!canEdit}
                                    onChange={phone => setDraft({ ...draft, phone })}
                                />
                            )}
                        </Field>
                        <Switch
                            label={b.sellsOnline}
                            description={b.sellsOnlineHint}
                            checked={draft.sellsOnline}
                            disabled={!canEdit}
                            onChange={sellsOnline => setDraft({ ...draft, sellsOnline })}
                        />
                        <MoreFields summary={b.moreSummary} forceOpen={Boolean(errors.addressLine || errors.note)}>
                            <Field label={b.addressLine} error={errors.addressLine} optional>
                                {control => (
                                    <Input
                                        {...control}
                                        value={draft.addressLine}
                                        maxLength={200}
                                        disabled={!canEdit}
                                        onChange={event => setDraft({ ...draft, addressLine: event.target.value })}
                                    />
                                )}
                            </Field>
                            <Field label={b.note} error={errors.note} optional>
                                {control => (
                                    <Textarea
                                        {...control}
                                        value={draft.note}
                                        maxLength={500}
                                        disabled={!canEdit}
                                        onChange={event => setDraft({ ...draft, note: event.target.value })}
                                    />
                                )}
                            </Field>
                        </MoreFields>
                    </CardBody>
                </Card>
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={discard} />}
            </form>
        </Page>
    );
}
