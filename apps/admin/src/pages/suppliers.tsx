import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDigits } from '../components/form/inputs';
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
    phone: string | null;
    balance: number;
    purchaseCount: number;
}

/** Suppliers (phase 52). What is owed is worked out from purchases, returns and payments. */
export function SuppliersPage() {
    const { messages: m } = useI18n();
    const p = m.purchases;
    const format = useFormat();
    const digits = useDigits();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['suppliers', term, page],
        queryFn: () =>
            adminApi<{ bdSuppliers: { totalItems: number; items: Row[] } }>(
                `query ($search: String, $skip: Int, $take: Int) {
                    bdSuppliers(search: $search, skip: $skip, take: $take) {
                        totalItems
                        items { id name phone balance purchaseCount }
                    }
                }`,
                { search: term || null, skip: (page - 1) * 25, take: 25 },
            ).then(result => result.bdSuppliers),
        placeholderData: keepPreviousData,
    });
    const columns: Column<Row>[] = [
        {
            key: 'name',
            header: p.columns.name,
            cell: row => (
                <Link
                    to={`/products/suppliers/${row.id}`}
                    className="font-semibold text-accent hover:underline"
                >
                    {row.name}
                </Link>
            ),
        },
        {
            key: 'phone',
            header: p.columns.phone,
            cell: row => (row.phone ? format.phone(row.phone) : null),
            hideOnMobile: true,
        },
        {
            key: 'balance',
            header: p.columns.balance,
            className: 'text-right tabular-nums',
            cell: row => format.money(row.balance),
        },
        {
            key: 'purchases',
            header: p.columns.purchases,
            className: 'text-right tabular-nums',
            cell: row => digits(row.purchaseCount),
            hideOnMobile: true,
        },
    ];
    return (
        <Page width="full">
            <PageHeader
                title={p.suppliersTitle}
                description={p.suppliersDescription}
                actions={
                    can('ManagePurchase') ? (
                        <Button onClick={() => navigate('/products/suppliers/new')}>
                            <Plus className="size-4" aria-hidden />
                            {p.addSupplier}
                        </Button>
                    ) : undefined
                }
            />
            <ListPage
                rows={query.data?.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                search={{
                    value: search,
                    onChange: value => {
                        setSearch(value);
                        setPage(1);
                    },
                    placeholder: p.searchSuppliers,
                }}
                pagination={{
                    page,
                    pageSize: 25,
                    total: query.data?.totalItems ?? 0,
                    onChange: setPage,
                }}
                empty={
                    <EmptyState
                        icon={<Package className="size-6" aria-hidden />}
                        title={p.emptySuppliers}
                        body={p.suppliersDescription}
                    />
                }
            />
        </Page>
    );
}
