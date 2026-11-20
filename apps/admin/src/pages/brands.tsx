import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDigits } from '../components/form/inputs';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Page } from '../components/ui/layout';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useDebounced } from '../lib/use-debounced';

interface Row {
    id: string;
    code: string;
    name: { bn: string; en: string };
    logoPreview: string | null;
    productCount: number;
}

/** Brands (phase 55): a list with the logo, name and how many products have the brand. */
export function BrandsPage() {
    const { messages: m, language } = useI18n();
    const b = m.brands;
    const digits = useDigits();
    const { can } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['brands', 'list', term],
        queryFn: () =>
            adminApi<{ bdBrands: Row[] }>(
                `query ($search: String) { bdBrands(search: $search) { id code name { bn en } logoPreview productCount } }`,
                { search: term || null },
            ).then(result => result.bdBrands),
        placeholderData: keepPreviousData,
    });
    const nameOf = (row: Row) => row.name[language] || row.name.bn || row.name.en;
    const columns: Column<Row>[] = [
        {
            key: 'name',
            header: b.columns.brand,
            cell: row => (
                <div className="flex items-center gap-3">
                    {row.logoPreview ? (
                        <img
                            src={`${row.logoPreview}?preset=tiny`}
                            alt=""
                            className="size-10 shrink-0 rounded object-contain"
                        />
                    ) : (
                        <div className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-muted text-ink-faint">
                            <Tag className="size-4" aria-hidden />
                        </div>
                    )}
                    <Link to={`/products/brands/${row.id}`} className="font-medium text-accent hover:underline">
                        {nameOf(row)}
                    </Link>
                </div>
            ),
        },
        {
            key: 'address',
            header: b.columns.address,
            hideOnMobile: true,
            cell: row => <span className="text-ink-muted">/brand/{row.code}</span>,
        },
        {
            key: 'products',
            header: b.columns.products,
            className: 'text-right tabular-nums',
            cell: row => digits(row.productCount),
        },
    ];
    return (
        <Page width="full">
            <PageHeader
                title={b.title}
                description={b.description}
                actions={
                    can('UpdateCatalog') || can('CreateFacet') ? (
                        <Button onClick={() => navigate('/products/brands/new')}>
                            <Plus className="size-4" aria-hidden /> {b.add}
                        </Button>
                    ) : undefined
                }
            />
            <ListPage
                rows={query.data ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                search={{ value: search, onChange: setSearch, placeholder: b.search }}
                empty={<EmptyState icon={<Tag className="size-6" aria-hidden />} title={b.empty} body={b.emptyBody} />}
            />
        </Page>
    );
}
