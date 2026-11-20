import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Page } from '../components/ui/layout';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useDebounced } from '../lib/use-debounced';

interface Row {
    id: string;
    name: string;
    kind: 'cash' | 'bank' | 'wallet' | 'courier';
    balance: number;
}

/** Accounts (phase 53). The balance is calculated from the opening amount and the ledger. */
export function AccountsPage() {
    const { messages: m } = useI18n();
    const a = m.accounts;
    const format = useFormat();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['accounts', term, page],
        queryFn: () =>
            adminApi<{ bdAccounts: { totalItems: number; items: Row[] } }>(
                `query ($search: String, $skip: Int, $take: Int) {
                    bdAccounts(search: $search, skip: $skip, take: $take) {
                        totalItems
                        items { id name kind balance }
                    }
                }`,
                { search: term || null, skip: (page - 1) * 25, take: 25 },
            ).then(result => result.bdAccounts),
        placeholderData: keepPreviousData,
    });
    const columns: Column<Row>[] = [
        {
            key: 'name',
            header: a.columns.name,
            cell: row => (
                <Link to={`/accounts/${row.id}`} className="font-semibold text-accent hover:underline">
                    {row.name}
                </Link>
            ),
        },
        { key: 'kind', header: a.columns.kind, cell: row => a.kinds[row.kind] },
        {
            key: 'balance',
            header: a.columns.balance,
            className: 'text-right tabular-nums',
            cell: row => format.money(row.balance),
        },
    ];
    const rows = query.data?.items ?? [];
    return (
        <Page width="full">
            <PageHeader
                title={a.listTitle}
                description={a.listDescription}
                actions={
                    can('ManageAccounts') ? (
                        <Button onClick={() => navigate('/accounts/new')}>
                            <Plus className="size-4" aria-hidden />
                            {a.add}
                        </Button>
                    ) : undefined
                }
            />
            <ListPage
                rows={rows}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                search={{ value: search, onChange: value => { setSearch(value); setPage(1); }, placeholder: a.search }}
                pagination={{
                    page,
                    pageSize: 25,
                    total: query.data?.totalItems ?? 0,
                    onChange: setPage,
                }}
                empty={<EmptyState icon={<Wallet className="size-6" aria-hidden />} title={a.emptyTitle} body={a.emptyBody} />}
            />
        </Page>
    );
}
