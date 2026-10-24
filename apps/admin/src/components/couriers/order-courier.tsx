import { COURIERS } from '@ecommbd/shared/couriers';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useConfirm } from '../../lib/confirm';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAgo } from '../../lib/orders';
import { useToast } from '../../lib/toast';
import { Field } from '../form/field';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Badge, type BadgeTone, Card, CardBody, CardHeader } from '../ui/misc';

interface Booking {
    id: string;
    courier: string;
    status: string;
    consignmentId: string | null;
    trackingCode: string | null;
    trackingUrl: string | null;
    codAmount: number;
    deliveryFee: number | null;
    outcome: string;
    courierStatus: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    events: Array<{ at: string; source: string; status: string }>;
}

const FIELDS = `id courier status consignmentId trackingCode trackingUrl codAmount deliveryFee outcome courierStatus errorCode errorMessage events { at source status }`;
const BOOKING = `query ($orderId: ID!) { bdCourierBooking(orderId: $orderId) { ${FIELDS} } }`;
const RESULT = `... on BdCourierBooking { ${FIELDS} } ... on BdCourierError { reason message detail }`;
const BOOK = `mutation ($orderId: ID!, $courier: String) { bookBdCourier(orderId: $orderId, courier: $courier) { ${RESULT} } }`;
const MANUAL = `mutation ($orderId: ID!, $courierName: String!, $trackingCode: String!) {
    markBdCourierBooked(orderId: $orderId, courierName: $courierName, trackingCode: $trackingCode) { ${RESULT} }
}`;
const CANCEL = `mutation ($orderId: ID!) { cancelBdCourierBooking(orderId: $orderId) { ${RESULT} } }`;
const CHECK = `mutation ($orderId: ID!) { checkBdCourierStatus(orderId: $orderId) { ${FIELDS} } }`;

type Result = Booking | { reason: string; message: string; detail?: string | null };

const TONES: Record<string, BadgeTone> = {
    booked: 'amber',
    pickedUp: 'indigo',
    delivered: 'green',
    partiallyDelivered: 'teal',
    returned: 'orange',
    cancelled: 'slate',
    note: 'slate',
};

/**
 * The order's courier (roadmap phase 19): book it (Confirmed or Packed), its consignment and status,
 * the courier's tracking page, "Check status now", cancel before pickup, and a booking made by hand
 * when a courier's system is down. The server checks BookCourier; buttons only follow it.
 */
export function OrderCourier({
    orderId,
    status,
    onChanged,
}: {
    orderId: string;
    status: string | null;
    onChanged(): void;
}) {
    const { messages: m } = useI18n();
    const o = m.couriers.order;
    const format = useFormat();
    const ago = useAgo();
    const toast = useToast();
    const confirm = useConfirm();
    const { can } = useAuth();
    const canBook = can('BookCourier');
    const [courier, setCourier] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [manual, setManual] = useState<{ name: string; code: string } | null>(null);
    const query = useQuery({
        queryKey: ['courierBooking', orderId],
        queryFn: () =>
            adminApi<{ bdCourierBooking: Booking | null }>(BOOKING, { orderId }).then(
                r => r.bdCourierBooking,
            ),
    });
    const booking = query.data;
    const live = booking && ['booking', 'booked', 'manual'].includes(booking.status);
    const bookable = !live && (status === 'confirmed' || status === 'packed');
    const name = (value: string) => m.couriers.names[value] ?? value;

    const run = async (
        key: string,
        document: string,
        variables: Record<string, unknown>,
        field: string,
        success: string,
    ) => {
        setBusy(key);
        try {
            const data = await adminApi<Record<string, Result | null>>(document, variables);
            const result = data[field];
            if (result && 'reason' in result) {
                toast.error(m.couriers.errors[result.reason] ?? result.message);
            } else {
                toast.success(success);
                setManual(null);
            }
            await query.refetch();
            onChanged();
        } catch {
            toast.error(m.errors.generic);
        } finally {
            setBusy(null);
        }
    };

    if (!booking && !bookable) return null;
    return (
        <Card>
            <CardHeader title={o.title} />
            <CardBody className="space-y-3">
                {booking && (live || booking.status === 'failed' || booking.status === 'cancelled') && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{name(booking.courier)}</span>
                            <Badge
                                tone={
                                    booking.status === 'failed' ? 'red' : (TONES[booking.outcome] ?? 'slate')
                                }
                            >
                                {booking.status === 'booked'
                                    ? (o.outcomes[booking.outcome] ?? booking.outcome)
                                    : (o.statuses[booking.status] ?? booking.status)}
                            </Badge>
                            {booking.courierStatus && (
                                <span className="text-sm text-slate-500">{booking.courierStatus}</span>
                            )}
                        </div>
                        {booking.status === 'failed' && (
                            <p className="text-sm text-red-700">
                                {o.failed(
                                    m.couriers.errors[booking.errorCode ?? ''] ?? booking.errorCode ?? '',
                                )}
                                {booking.errorMessage && ` (${booking.errorMessage})`}
                            </p>
                        )}
                        {booking.status === 'failed' && booking.errorCode === 'UNMAPPED_ADDRESS' && (
                            <Link to="/orders/unmapped-addresses" className="text-sm text-teal-800 underline">
                                {o.mapAddress}
                            </Link>
                        )}
                        {booking.consignmentId && (
                            <dl className="grid gap-2 text-sm sm:grid-cols-3">
                                <div>
                                    <dt className="text-slate-600">{o.consignment}</dt>
                                    <dd className="font-mono break-all">{booking.consignmentId}</dd>
                                </div>
                                {live && (
                                    <div>
                                        <dt className="text-slate-600">{o.cod}</dt>
                                        <dd className="tabular-nums">{format.money(booking.codAmount)}</dd>
                                    </div>
                                )}
                                {booking.deliveryFee !== null && (
                                    <div>
                                        <dt className="text-slate-600">{o.fee}</dt>
                                        <dd className="tabular-nums">{format.money(booking.deliveryFee)}</dd>
                                    </div>
                                )}
                            </dl>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {booking.trackingUrl && (
                                <a
                                    className="text-sm text-teal-800 underline"
                                    href={booking.trackingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {o.trackLink}
                                </a>
                            )}
                            {booking.status === 'booked' && can('UpdateOrder') && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    loading={busy === 'check'}
                                    onClick={() =>
                                        void run(
                                            'check',
                                            CHECK,
                                            { orderId },
                                            'checkBdCourierStatus',
                                            o.checked,
                                        )
                                    }
                                >
                                    {o.checkNow}
                                </Button>
                            )}
                            {live && booking.outcome === 'booked' && canBook && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    loading={busy === 'cancel'}
                                    onClick={async () => {
                                        if (
                                            await confirm({ title: o.cancelBooking, body: o.cancelConfirm })
                                        ) {
                                            void run(
                                                'cancel',
                                                CANCEL,
                                                { orderId },
                                                'cancelBdCourierBooking',
                                                o.cancelled,
                                            );
                                        }
                                    }}
                                >
                                    {o.cancelBooking}
                                </Button>
                            )}
                        </div>
                        {booking.events.length > 0 && (
                            <details className="text-sm">
                                <summary className="cursor-pointer text-slate-600">{o.history}</summary>
                                <ul className="mt-2 space-y-1">
                                    {[...booking.events].reverse().map(event => (
                                        <li
                                            key={`${event.at}-${event.status}`}
                                            className="flex flex-wrap justify-between gap-2"
                                        >
                                            <span>
                                                {event.status}{' '}
                                                <span className="text-slate-500">({event.source})</span>
                                            </span>
                                            <span className="text-slate-500">{ago(event.at)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        )}
                    </div>
                )}
                {!booking && bookable && <p className="text-sm text-slate-600">{o.notBooked}</p>}
                {bookable && canBook && (
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label={o.bookWith}>
                            {control => (
                                <Select
                                    {...control}
                                    value={courier}
                                    onChange={event => setCourier(event.target.value)}
                                    className="min-h-10 w-48"
                                >
                                    <option value="">{m.couriers.bulk.defaultCourier}</option>
                                    {COURIERS.map(item => (
                                        <option key={item} value={item}>
                                            {name(item)}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Button
                            loading={busy === 'book'}
                            onClick={() =>
                                void run(
                                    'book',
                                    BOOK,
                                    { orderId, courier: courier || null },
                                    'bookBdCourier',
                                    o.booked,
                                )
                            }
                        >
                            {booking?.status === 'failed' ? o.retry : o.book}
                        </Button>
                        {!manual && (
                            <Button variant="ghost" onClick={() => setManual({ name: '', code: '' })}>
                                {o.manual}
                            </Button>
                        )}
                    </div>
                )}
                {manual && bookable && (
                    <form
                        className="space-y-3 rounded-md border border-slate-200 p-3"
                        onSubmit={event => {
                            event.preventDefault();
                            void run(
                                'manual',
                                MANUAL,
                                { orderId, courierName: manual.name, trackingCode: manual.code },
                                'markBdCourierBooked',
                                o.booked,
                            );
                        }}
                    >
                        <p className="text-sm text-slate-600">{o.manualHint}</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label={o.courierName}>
                                {control => (
                                    <Input
                                        {...control}
                                        maxLength={40}
                                        value={manual.name}
                                        onChange={event => setManual({ ...manual, name: event.target.value })}
                                    />
                                )}
                            </Field>
                            <Field label={o.manualCode}>
                                {control => (
                                    <Input
                                        {...control}
                                        maxLength={60}
                                        value={manual.code}
                                        onChange={event => setManual({ ...manual, code: event.target.value })}
                                    />
                                )}
                            </Field>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                type="submit"
                                loading={busy === 'manual'}
                                disabled={!manual.name.trim() || !manual.code.trim()}
                            >
                                {o.saveManual}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setManual(null)}>
                                {m.common.cancel}
                            </Button>
                        </div>
                    </form>
                )}
            </CardBody>
        </Card>
    );
}
