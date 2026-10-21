import { BD_ORDER_STATUSES, type BdOrderStatus } from '@ecommbd/shared/order-status';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePlaces } from '../components/address/district-thana-picker';
import { DistrictName } from '../components/address/place-name';
import { type Column, ListPage, type ListTab } from '../components/list-page';
import { PaymentBadge, StatusBadge } from '../components/orders/status';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { ORDER_FIELDS, type OrderRow } from '../lib/orders';
import { useDebounced } from '../lib/use-debounced';

const PAGE_SIZE = 25;

const ORDERS = `
    query Orders($status: String, $search: String, $dateFrom: String, $dateTo: String, $districtId: String,
        $paymentType: String, $skip: Int, $take: Int) {
        bdOrders(status: $status, search: $search, dateFrom: $dateFrom, dateTo: $dateTo, districtId: $districtId,
            paymentType: $paymentType, skip: $skip, take: $take) {
            totalItems
            items { ...BdOrderRow }
        }
        bdOrderCounts(search: $search, dateFrom: $dateFrom, dateTo: $dateTo, districtId: $districtId,
            paymentType: $paymentType) { status count }
    }
    ${ORDER_FIELDS}
`;

interface OrdersData {
    bdOrders: { totalItems: number; items: OrderRow[] };
    bdOrderCounts: Array<{ status: BdOrderStatus; count: number }>;
}

interface Filters {
    dateFrom: string;
    dateTo: string;
    districtId: string;
    paymentType: string;
}

const NO_FILTERS: Filters = { dateFrom: '', dateTo: '', districtId: '', paymentType: '' };

/** All orders (roadmap phase 04): status tabs with counts, search, Dhaka-date and other filters. */
export function OrdersPage() {
    const { messages: m } = useI18n();
    const format = useFormat();
    const [params, setParams] = useSearchParams();
    const status = (params.get('status') as BdOrderStatus | null) ?? 'all';
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState<Filters>(NO_FILTERS);
    const [page, setPage] = useState(1);
    const term = useDebounced(search.trim());
    const { districts } = usePlaces('');
    const query = useQuery({
        queryKey: ['orders', 'list', status, term, filters, page],
        queryFn: () =>
            adminApi<OrdersData>(ORDERS, {
                status: status === 'all' ? null : status,
                search: term || null,
                dateFrom: filters.dateFrom || null,
                dateTo: filters.dateTo || null,
                districtId: filters.districtId || null,
                paymentType: filters.paymentType || null,
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
            }),
        placeholderData: keepPreviousData,
        refetchInterval: 60_000,
    });
    const counts = new Map(query.data?.bdOrderCounts.map(row => [row.status, row.count]));
    const tabs: ListTab[] = [
        {
            key: 'all',
            label: m.orders.all,
            count: [...counts.values()].reduce((sum, count) => sum + count, 0),
        },
        ...BD_ORDER_STATUSES.filter(key => key !== 'partiallyDelivered' || (counts.get(key) ?? 0) > 0).map(
            key => ({
                key,
                label: m.orders.statuses[key],
                count: counts.get(key) ?? 0,
            }),
        ),
    ];
    const setFilter = (key: keyof Filters, value: string) => {
        setFilters(current => ({ ...current, [key]: value }));
        setPage(1);
    };
    const c = m.orders.columns;
    const columns: Column<OrderRow>[] = [
        {
            key: 'number',
            header: c.number,
            cell: row => (
                <Link
                    to={`/orders/${row.id}`}
                    className="font-semibold text-teal-800 underline-offset-2 hover:underline"
                >
                    {m.orders.number(row.customFields.orderNumber ?? row.code)}
                </Link>
            ),
        },
        {
            key: 'customer',
            header: c.customer,
            cell: row => (
                <span className="break-words">
                    {row.shippingAddress?.fullName ?? row.customer?.firstName}
                </span>
            ),
        },
        {
            key: 'phone',
            header: c.phone,
            cell: row => {
                const phone = row.shippingAddress?.phoneNumber ?? row.customer?.customFields.phone;
                return phone ? (
                    <a href={`tel:${phone}`} className="whitespace-nowrap tabular-nums">
                        {format.phone(phone)}
                    </a>
                ) : null;
            },
        },
        {
            key: 'district',
            header: c.district,
            hideOnMobile: true,
            cell: row => <DistrictName districtId={row.shippingAddress?.customFields?.districtId} />,
        },
        { key: 'status', header: c.status, cell: row => <StatusBadge status={row.bd.status} /> },
        {
            key: 'payment',
            header: c.payment,
            hideOnMobile: true,
            cell: row => <PaymentBadge type={row.bd.paymentType} />,
        },
        {
            key: 'total',
            header: c.total,
            className: 'text-right tabular-nums',
            cell: row => format.money(row.totalWithTax),
        },
        { key: 'date', header: c.date, hideOnMobile: true, cell: row => format.dateTime(row.orderPlacedAt) },
    ];
    const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
    return (
        <>
            <PageHeader title={m.orders.title} description={m.orders.description} />
            <ListPage
                rows={query.data?.bdOrders.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isPending}
                tabs={{
                    items: tabs,
                    active: status,
                    onChange: key => {
                        setParams(key === 'all' ? {} : { status: key });
                        setPage(1);
                    },
                }}
                search={{
                    value: search,
                    onChange: value => {
                        setSearch(value);
                        setPage(1);
                    },
                    placeholder: m.orders.searchPlaceholder,
                }}
                filters={
                    <div className="flex w-full flex-wrap items-end gap-2">
                        <label className="text-sm">
                            <span className="block text-slate-600">{m.orders.filters.from}</span>
                            <Input
                                type="date"
                                value={filters.dateFrom}
                                onChange={event => setFilter('dateFrom', event.target.value)}
                                className="w-40"
                            />
                        </label>
                        <label className="text-sm">
                            <span className="block text-slate-600">{m.orders.filters.to}</span>
                            <Input
                                type="date"
                                value={filters.dateTo}
                                onChange={event => setFilter('dateTo', event.target.value)}
                                className="w-40"
                            />
                        </label>
                        <label className="text-sm">
                            <span className="block text-slate-600">{m.orders.filters.district}</span>
                            <Select
                                value={filters.districtId}
                                onChange={event => setFilter('districtId', event.target.value)}
                                className="w-44"
                            >
                                <option value="">{m.orders.filters.anyDistrict}</option>
                                {districts.data?.map(district => (
                                    <option key={district.id} value={district.id}>
                                        {district.name}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        <label className="text-sm">
                            <span className="block text-slate-600">{m.orders.filters.payment}</span>
                            <Select
                                value={filters.paymentType}
                                onChange={event => setFilter('paymentType', event.target.value)}
                                className="w-44"
                            >
                                <option value="">{m.orders.filters.anyPayment}</option>
                                {(['cod', 'advance', 'prepaid'] as const).map(type => (
                                    <option key={type} value={type}>
                                        {m.orders.paymentTypes[type]}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        {filtered && (
                            <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                                {m.orders.filters.clear}
                            </Button>
                        )}
                    </div>
                }
                pagination={{
                    page,
                    pageSize: PAGE_SIZE,
                    total: query.data?.bdOrders.totalItems ?? 0,
                    onChange: setPage,
                }}
                empty={
                    term || filtered || status !== 'all' ? (
                        <p className="px-6 py-10 text-center text-slate-600">{m.list.noResults}</p>
                    ) : (
                        <EmptyState
                            icon={<ShoppingBag className="size-6" aria-hidden />}
                            title={m.orders.emptyTitle}
                            body={m.orders.emptyBody}
                        />
                    )
                }
            />
        </>
    );
}
