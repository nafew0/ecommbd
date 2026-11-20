import { dhakaDateKey } from '@ecommbd/shared/time';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { BarChart } from '../components/ui/bar-chart';
import { Button } from '../components/ui/button';
import { Tabs } from '../components/ui/tabs';
import { Input } from '../components/ui/input';
import { Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Page } from '../components/ui/layout';
import { StatTile } from '../components/ui/stat';
import { Field } from '../components/form/field';
import { adminApi } from '../lib/api';
import { useDigits } from '../components/form/inputs';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';

interface Part {
    known: boolean;
    amount: number | null;
}

interface Report {
    dateFrom: string;
    dateTo: string;
    previousFrom: string;
    previousTo: string;
    sales: Part;
    productCost: Part;
    deliveryAndCod: Part;
    gatewayFees: Part;
    expensesByHead: Array<{ code: string; name: string; amount: number }>;
    expenseTotal: number;
    profit: Part;
    previousProfit: Part;
    days: Array<{ date: string; sales: number | null; profit: number | null }>;
    notes: Array<{ orderCode: string; saleDate: string; returnDate: string }>;
}

const RANGES = ['today', 'week', 'month', 'thisMonth'] as const;
type Range = (typeof RANGES)[number];

/** Copied from the dashboard's range presets (components/dashboard.tsx). */
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

const QUERY = `query ($dateFrom: String!, $dateTo: String!) {
    bdProfitAndLoss(dateFrom: $dateFrom, dateTo: $dateTo) {
        dateFrom dateTo previousFrom previousTo expenseTotal
        sales { known amount }
        productCost { known amount }
        deliveryAndCod { known amount }
        gatewayFees { known amount }
        profit { known amount }
        previousProfit { known amount }
        expensesByHead { code name amount }
        days { date sales profit }
        notes { orderCode saleDate returnDate }
    }
}`;

/** Profit and loss for a Dhaka date range (phase 53). Phase 41's report list is not built, so this is its own screen. */
export function ProfitLossPage() {
    const { messages: m } = useI18n();
    const a = m.accounts;
    const format = useFormat();
    const digits = useDigits();
    const [range, setRange] = useState<Range | 'custom'>('thisMonth');
    const preset = range === 'custom' ? null : rangeDates(range);
    const [customFrom, setCustomFrom] = useState(preset?.dateFrom ?? '');
    const [customTo, setCustomTo] = useState(preset?.dateTo ?? '');
    const dates = range === 'custom' ? { dateFrom: customFrom, dateTo: customTo } : rangeDates(range);
    const query = useQuery({
        queryKey: ['profit', dates.dateFrom, dates.dateTo],
        enabled: Boolean(dates.dateFrom && dates.dateTo && dates.dateFrom <= dates.dateTo),
        queryFn: () =>
            adminApi<{ bdProfitAndLoss: Report }>(QUERY, dates).then(result => result.bdProfitAndLoss),
        placeholderData: keepPreviousData,
    });
    const data = query.data;
    const money = (part: Part | undefined) => {
        if (!part) return '—';
        return part.known && part.amount != null ? format.money(part.amount) : a.unknown;
    };
    const bars = useMemo(() => {
        const rows = data?.days ?? [];
        return rows.map(day => ({
            label: digits(day.date),
            value: Math.max(0, day.profit ?? 0),
            text: day.profit == null ? a.unknown : format.money(day.profit),
        }));
    }, [data, digits, format, a.unknown]);
    const top = bars.reduce((best, bar) => (bar.value > best.value ? bar : best), {
        value: 0,
        text: format.money(0),
    });
    return (
        <Page width="full">
            <PageHeader
                title={a.profitTitle}
                description={a.profitDescription}
                actions={
                    <Button
                        onClick={() =>
                            window.open(
                                `/admin/print/profit?from=${dates.dateFrom}&to=${dates.dateTo}`,
                                '_blank',
                            )
                        }
                    >
                        {a.print}
                    </Button>
                }
            />
            <Tabs
                label={a.profitTitle}
                active={range}
                onChange={key => setRange(key as Range)}
                items={RANGES.map(key => ({ key, label: a.ranges[key] }))}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label={a.fromDate}>
                    {control => (
                        <Input
                            {...control}
                            type="date"
                            value={dates.dateFrom}
                            onChange={event => {
                                setRange('custom');
                                setCustomFrom(event.target.value);
                                setCustomTo(dates.dateTo);
                            }}
                        />
                    )}
                </Field>
                <Field label={a.toDate}>
                    {control => (
                        <Input
                            {...control}
                            type="date"
                            value={dates.dateTo}
                            onChange={event => {
                                setRange('custom');
                                setCustomFrom(dates.dateFrom);
                                setCustomTo(event.target.value);
                            }}
                        />
                    )}
                </Field>
            </div>
            {!data ? (
                <div className="mt-4">
                    <PageSkeleton />
                </div>
            ) : (
                <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                        <StatTile label={a.sales} value={money(data.sales)} />
                        <StatTile label={a.productCost} value={money(data.productCost)} />
                        <StatTile label={a.deliveryAndCod} value={money(data.deliveryAndCod)} />
                        <StatTile label={a.gatewayFees} value={money(data.gatewayFees)} />
                        <StatTile label={a.expenseTotal} value={format.money(data.expenseTotal)} />
                        <StatTile label={a.profit} value={money(data.profit)} />
                    </div>
                    <p className="text-sm text-ink-muted">
                        {a.compare(money(data.profit), money(data.previousProfit))}{' '}
                        <span>
                            {a.previous}: {digits(data.previousFrom)} – {digits(data.previousTo)}
                        </span>
                    </p>
                    <Card>
                        <CardBody>
                            <BarChart data={bars} title={a.chart} maxLabel={a.highest(top.text)} />
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader title={a.byHead} />
                        <CardBody>
                            {data.expensesByHead.length === 0 ? (
                                <p className="text-sm text-ink-muted">{a.noExpensesInRange}</p>
                            ) : (
                                <ul className="divide-y divide-line text-sm">
                                    {data.expensesByHead.map(row => (
                                        <li key={row.code} className="flex justify-between gap-3 py-2">
                                            <span>{row.name}</span>
                                            <span className="tabular-nums">{format.money(row.amount)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardBody>
                    </Card>
                    {data.notes.length > 0 && (
                        <ul className="space-y-2 text-sm text-ink-muted">
                            {data.notes.map(note => (
                                <li key={`${note.orderCode}-${note.returnDate}`}>
                                    {a.returnNote(note.orderCode, digits(note.saleDate))}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </Page>
    );
}
