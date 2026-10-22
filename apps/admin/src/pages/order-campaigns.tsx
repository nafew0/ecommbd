import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';

/**
 * Orders by campaign (roadmap phase 16): placed orders (not cancelled) per ad campaign and sales
 * page, from each order's attribution. A simple view; full reports are phase 41.
 */

interface CampaignRow {
    source: string;
    medium: string;
    campaign: string;
    salesPage: { id: string; title: string; slug: string } | null;
    orders: number;
    /** Null without ReadSalesFigures. */
    value: number | null;
}

const CAMPAIGNS = `
    query ($dateFrom: String, $dateTo: String) {
        bdOrdersByCampaign(dateFrom: $dateFrom, dateTo: $dateTo) {
            source medium campaign orders value
            salesPage { id title slug }
        }
    }
`;

export function OrderCampaignsPage() {
    const { messages: m } = useI18n();
    const c = m.orders.campaigns;
    const format = useFormat();
    const { can } = useAuth();
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const query = useQuery({
        queryKey: ['orderCampaigns', dateFrom, dateTo],
        queryFn: () =>
            adminApi<{ bdOrdersByCampaign: CampaignRow[] }>(CAMPAIGNS, {
                dateFrom: dateFrom || null,
                dateTo: dateTo || null,
            }).then(result => result.bdOrdersByCampaign),
    });
    const rows = query.data ?? [];
    const keyOf = (row: CampaignRow) =>
        [row.source, row.medium, row.campaign, row.salesPage?.id ?? ''].join('\u0001');
    const columns: Column<CampaignRow>[] = [
        {
            key: 'campaign',
            header: c.campaign,
            cell: row =>
                row.campaign ? (
                    <Link
                        to={`/orders?campaign=${encodeURIComponent(row.campaign)}`}
                        className="font-medium break-words text-teal-800 hover:underline"
                    >
                        {row.campaign}
                    </Link>
                ) : (
                    <span className="text-slate-500">{c.noCampaign}</span>
                ),
        },
        {
            key: 'source',
            header: c.source,
            cell: row => (
                <span className="break-words">
                    {[row.source, row.medium].filter(Boolean).join(' / ') || '—'}
                </span>
            ),
        },
        {
            key: 'page',
            header: c.salesPage,
            hideOnMobile: true,
            cell: row =>
                row.salesPage ? (
                    <Link
                        to={`/orders?salesPageId=${encodeURIComponent(row.salesPage.id)}`}
                        className="text-teal-800 hover:underline"
                    >
                        {row.salesPage.title}
                    </Link>
                ) : (
                    '—'
                ),
        },
        {
            key: 'orders',
            header: c.orders,
            className: 'text-right',
            cell: row => <span className="tabular-nums">{m.common.number(row.orders)}</span>,
        },
        ...(rows.some(row => row.value != null)
            ? [
                  {
                      key: 'value',
                      header: c.value,
                      className: 'text-right',
                      hideOnMobile: true,
                      cell: (row: CampaignRow) => (
                          <span className="tabular-nums">
                              {row.value != null ? format.money(row.value) : '—'}
                          </span>
                      ),
                  },
              ]
            : []),
    ];
    if (!can('ReadOrder')) return <p className="p-10 text-center text-slate-700">{m.errors.forbidden}</p>;
    return (
        <>
            <PageHeader title={c.title} description={c.description} />
            <ListPage
                rows={rows}
                rowId={keyOf}
                columns={columns}
                loading={query.isPending}
                filters={
                    <div className="flex w-full flex-wrap items-end gap-2">
                        <label className="text-sm">
                            <span className="block text-slate-600">{m.orders.filters.from}</span>
                            <Input
                                type="date"
                                value={dateFrom}
                                onChange={event => setDateFrom(event.target.value)}
                                className="w-40"
                            />
                        </label>
                        <label className="text-sm">
                            <span className="block text-slate-600">{m.orders.filters.to}</span>
                            <Input
                                type="date"
                                value={dateTo}
                                onChange={event => setDateTo(event.target.value)}
                                className="w-40"
                            />
                        </label>
                        {(dateFrom || dateTo) && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setDateFrom('');
                                    setDateTo('');
                                }}
                            >
                                {m.orders.filters.clear}
                            </Button>
                        )}
                    </div>
                }
                empty={
                    <EmptyState
                        icon={<Megaphone className="size-6" aria-hidden />}
                        title={c.emptyTitle}
                        body={c.emptyBody}
                    />
                }
            />
        </>
    );
}

export default OrderCampaignsPage;
