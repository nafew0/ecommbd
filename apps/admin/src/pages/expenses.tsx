import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Field } from '../components/form/field';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Input } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { ApiError, adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

interface Row {
    id: string;
    date: string;
    headName: string;
    amount: number;
    accountName: string;
}

interface Head {
    id: string;
    nameBn: string;
    nameEn: string;
}

/** Expenses (phase 53). Heads can be renamed from the collapsed card. */
export function ExpensesPage() {
    const { messages: m, language } = useI18n();
    const a = m.accounts;
    const format = useFormat();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ['expenses', page],
        queryFn: () =>
            adminApi<{ bdExpenses: { totalItems: number; items: Row[] } }>(
                `query ($skip: Int, $take: Int) {
                    bdExpenses(skip: $skip, take: $take) {
                        totalItems
                        items { id date headName amount accountName }
                    }
                }`,
                { skip: (page - 1) * 25, take: 25 },
            ).then(result => result.bdExpenses),
        placeholderData: keepPreviousData,
    });
    const heads = useQuery({
        queryKey: ['expenseHeads'],
        queryFn: () =>
            adminApi<{ bdExpenseHeads: Head[] }>(`{ bdExpenseHeads { id nameBn nameEn } }`).then(
                result => result.bdExpenseHeads,
            ),
    });
    const [editing, setEditing] = useState<Head | 'new' | null>(null);
    const columns: Column<Row>[] = [
        {
            key: 'date',
            header: a.date,
            cell: row => (
                <Link
                    to={`/accounts/expenses/${row.id}`}
                    className="font-semibold text-accent hover:underline"
                >
                    {format.date(`${row.date}T06:00:00Z`)}
                </Link>
            ),
        },
        { key: 'head', header: a.head, cell: row => row.headName },
        {
            key: 'amount',
            header: a.amount,
            className: 'text-right tabular-nums',
            cell: row => format.money(row.amount),
        },
        { key: 'account', header: a.account, hideOnMobile: true, cell: row => row.accountName },
    ];
    const rows = query.data?.items ?? [];
    return (
        <Page width="full">
            <PageHeader
                title={a.expensesTitle}
                description={a.expensesDescription}
                actions={
                    can('ManageAccounts') ? (
                        <Button onClick={() => navigate('/accounts/expenses/new')}>
                            <Plus className="size-4" aria-hidden />
                            {a.addExpense}
                        </Button>
                    ) : undefined
                }
            />
            <ListPage
                rows={rows}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                pagination={{ page, pageSize: 25, total: query.data?.totalItems ?? 0, onChange: setPage }}
                empty={
                    <EmptyState
                        icon={<Receipt className="size-6" aria-hidden />}
                        title={a.emptyExpensesTitle}
                        body={a.emptyExpensesBody}
                    />
                }
            />
            <div className="mt-4">
                <CollapsibleCard title={a.heads} summary={a.headsSummary}>
                    <ul className="divide-y divide-line text-sm">
                        {(heads.data ?? []).map(head => (
                            <li key={head.id} className="flex items-center justify-between gap-3 py-2">
                                <span>{language === 'bn' ? head.nameBn : head.nameEn}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditing(head)}
                                >
                                    {a.rename}
                                </Button>
                            </li>
                        ))}
                    </ul>
                    <Button
                        type="button"
                        className="mt-3"
                        variant="secondary"
                        onClick={() => setEditing('new')}
                    >
                        {a.addHead}
                    </Button>
                </CollapsibleCard>
            </div>
            {editing && (
                <HeadDialog head={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
            )}
        </Page>
    );
}

function HeadDialog({ head, onClose }: { head: Head | null; onClose(): void }) {
    const { messages: m } = useI18n();
    const a = m.accounts;
    const toast = useToast();
    const queryClient = useQueryClient();
    const [nameBn, setNameBn] = useState(head?.nameBn ?? '');
    const [nameEn, setNameEn] = useState(head?.nameEn ?? '');
    const save = useMutation({
        mutationFn: () =>
            adminApi(
                `mutation ($id: ID, $input: JSON!) {
                    saveBdExpenseHead(id: $id, input: $input) { head { id } errors { path } }
                }`,
                { id: head?.id ?? null, input: { nameBn, nameEn } },
            ),
        onSuccess: () => {
            toast.success(a.headSaved);
            void queryClient.invalidateQueries({ queryKey: ['expenseHeads'] });
            onClose();
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    return (
        <Dialog
            open
            onClose={onClose}
            title={head ? a.rename : a.addHead}
            footer={
                <Button
                    type="button"
                    disabled={!nameBn.trim() || !nameEn.trim() || save.isPending}
                    onClick={() => save.mutate()}
                >
                    {m.common.save}
                </Button>
            }
        >
            <div className="space-y-4">
                <Field label={a.headBn}>
                    {control => (
                        <Input
                            {...control}
                            value={nameBn}
                            onChange={event => setNameBn(event.target.value)}
                        />
                    )}
                </Field>
                <Field label={a.headEn}>
                    {control => (
                        <Input
                            {...control}
                            value={nameEn}
                            onChange={event => setNameEn(event.target.value)}
                        />
                    )}
                </Field>
            </div>
        </Dialog>
    );
}
