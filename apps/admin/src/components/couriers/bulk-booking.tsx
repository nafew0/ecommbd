import { LIVE_BOOKING_STATUSES } from '@ecommbd/shared/couriers';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/misc';

interface Row {
    id: string;
    orderId: string;
    invoice: string | null;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
}

const BOOKINGS = `query ($orderIds: [ID!]!) {
    bdCourierBookings(orderIds: $orderIds) { id orderId invoice status errorCode errorMessage }
}`;

/** Each order's booking before a bulk booking starts: how the progress tells new results from old. */
export type BulkStart = Record<string, { id: string; status: string }>;

/** A bulk booking that was queued: its orders and what their bookings were before. */
export interface BulkRun {
    orderIds: string[];
    before: BulkStart;
}

const fetchRows = (orderIds: string[]) =>
    adminApi<{ bdCourierBookings: Row[] }>(BOOKINGS, { orderIds }).then(r => r.bdCourierBookings);

/** Call before queueing a bulk booking. */
export async function bulkStart(orderIds: string[]): Promise<BulkStart> {
    const rows = await fetchRows(orderIds);
    return Object.fromEntries(rows.map(row => [row.orderId, { id: row.id, status: row.status }]));
}

const STOP_AFTER_MS = 3 * 60_000;

/**
 * A bulk booking's progress (phase 19): the server books each order in the background, so this
 * asks every 2 seconds until each order has its answer: booked, waiting for the courier, or not
 * booked with the reason (an order that wasn't ready, had no courier…), each linking to its order.
 */
export function BulkBookingProgress({ run, onClose }: { run: BulkRun; onClose(): void }) {
    const { messages: m } = useI18n();
    const b = m.couriers.bulk;
    const [startedAt] = useState(() => Date.now());
    const rows = useQuery({
        queryKey: ['bulkBooking', run.orderIds],
        queryFn: () => fetchRows(run.orderIds),
        refetchInterval: query => {
            const data = query.state.data;
            const finished = data && run.orderIds.every(id => answered(run, data, id));
            const old = Date.now() - startedAt > STOP_AFTER_MS;
            return finished || old ? false : 2_000;
        },
    });
    const data = rows.data ?? [];
    const done = data.filter(row => answered(run, data, row.orderId));
    const booked = done.filter(row => row.status === 'booked' || row.status === 'manual');
    const waiting = done.filter(row => row.status === 'unconfirmed');
    const failed = done.filter(row => row.status === 'failed' || row.status === 'cancelled');
    return (
        <Card className="mb-4">
            <CardHeader
                title={b.title}
                description={b.progress(done.length, run.orderIds.length)}
                actions={
                    <Button size="sm" variant="ghost" onClick={onClose}>
                        {b.close}
                    </Button>
                }
            />
            <CardBody className="space-y-2 text-sm">
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>{b.booked(booked.length)}</span>
                    {waiting.length > 0 && (
                        <span className="text-amber-800">{b.waiting(waiting.length)}</span>
                    )}
                    {failed.length > 0 && <span className="text-red-700">{b.failed(failed.length)}</span>}
                </p>
                {failed.length > 0 && (
                    <div>
                        <p className="font-medium">{b.failedList}</p>
                        <ul className="mt-1 space-y-1">
                            {failed.map(row => (
                                <li key={row.id}>
                                    <Link to={`/orders/${row.orderId}`} className="text-teal-800 underline">
                                        {b.order(row.invoice ?? row.orderId)}
                                    </Link>
                                    {': '}
                                    {m.couriers.errors[row.errorCode ?? ''] ?? row.errorCode}
                                    {row.errorMessage && (
                                        <span className="text-slate-500"> ({row.errorMessage})</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CardBody>
        </Card>
    );
}

/**
 * Whether the bulk booking answered for this order: its booking is new since the start (or the
 * order already had a live one, which booking gives back unchanged) and isn't mid-call.
 */
function answered(run: BulkRun, rows: Row[], orderId: string): boolean {
    const row = rows.find(item => item.orderId === orderId);
    if (!row || row.status === 'booking') return false;
    const before = run.before[orderId];
    return (
        !before ||
        row.id !== before.id ||
        (LIVE_BOOKING_STATUSES as readonly string[]).includes(before.status)
    );
}
