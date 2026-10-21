import { useQuery } from '@tanstack/react-query';
import { Settings, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardBody, CardHeader, PageHeader, Skeleton } from '../components/ui/misc';
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
        <>
            <PageHeader title={m.home.greeting(user?.name ?? '')} description={m.home.intro} />
            {can('ReadOrder') && <OrderWidgets />}
            <div className="grid gap-4 md:grid-cols-2">
                {can('ReadSettings') && (
                    <Card>
                        <CardHeader title={m.home.setupTitle} />
                        <CardBody>
                            <p className="text-slate-700">{m.home.setupBody}</p>
                            <Link
                                to="/settings/store"
                                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 font-medium text-white hover:bg-teal-800"
                            >
                                <Settings className="size-4" aria-hidden />
                                {m.home.openSettings}
                            </Link>
                        </CardBody>
                    </Card>
                )}
                <Card>
                    <CardHeader title={m.home.comingTitle} />
                    <CardBody>
                        <p className="flex gap-2 text-slate-700">
                            <Sparkles className="mt-1 size-4 shrink-0 text-teal-700" aria-hidden />
                            {m.home.comingBody}
                        </p>
                    </CardBody>
                </Card>
            </div>
        </>
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
                <Widget label={m.home.todayOrders} loading={!stats}>
                    {stats && n(stats.todayOrders)}
                </Widget>
                {stats?.todayOrderValue !== null && (
                    <Widget label={m.home.todayOrderValue} hint={m.home.orderValueHint} loading={!stats}>
                        {stats && format.money(stats.todayOrderValue ?? 0)}
                    </Widget>
                )}
                <Widget
                    label={m.home.waiting}
                    loading={!stats}
                    to="/orders/confirm"
                    linkLabel={m.home.openQueue}
                >
                    {stats && n(stats.waitingConfirmation)}
                </Widget>
                <Widget
                    label={m.home.confirmedNotPacked}
                    loading={!stats}
                    to="/orders?status=confirmed"
                    linkLabel={m.home.openOrders}
                >
                    {stats && n(stats.confirmedNotPacked)}
                </Widget>
            </div>
            {stats && (
                <p className="mt-2 text-sm text-slate-500">{m.home.dhakaDay(format.date(stats.dayStart))}</p>
            )}
        </section>
    );
}

function Widget({
    label,
    hint,
    loading,
    to,
    linkLabel,
    children,
}: {
    label: string;
    hint?: string;
    loading: boolean;
    to?: string;
    linkLabel?: string;
    children: ReactNode;
}) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">{label}</p>
            {loading ? (
                <Skeleton className="mt-2 h-8 w-20" />
            ) : (
                <p className="mt-1 text-2xl font-semibold tabular-nums">{children}</p>
            )}
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
            {to && linkLabel && (
                <Link to={to} className="mt-1 inline-block text-sm text-teal-800 underline">
                    {linkLabel}
                </Link>
            )}
        </div>
    );
}
