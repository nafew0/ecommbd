import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { Link } from 'react-router';
import { Dashboard } from '../components/dashboard';
import { Page } from '../components/ui/layout';
import { Card, CardBody, CardHeader, PageHeader } from '../components/ui/misc';
import { StatTile } from '../components/ui/stat';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';

const STATS = `
    query HomeStats {
        bdOrderStats { dayStart todayOrders todayOrderValue waitingConfirmation confirmedNotPacked }
    }
`;

interface Stats {
    dayStart: string;
    todayOrders: number;
    /** Null without the ReadSalesFigures permission. */
    todayOrderValue: number | null;
    waitingConfirmation: number;
    confirmedNotPacked: number;
}

export function HomePage() {
    const { messages: m } = useI18n();
    const { user, can } = useAuth();
    return (
        <Page width="full">
            <PageHeader title={m.home.greeting(user?.name ?? '')} description={m.home.intro} />
            {can('ReadOrder') && <OrderWidgets />}
            {can('ReadOrder') && <CourierWidgets />}
            {can('ReadOrder') && <Dashboard />}
            {can('ReadSettings') && (
                <Card className="max-w-xl">
                    <CardHeader title={m.home.setupTitle} />
                    <CardBody>
                        <p className="text-sm text-ink-muted">{m.home.setupBody}</p>
                        <Link
                            to="/settings/store"
                            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                        >
                            <Settings className="size-4" aria-hidden />
                            {m.home.openSettings}
                        </Link>
                    </CardBody>
                </Card>
            )}
        </Page>
    );
}

/** Today's numbers (the Dhaka day) and the work waiting (roadmap phase 04). Sales need ReadSalesFigures. */
function OrderWidgets() {
    const { messages: m } = useI18n();
    const format = useFormat();
    const query = useQuery({
        queryKey: ['orders', 'stats'],
        queryFn: () => adminApi<{ bdOrderStats: Stats }>(STATS).then(result => result.bdOrderStats),
        refetchInterval: 60_000,
    });
    const stats = query.data;
    const n = m.common.number;
    return (
        <section className="mb-6" aria-label={m.nav.orders}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label={m.home.todayOrders} loading={!stats} value={stats && n(stats.todayOrders)} />
                {stats?.todayOrderValue !== null && (
                    <StatTile
                        label={m.home.todayOrderValue}
                        hint={m.home.orderValueHint}
                        loading={!stats}
                        value={stats && format.money(stats.todayOrderValue ?? 0)}
                    />
                )}
                <StatTile
                    label={m.home.waiting}
                    loading={!stats}
                    to="/orders/confirm"
                    tone={stats?.waitingConfirmation ? 'attention' : 'plain'}
                    value={stats && n(stats.waitingConfirmation)}
                />
                <StatTile
                    label={m.home.confirmedNotPacked}
                    loading={!stats}
                    to="/orders?status=confirmed"
                    tone={stats?.confirmedNotPacked ? 'attention' : 'plain'}
                    value={stats && n(stats.confirmedNotPacked)}
                />
            </div>
            {stats && (
                <p className="mt-2 text-[13px] text-ink-muted">
                    {m.home.dhakaDay(format.date(stats.dayStart))}
                </p>
            )}
        </section>
    );
}

const COURIER_COUNTS = `{ bdCourierCounts { inTransit deliveredToday returnedThisWeek } }`;

/** Parcels with couriers (roadmap phase 19): in transit, delivered today (Dhaka), returned this week. */
function CourierWidgets() {
    const { messages: m } = useI18n();
    const h = m.couriers.home;
    const query = useQuery({
        queryKey: ['courierCounts'],
        queryFn: () =>
            adminApi<{
                bdCourierCounts: { inTransit: number; deliveredToday: number; returnedThisWeek: number };
            }>(COURIER_COUNTS).then(result => result.bdCourierCounts),
        refetchInterval: 60_000,
    });
    const counts = query.data;
    // Nothing to show until the store books with couriers.
    if (counts && counts.inTransit + counts.deliveredToday + counts.returnedThisWeek === 0) return null;
    const n = m.common.number;
    return (
        <section className="mb-6" aria-label={m.couriers.order.title}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                    label={h.inTransit}
                    loading={!counts}
                    to="/orders?status=shipped"
                    value={counts && n(counts.inTransit)}
                />
                <StatTile
                    label={h.deliveredToday}
                    loading={!counts}
                    value={counts && n(counts.deliveredToday)}
                />
                <StatTile
                    label={h.returnedThisWeek}
                    loading={!counts}
                    value={counts && n(counts.returnedThisWeek)}
                />
            </div>
        </section>
    );
}
