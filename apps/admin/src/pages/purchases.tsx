import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDigits } from '../components/form/inputs';
import { type Column, ListPage, type ListTab } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Page } from '../components/ui/layout';
import { Badge, EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useDebounced } from '../lib/use-debounced';

const STATUSES = ['draft', 'ordered', 'partial', 'received'] as const;
type Status = (typeof STATUSES)[number];

interface Row {
    id: string;
    number: string;
    supplierName: string;
    purchasedOn: string;
    status: Status;
    total: number;
    owed: number;
}

const TONE = { draft: 'slate', ordered: 'sky', partial: 'amber', received: 'green' } as const;

/** Purchases (phase 52). Receiving one adds stock through the stock screen's adjustment. */
export function PurchasesPage() {
    const { messages: m } = useI18n();
    const p = m.purchases;
    const format = useFormat();
    const digits = useDigits();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [page, setPage] = useState(1);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['purchases', term, status, page],
        queryFn: () =>
            adminApi<{ bdPurchases: { totalItems: number; items: Row[] } }>(
                `query ($search: String, $status: String, $skip: Int, $take: Int) {
                    bdPurchases(search: $search, status: $status, skip: $skip, take: $take) {
                        totalItems
                        items { id number supplierName purchasedOn status total owed }
                    }
                }`,
                { search: term || null, status: status === 'all' ? null : status, skip: (page - 1) * 25, take: 25 },
            ).then(result => result.bdPurchases),
        placeholderData: keepPreviousData,
    });
    const tabs: ListTab[] = [
        { key: 'all', label: p.all },
        ...STATUSES.map(key => ({ key, label: p.statuses[key] })),
    ];
    const columns: Column<Row>[] = [
        {
            key: 'number',
            header: p.columns.number,
            cell: row => (
                <Link to={`/products/purchases/${row.id}`} className="font-semibold text-accent hover:underline">
                    {row.number}
                </Link>
            ),
        },
        { key: 'supplier', header: p.columns.name, cell: row => row.supplierName },
        {
            key: 'status',
            header: p.columns.status,
            cell: row => <Badge tone={TONE[row.status]}>{p.statuses[row.status]}</Badge>,
        },
        {
            key: 'total',
            header: p.columns.total,
            className: 'text-right tabular-nums',
            hideOnMobile: true,
            cell: row => format.money(row.total),
        },
        {
            key: 'date',
            header: p.columns.date,
            hideOnMobile: true,
            cell: row => digits(row.purchasedOn),
        },
    ];
    return (
        <Page width="full">
            <PageHeader
                title={p.purchasesTitle}
                description={p.purchasesDescription}
                actions={
                    can('ManagePurchase') ? (
                        <Button onClick={() => navigate('/products/purchases/new')}>
                            <Plus className="size-4" aria-hidden />
                            {p.addPurchase}
                        </Button>
                    ) : undefined
                }
            />
            <ListPage
                rows={query.data?.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                tabs={{ items: tabs, active: status, onChange: key => { setStatus(key); setPage(1); } }}
                search={{
                    value: search,
                    onChange: value => { setSearch(value); setPage(1); },
                    placeholder: p.searchPurchases,
                }}
                pagination={{ page, pageSize: 25, total: query.data?.totalItems ?? 0, onChange: setPage }}
                empty={<EmptyState icon={<Package className="size-6" aria-hidden />} title={p.emptyPurchases} body={p.purchasesDescription} />}
            />
        </Page>
    );
}
