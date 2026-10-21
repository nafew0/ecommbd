import { visibleEmail } from '@ecommbd/shared/placeholder-email';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { type Column, ListPage } from '../components/list-page';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useDebounced } from '../lib/use-debounced';

const PAGE_SIZE = 20;

const CUSTOMERS = `
    query Customers($search: String, $skip: Int, $take: Int) {
        bdCustomers(search: $search, skip: $skip, take: $take) {
            totalItems
            items {
                id
                firstName
                lastName
                emailAddress
                customFields {
                    phone
                    orderCount
                    deliveredCount
                    returnedCount
                    totalSpent
                    lastOrderAt
                }
            }
        }
    }
`;

export interface CustomerRow {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    customFields: {
        phone: string | null;
        orderCount: number;
        deliveredCount: number;
        returnedCount: number;
        totalSpent: number;
        lastOrderAt: string | null;
    };
}

/** The customer list (roadmap phase 03): keyed by phone, searchable by the last digits. */
export function CustomersPage() {
    const { messages: m } = useI18n();
    const format = useFormat();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['customers', term, page],
        queryFn: () =>
            adminApi<{ bdCustomers: { totalItems: number; items: CustomerRow[] } }>(CUSTOMERS, {
                search: term || null,
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
            }).then(result => result.bdCustomers),
        placeholderData: keepPreviousData,
    });
    const c = m.customers.columns;
    const n = m.common.number;
    const columns: Column<CustomerRow>[] = [
        {
            key: 'name',
            header: c.name,
            cell: row => (
                <Link
                    to={`/customers/${row.id}`}
                    className="font-medium text-teal-800 underline-offset-2 hover:underline"
                >
                    {`${row.firstName} ${row.lastName}`.trim() || m.customers.noName}
                </Link>
            ),
        },
        {
            key: 'phone',
            header: c.phone,
            cell: row =>
                row.customFields.phone ? (
                    <a href={`tel:${row.customFields.phone}`} className="whitespace-nowrap tabular-nums">
                        {format.phone(row.customFields.phone)}
                    </a>
                ) : (
                    <span className="text-slate-600">{visibleEmail(row.emailAddress) ?? ''}</span>
                ),
        },
        { key: 'orders', header: c.orders, cell: row => n(row.customFields.orderCount) },
        {
            key: 'delivered',
            header: c.delivered,
            cell: row => n(row.customFields.deliveredCount),
            hideOnMobile: true,
        },
        {
            key: 'returned',
            header: c.returned,
            cell: row => n(row.customFields.returnedCount),
            hideOnMobile: true,
        },
        {
            key: 'spent',
            header: c.spent,
            cell: row => format.money(row.customFields.totalSpent),
            hideOnMobile: true,
        },
        {
            key: 'lastOrder',
            header: c.lastOrder,
            cell: row => format.date(row.customFields.lastOrderAt),
            hideOnMobile: true,
        },
    ];
    return (
        <>
            <PageHeader title={m.customers.title} description={m.customers.description} />
            <ListPage
                rows={query.data?.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isPending}
                search={{
                    value: search,
                    onChange: value => {
                        setSearch(value);
                        setPage(1);
                    },
                    placeholder: m.customers.searchPlaceholder,
                }}
                pagination={{
                    page,
                    pageSize: PAGE_SIZE,
                    total: query.data?.totalItems ?? 0,
                    onChange: setPage,
                }}
                empty={
                    term ? (
                        <p className="px-6 py-10 text-center text-slate-600">{m.list.noResults}</p>
                    ) : (
                        <EmptyState
                            icon={<Users className="size-6" aria-hidden />}
                            title={m.customers.emptyTitle}
                            body={m.customers.emptyBody}
                        />
                    )
                }
            />
        </>
    );
}
