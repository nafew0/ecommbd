import { BD_ORDER_STATUSES, type BdOrderStatus } from '@ecommbd/shared/order-status';
import { dhakaDateKey } from '@ecommbd/shared/time';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../lib/api';
import { cn } from '../lib/cn';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { StatusBadge } from './orders/status';
import { BarChart } from './ui/bar-chart';
import { Button } from './ui/button';
import { Card, CardBody, CardHeader, Skeleton } from './ui/misc';
import { StatTile } from './ui/stat';
import { Tabs } from './ui/tabs';

const DASHBOARD = `
    query Dashboard($dateFrom: String!, $dateTo: String!) {
        bdDashboard(dateFrom: $dateFrom, dateTo: $dateTo) {
            orders items sales averageOrder
            days { date orders sales }
            statuses { status count }
        }
        bdOrders(take: 5) {
            items {
                id code orderPlacedAt totalWithTax
                customFields { orderNumber }
                shippingAddress { fullName }
                bd { status }
            }
        }
    }
`;

interface DashboardData {
    bdDashboard: {
        orders: number;
        items: number;
        /** Null without the ReadSalesFigures permission. */
        sales: number | null;
        averageOrder: number | null;
        days: Array<{ date: string; orders: number; sales: number | null }>;
        statuses: Array<{ status: BdOrderStatus; count: number }>;
    };
    bdOrders: {
        items: Array<{
            id: string;
            code: string;
            orderPlacedAt: string | null;
            totalWithTax: number;
            customFields: { orderNumber: string | null };
            shippingAddress: { fullName: string | null } | null;
            bd: { status: BdOrderStatus | null };
        }>;
    };
}

const RANGES = ['today', 'week', 'month', 'thisMonth'] as const;
type Range = (typeof RANGES)[number];

/** A Dhaka day key moved by whole days. */
const shift = (key: string, days: number) =>
    new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

function rangeDates(range: Range): { dateFrom: string; dateTo: string } {
    const today = dhakaDateKey(new Date());
    const dateFrom =
        range === 'today'
            ? today
            : range === 'week'
              ? shift(today, -6)
              : range === 'month'
                ? shift(today, -29)
                : `${today.slice(0, 8)}01`;
    return { dateFrom, dateTo: today };
}

/**
 * The dashboard (roadmap phase 63c): order value, orders, items and the average order for a
 * range of Dhaka days, a bar per day, the orders per status (each linking to its list) and the
 * latest orders. Staff without ReadSalesFigures see counts only, and the chart shows orders.
 */
export function Dashboard() {
    const { messages: m } = useI18n();
    const format = useFormat();
    const d = m.dashboard;
    const [range, setRange] = useState<Range>('week');
    const dates = rangeDates(range);
    const query = useQuery({
        queryKey: ['dashboard', dates.dateFrom, dates.dateTo],
        queryFn: () => adminApi<DashboardData>(DASHBOARD, dates),
        placeholderData: keepPreviousData,
        refetchInterval: 5 * 60_000,
    });
    const data = query.data?.bdDashboard;
    const recent = query.data?.bdOrders.items ?? [];
    const n = m.common.number;
    const showSales = data?.sales !== null;
    const day = (key: string) => format.date(`${key}T06:00:00Z`).slice(0, 5);
    const bars = (data?.days ?? []).map(item => ({
        label: day(item.date),
        value: showSales ? (item.sales ?? 0) : item.orders,
        text: showSales ? format.money(item.sales ?? 0) : d.orderCount(n(item.orders)),
    }));
    const top = bars.reduce((best, bar) => (bar.value > best.value ? bar : best), { value: -1, text: '' });

    return (
        <section className="mb-6 space-y-4" aria-label={d.title}>
            <div className="flex flex-wrap items-end justify-between gap-2">
                <Tabs
                    label={d.title}
                    className="min-w-0 flex-1"
                    active={range}
                    onChange={key => setRange(key as Range)}
                    items={RANGES.map(key => ({ key, label: d.ranges[key] }))}
                />
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void query.refetch()}
                    aria-label={d.refresh}
                    title={d.refresh}
                >
                    <RefreshCw className={cn('size-4', query.isFetching && 'animate-spin')} aria-hidden />
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {showSales && (
                    <StatTile label={d.sales} loading={!data} value={data && format.money(data.sales ?? 0)} />
                )}
                <StatTile label={d.orders} loading={!data} value={data && n(data.orders)} />
                <StatTile label={d.items} loading={!data} value={data && n(data.items)} />
                {showSales && (
                    <StatTile
                        label={d.averageOrder}
                        loading={!data}
                        value={data && (data.averageOrder === null ? '—' : format.money(data.averageOrder))}
                    />
                )}
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Card>
                    <CardBody>
                        {data ? (
                            data.orders === 0 ? (
                                <p className="py-10 text-center text-sm text-ink-muted">{d.empty}</p>
                            ) : (
                                <BarChart
                                    data={bars}
                                    title={showSales ? d.chartSales : d.chartOrders}
                                    maxLabel={d.highest(top.text)}
                                />
                            )
                        ) : (
                            <Skeleton className="h-48 w-full" />
                        )}
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={d.byStatus} />
                    <CardBody>
                        <ul className="-my-1 divide-y divide-line text-sm">
                            {BD_ORDER_STATUSES.map(status => {
                                const count = data?.statuses.find(row => row.status === status)?.count ?? 0;
                                return (
                                    <li key={status}>
                                        <Link
                                            to={`/orders?status=${status}`}
                                            className="flex min-h-9 items-center justify-between gap-3 rounded-md hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                                        >
                                            <span className={cn(count === 0 && 'text-ink-muted')}>
                                                {m.orders.statuses[status]}
                                            </span>
                                            <span className="font-semibold tabular-nums">{n(count)}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </CardBody>
                </Card>
            </div>

            {recent.length > 0 && (
                <Card>
                    <CardHeader
                        title={d.recent}
                        actions={
                            <Link to="/orders" className="text-[13px] text-accent hover:underline">
                                {d.seeAll}
                            </Link>
                        }
                    />
                    <CardBody>
                        <ul className="-my-1 divide-y divide-line text-sm">
                            {recent.map(order => (
                                <li key={order.id}>
                                    <Link
                                        to={`/orders/${order.id}`}
                                        className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                                    >
                                        <span className="font-semibold tabular-nums">
                                            {m.orders.number(order.customFields.orderNumber ?? order.code)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-ink-muted">
                                            {order.shippingAddress?.fullName}
                                        </span>
                                        <StatusBadge status={order.bd.status} />
                                        <span className="w-20 text-right tabular-nums">
                                            {format.money(order.totalWithTax)}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </CardBody>
                </Card>
            )}
        </section>
    );
}
