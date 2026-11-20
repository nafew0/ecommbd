import { useQuery } from '@tanstack/react-query';
import { Plus, Warehouse } from 'lucide-react';
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

interface Row {
    id: string;
    name: string;
    phone: string | null;
    sellsOnline: boolean;
}

/** Branches (phase 54): each one is a place that holds stock. */
export function BranchesPage() {
    const { messages: m } = useI18n();
    const b = m.branches;
    const format = useFormat();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const query = useQuery({
        queryKey: ['branches'],
        queryFn: () =>
            adminApi<{ bdBranches: Row[] }>(`{ bdBranches { id name phone sellsOnline } }`).then(
                result => result.bdBranches,
            ),
    });
    const term = search.trim().toLowerCase();
    const rows = (query.data ?? []).filter(row => !term || row.name.toLowerCase().includes(term));
    const columns: Column<Row>[] = [
        {
            key: 'name',
            header: b.columns.name,
            cell: row => (
                <Link
                    to={`/products/branches/${row.id}`}
                    className="font-semibold text-accent hover:underline"
                >
                    {row.name}
                </Link>
            ),
        },
        {
            key: 'phone',
            header: b.columns.phone,
            cell: row => (row.phone ? format.phone(row.phone) : ''),
        },
        {
            key: 'online',
            header: b.columns.sellsOnline,
            hideOnMobile: true,
            cell: row =>
                row.sellsOnline ? <Badge tone="green">{m.common.on}</Badge> : <Badge>{m.common.off}</Badge>,
        },
    ];
    return (
        <Page width="full">
            <PageHeader
                title={b.branchesTitle}
                description={b.branchesDescription}
                actions={
                    can('ManageBranch') ? (
                        <Button onClick={() => navigate('/products/branches/new')}>
                            <Plus className="size-4" aria-hidden />
                            {b.addBranch}
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
                        icon={<Warehouse className="size-6" aria-hidden />}
                        title={b.emptyBranches}
                        body={b.branchesDescription}
                    />
                }
            />
        </Page>
    );
}
