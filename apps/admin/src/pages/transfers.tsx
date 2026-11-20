import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Page } from '../components/ui/layout';
import { Badge, EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';

type Status = 'sent' | 'partial' | 'received';

interface Row {
    id: string;
    number: string;
    fromName: string;
    toName: string;
    status: Status;
    sentAt: string;
}

const TONE = { sent: 'sky', partial: 'amber', received: 'green' } as const;

/** Stock transfers (phase 54). What is on the way cannot be sold until it is received. */
export function TransfersPage() {
    const { messages: m } = useI18n();
    const b = m.branches;
    const format = useFormat();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const query = useQuery({
        queryKey: ['transfers'],
        queryFn: () =>
            adminApi<{ bdTransfers: Row[] }>(
                `{ bdTransfers { id number fromName toName status sentAt } }`,
            ).then(result => result.bdTransfers),
    });
    const term = search.trim().toLowerCase();
    const rows = (query.data ?? []).filter(
        row => !term || row.number.toLowerCase().includes(term) || row.fromName.toLowerCase().includes(term),
    );
    const columns: Column<Row>[] = [
        {
            key: 'number',
            header: b.transferColumns.number,
            cell: row => (
                <Link to={`/products/transfers/${row.id}`} className="font-semibold text-accent hover:underline">
                    {row.number}
                </Link>
            ),
        },
        { key: 'from', header: b.transferColumns.from, cell: row => row.fromName },
        { key: 'to', header: b.transferColumns.to, cell: row => row.toName },
        {
            key: 'status',
            header: b.transferColumns.status,
            cell: row => <Badge tone={TONE[row.status]}>{b.statuses[row.status]}</Badge>,
        },
        {
            key: 'date',
            header: m.purchases.columns.date,
            hideOnMobile: true,
            cell: row => format.dateTime(row.sentAt),
        },
    ];
    return (
        <Page width="full">
            <PageHeader
                title={b.transfersTitle}
                description={b.transfersDescription}
                actions={
                    can('ManageBranch') ? (
                        <Button onClick={() => navigate('/products/transfers/new')}>
                            <Plus className="size-4" aria-hidden />
                            {b.addTransfer}
                        </Button>
                    ) : undefined
                }
            />
            <ListPage
                rows={rows}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                search={{ value: search, onChange: setSearch, placeholder: b.search }}
                empty={
                    <EmptyState
                        icon={<ArrowLeftRight className="size-6" aria-hidden />}
                        title={b.emptyTransfers}
                        body={b.transfersDescription}
                    />
                }
            />
        </Page>
    );
}
