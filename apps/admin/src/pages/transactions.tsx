import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { useState } from 'react';
import { type Column, ListPage } from '../components/list-page';
import { Field } from '../components/form/field';
import { Input, Select } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { ApiError, adminApi } from '../lib/api';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const SOURCES = ['order', 'purchase', 'expense', 'transfer', 'manual'] as const;
type Source = (typeof SOURCES)[number];

interface Row {
    id: string;
    date: string;
    accountName: string;
    direction: string;
    amount: number;
    source: Source;
    note: string;
}

/** The ledger (phase 53): filter it, and export the rows that match. */
export function TransactionsPage() {
    const { messages: m } = useI18n();
    const a = m.accounts;
    const format = useFormat();
    const toast = useToast();
    const [page, setPage] = useState(1);
    const [accountId, setAccountId] = useState('');
    const [source, setSource] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const accounts = useQuery({
        queryKey: ['accountOptions'],
        queryFn: () =>
            adminApi<{ bdAccounts: { items: Array<{ id: string; name: string }> } }>(
                `{ bdAccounts(take: 100) { items { id name } } }`,
            ).then(result => result.bdAccounts.items),
    });
    const filters = {
        accountId: accountId || null,
        source: source || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
    };
    const query = useQuery({
        queryKey: ['transactions', filters, page],
        queryFn: () =>
            adminApi<{ bdTransactions: { totalItems: number; items: Row[] } }>(
                `query ($accountId: ID, $source: String, $dateFrom: String, $dateTo: String, $skip: Int, $take: Int) {
                    bdTransactions(accountId: $accountId, source: $source, dateFrom: $dateFrom, dateTo: $dateTo, skip: $skip, take: $take) {
                        totalItems
                        items { id date accountName direction amount source note }
                    }
                }`,
                { ...filters, skip: (page - 1) * 25, take: 25 },
            ).then(result => result.bdTransactions),
        placeholderData: keepPreviousData,
    });
    const exportCsv = async () => {
        try {
            const result = await adminApi<{ bdTransactionsCsv: string }>(
                `query ($accountId: ID, $source: String, $dateFrom: String, $dateTo: String) {
                    bdTransactionsCsv(accountId: $accountId, source: $source, dateFrom: $dateFrom, dateTo: $dateTo)
                }`,
                filters,
            );
            const blob = new Blob([result.bdTransactionsCsv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'transactions.csv';
            link.click();
            URL.revokeObjectURL(url);
            toast.success(a.exported);
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : m.errors.generic);
        }
    };
    const columns: Column<Row>[] = [
        { key: 'date', header: a.date, cell: row => format.date(`${row.date}T06:00:00Z`) },
        { key: 'account', header: a.account, cell: row => row.accountName },
        { key: 'source', header: a.source, cell: row => a.sources[row.source] },
        {
            key: 'amount',
            header: a.amount,
            className: 'text-right tabular-nums',
            cell: row => `${row.direction === 'out' ? '−' : ''}${format.money(row.amount)}`,
        },
        { key: 'note', header: a.note, hideOnMobile: true, cell: row => row.note },
    ];
    const dateFilters = (
        <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.fromDate}>
                {control => (
                    <Input
                        {...control}
                        type="date"
                        value={dateFrom}
                        onChange={event => {
                            setDateFrom(event.target.value);
                            setPage(1);
                        }}
                    />
                )}
            </Field>
            <Field label={a.toDate}>
                {control => (
                    <Input
                        {...control}
                        type="date"
                        value={dateTo}
                        onChange={event => {
                            setDateTo(event.target.value);
                            setPage(1);
                        }}
                    />
                )}
            </Field>
        </div>
    );
    return (
        <Page width="full">
            <PageHeader
                title={a.transactionsTitle}
                description={a.transactionsDescription}
                menu={[{ label: a.export, onSelect: () => void exportCsv() }]}
            />
            <ListPage
                rows={query.data?.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                pagination={{ page, pageSize: 25, total: query.data?.totalItems ?? 0, onChange: setPage }}
                filters={
                    <div className="flex flex-wrap gap-2">
                        <Select
                            aria-label={a.account}
                            value={accountId}
                            onChange={event => {
                                setAccountId(event.target.value);
                                setPage(1);
                            }}
                        >
                            <option value="">{a.allAccounts}</option>
                            {(accounts.data ?? []).map(account => (
                                <option key={account.id} value={account.id}>
                                    {account.name}
                                </option>
                            ))}
                        </Select>
                        <Select
                            aria-label={a.allSources}
                            value={source}
                            onChange={event => {
                                setSource(event.target.value);
                                setPage(1);
                            }}
                        >
                            <option value="">{a.allSources}</option>
                            {SOURCES.map(key => (
                                <option key={key} value={key}>
                                    {a.sources[key]}
                                </option>
                            ))}
                        </Select>
                    </div>
                }
                moreFilters={{
                    content: dateFilters,
                    active: Number(Boolean(dateFrom)) + Number(Boolean(dateTo)),
                }}
                empty={
                    <EmptyState
                        icon={<ArrowLeftRight className="size-6" aria-hidden />}
                        title={a.emptyTransactionsTitle}
                        body={a.emptyTransactionsBody}
                    />
                }
            />
        </Page>
    );
}
