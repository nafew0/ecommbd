import { dhakaDateKey } from '@ecommbd/shared/time';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Field } from '../components/form/field';
import { ImageUpload, type UploadedImage } from '../components/form/image-upload';
import { TakaInput } from '../components/form/inputs';
import { MoreFields } from '../components/ui/disclosure';
import { Input, Select, Textarea } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { Card, CardBody, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { adminApi } from '../lib/api';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

interface Draft {
    day: string;
    headId: string;
    amount: number | null;
    accountId: string;
    note: string;
    receipt: UploadedImage | null;
}

interface ExpenseRow {
    id: string;
    date: string;
    headId: string;
    amount: number;
    accountId: string;
    note: string;
    receiptAssetId: string | null;
}

const blank = (): Draft => ({
    day: dhakaDateKey(new Date()),
    headId: '',
    amount: null,
    accountId: '',
    note: '',
    receipt: null,
});

/** One expense: date, head, amount, account and note. The receipt photo sits under More (phase 53). */
export function ExpensePage() {
    const { id } = useParams();
    const isNew = !id || id === 'new';
    const { messages: m, language } = useI18n();
    const a = m.accounts;
    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const expense = useQuery({
        queryKey: ['expense', id],
        enabled: !isNew,
        queryFn: () =>
            adminApi<{ bdExpense: ExpenseRow | null }>(
                `query ($id: ID!) { bdExpense(id: $id) { id date headId amount accountId note receiptAssetId } }`,
                { id },
            ).then(result => result.bdExpense),
    });
    const options = useQuery({
        queryKey: ['expenseOptions'],
        queryFn: () =>
            adminApi<{
                bdExpenseHeads: Array<{ id: string; nameBn: string; nameEn: string }>;
                bdAccounts: { items: Array<{ id: string; name: string }> };
            }>(`{ bdExpenseHeads { id nameBn nameEn } bdAccounts(take: 100) { items { id name } } }`),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<Draft>(isNew ? blank() : null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (expense.data && !draft) {
            load({
                day: expense.data.date,
                headId: expense.data.headId,
                amount: expense.data.amount,
                accountId: expense.data.accountId,
                note: expense.data.note,
                receipt: expense.data.receiptAssetId
                    ? { id: expense.data.receiptAssetId, preview: '' }
                    : null,
            });
        }
    }, [expense.data, draft]);
    const save = useMutation({
        mutationFn: (input: Draft) =>
            adminApi<{
                saveBdExpense: {
                    expense: { id: string } | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(
                `mutation ($id: ID, $input: JSON!) {
                    saveBdExpense(id: $id, input: $input) { expense { id } errors { path code } }
                }`,
                {
                    id: isNew ? null : id,
                    input: {
                        day: input.day,
                        headId: input.headId,
                        amount: input.amount,
                        accountId: input.accountId,
                        note: input.note,
                        receiptAssetId: input.receipt?.id ?? null,
                    },
                },
            ).then(result => result.saveBdExpense),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.expense) {
                load(draft!);
                toast.success(a.expenseSaved);
                void queryClient.invalidateQueries({ queryKey: ['expenses'] });
                if (isNew) navigate(`/accounts/expenses/${result.expense.id}`, { replace: true });
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft || (!isNew && expense.isLoading)) return <PageSkeleton />;
    const heads = options.data?.bdExpenseHeads ?? [];
    const accounts = options.data?.bdAccounts.items ?? [];
    return (
        <Page width="narrow">
            <PageHeader
                title={isNew ? a.newExpense : a.expenseTitle}
                description={a.expensesDescription}
                back={{ to: '/accounts/expenses', label: a.expensesTitle }}
            />
            {accounts.length === 0 && !options.isLoading && (
                <p className="mb-4 text-sm text-ink-muted">
                    <Link to="/accounts/new" className="text-accent hover:underline">
                        {a.add}
                    </Link>
                </p>
            )}
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    if (draft.amount == null) {
                        setErrors({ amount: 'invalid' });
                        return;
                    }
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardBody>
                        <div className="space-y-4">
                            <Field label={a.date} error={errors.day}>
                                {control => (
                                    <Input
                                        {...control}
                                        type="date"
                                        value={draft.day}
                                        onChange={event => setDraft({ ...draft, day: event.target.value })}
                                    />
                                )}
                            </Field>
                            <Field label={a.head} error={errors.headId}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.headId}
                                        onChange={event => setDraft({ ...draft, headId: event.target.value })}
                                    >
                                        <option value="">{a.none}</option>
                                        {heads.map(head => (
                                            <option key={head.id} value={head.id}>
                                                {language === 'bn' ? head.nameBn : head.nameEn}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                            <Field label={a.amount} error={errors.amount}>
                                {control => (
                                    <TakaInput
                                        {...control}
                                        value={draft.amount}
                                        onChange={amount => setDraft({ ...draft, amount })}
                                    />
                                )}
                            </Field>
                            <Field label={a.account} error={errors.accountId}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.accountId}
                                        onChange={event =>
                                            setDraft({ ...draft, accountId: event.target.value })
                                        }
                                    >
                                        <option value="">{a.none}</option>
                                        {accounts.map(account => (
                                            <option key={account.id} value={account.id}>
                                                {account.name}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                            <Field label={a.note} error={errors.note} optional>
                                {control => (
                                    <Textarea
                                        {...control}
                                        value={draft.note}
                                        onChange={event => setDraft({ ...draft, note: event.target.value })}
                                    />
                                )}
                            </Field>
                            <MoreFields summary={a.receipt} label={m.nav.more}>
                                <Field label={a.receipt} optional>
                                    {control => (
                                        <ImageUpload
                                            {...control}
                                            value={draft.receipt}
                                            onChange={receipt => setDraft({ ...draft, receipt })}
                                        />
                                    )}
                                </Field>
                            </MoreFields>
                        </div>
                    </CardBody>
                </Card>
                <SaveBar dirty={dirty} saving={save.isPending} onDiscard={isNew ? undefined : discard} />
            </form>
        </Page>
    );
}
