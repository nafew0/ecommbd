import type { BdCancelReason } from '@ecommbd/shared/order-status';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Phone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PlaceName } from '../components/address/place-name';
import { CallLaterDialog, CancelDialog, StockDialog } from '../components/orders/order-dialogs';
import { RiskBadge } from '../components/orders/risk-badge';
import { PaymentBadge } from '../components/orders/status';
import { Button } from '../components/ui/button';
import { Badge, EmptyState, PageHeader, Skeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import {
    claimOrder,
    ORDER_FIELDS,
    type OrderRow,
    releaseOrder,
    useAgo,
    useOrderActions,
} from '../lib/orders';
import { useToast } from '../lib/toast';

const PAGE_SIZE = 50;

const QUEUE = `
    query Queue($skip: Int, $take: Int) {
        waiting: bdConfirmationQueue(skip: $skip, take: $take) { totalItems items { ...BdOrderRow } }
        snoozed: bdConfirmationQueue(snoozed: true, skip: $skip, take: $take) { totalItems items { ...BdOrderRow } }
    }
    ${ORDER_FIELDS}
`;

const CONFIRM_MANY = `
    mutation ConfirmMany($ids: [ID!]!) {
        confirmBdOrders(orderIds: $ids) { __typename ... on BdOrderActionError { message } }
    }
`;

interface QueueData {
    waiting: { totalItems: number; items: OrderRow[] };
    snoozed: { totalItems: number; items: OrderRow[] };
}

/**
 * The confirmation queue (roadmap phase 04): New orders, oldest first. Staff call, then confirm,
 * cancel with a reason, mark "no answer" (moves it down) or "call later" (hides it until then).
 * The highlighted order is claimed, so others see "Rahim is calling". Works with the keyboard.
 */
export function ConfirmOrdersPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const act = useOrderActions();
    const [tab, setTab] = useState<'waiting' | 'snoozed'>('waiting');
    const [page, setPage] = useState(1);
    const [active, setActive] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [dialog, setDialog] = useState<'cancel' | 'callLater' | null>(null);
    const [cancelReason, setCancelReason] = useState<BdCancelReason | undefined>();
    const [stockShort, setStockShort] = useState<string[] | null>(null);
    const [confirmingMany, setConfirmingMany] = useState(false);
    const query = useQuery({
        queryKey: ['orders', 'queue', page],
        queryFn: () => adminApi<QueueData>(QUEUE, { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
        placeholderData: keepPreviousData,
        // Claims and new orders from other staff show up without reloading.
        refetchInterval: 20_000,
    });
    const rows = query.data?.[tab].items ?? [];
    const total = query.data?.[tab].totalItems ?? 0;
    const current = rows[Math.min(active, rows.length - 1)];
    const canConfirm = can('ConfirmOrder');

    // The highlighted order is claimed while it stays highlighted.
    const claimed = useRef<string | null>(null);
    useEffect(() => {
        const id = current?.id ?? null;
        if (!canConfirm || claimed.current === id) return;
        if (claimed.current) void releaseOrder(claimed.current);
        claimed.current = id;
        if (id && !current?.bd.claim) void claimOrder(id);
    }, [current?.id, canConfirm]);
    useEffect(() => () => void (claimed.current && releaseOrder(claimed.current)), []);

    const run = useCallback(
        async (order: OrderRow, action: 'confirm' | 'noAnswer', extra: Record<string, unknown> = {}) => {
            const input =
                action === 'confirm'
                    ? { orderId: order.id, expectedStatus: 'new', ...extra }
                    : { orderId: order.id, outcome: 'noAnswer' };
            const error = await act(action, input);
            if (error?.reason === 'INSUFFICIENT_STOCK') setStockShort(error.details);
            void query.refetch();
            return error;
        },
        [act, query],
    );

    // Keyboard: J/K move, C confirm, X cancel, N no answer, L call later.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (dialog || stockShort || event.metaKey || event.ctrlKey || event.altKey) return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
            const key = event.key.toLowerCase();
            if (key === 'j') setActive(index => Math.min(index + 1, rows.length - 1));
            else if (key === 'k') setActive(index => Math.max(index - 1, 0));
            else if (!current || !canConfirm || tab !== 'waiting') return;
            else if (key === 'c') void run(current, 'confirm');
            else if (key === 'n') void run(current, 'noAnswer');
            else if (key === 'l') setDialog('callLater');
            else if (key === 'x' && can('CancelOrder')) setDialog('cancel');
            else return;
            event.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [rows.length, current, dialog, stockShort, canConfirm, tab, run, can]);

    const confirmSelected = async () => {
        setConfirmingMany(true);
        try {
            const { confirmBdOrders } = await adminApi<{
                confirmBdOrders: Array<{ __typename: string; message?: string }>;
            }>(CONFIRM_MANY, { ids: [...selected] });
            const done = confirmBdOrders.filter(result => result.__typename === 'Order').length;
            if (done) toast.success(m.queue.confirmedCount(done));
            confirmBdOrders.filter(result => result.message).forEach(result => toast.error(result.message!));
        } catch {
            toast.error(m.errors.generic);
        }
        setSelected(new Set());
        setConfirmingMany(false);
        void query.refetch();
    };

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
        <>
            <PageHeader
                title={m.queue.title}
                description={m.queue.description}
                actions={
                    selected.size > 0 && canConfirm ? (
                        <Button onClick={() => void confirmSelected()} loading={confirmingMany}>
                            <CheckCircle2 className="size-4" aria-hidden />
                            {m.queue.confirmSelected(selected.size)}
                        </Button>
                    ) : undefined
                }
            />
            <div className="mb-3 flex gap-1 border-b border-slate-200" role="tablist">
                {(['waiting', 'snoozed'] as const).map(key => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => {
                            setTab(key);
                            setActive(0);
                            setSelected(new Set());
                        }}
                        className={cn(
                            'flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium',
                            tab === key
                                ? 'border-teal-700 text-teal-800'
                                : 'border-transparent text-slate-600',
                        )}
                    >
                        {m.queue[key]}
                        <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-700">
                            {m.common.number(query.data?.[key].totalItems ?? 0)}
                        </span>
                    </button>
                ))}
            </div>
            <p className="mb-3 hidden text-sm text-slate-500 lg:block">{m.queue.shortcuts}</p>
            {query.isPending ? (
                <div className="space-y-3">
                    {Array.from({ length: 3 }, (_, index) => (
                        <Skeleton key={index} className="h-40 w-full" />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white">
                    <EmptyState
                        icon={<CheckCircle2 className="size-6" aria-hidden />}
                        title={m.queue.emptyTitle}
                        body={tab === 'waiting' ? m.queue.emptyBody : m.queue.snoozedEmpty}
                    />
                </div>
            ) : (
                <ul className="space-y-3">
                    {rows.map((order, index) => (
                        <QueueCard
                            key={order.id}
                            order={order}
                            active={index === active}
                            snoozed={tab === 'snoozed'}
                            selected={selected.has(order.id)}
                            onSelect={checked => {
                                const next = new Set(selected);
                                if (checked) next.add(order.id);
                                else next.delete(order.id);
                                setSelected(next);
                            }}
                            onFocus={() => setActive(index)}
                            onConfirm={() => void run(order, 'confirm')}
                            onNoAnswer={() => void run(order, 'noAnswer')}
                            onCallLater={() => {
                                setActive(index);
                                setDialog('callLater');
                            }}
                            onCancel={() => {
                                setActive(index);
                                setCancelReason(order.bd.possibleDuplicateOf ? 'duplicate' : undefined);
                                setDialog('cancel');
                            }}
                        />
                    ))}
                </ul>
            )}
            {pages > 1 && (
                <div className="mt-3 flex items-center justify-end gap-2 text-sm">
                    <button
                        type="button"
                        className="rounded p-2 hover:bg-slate-100 disabled:opacity-40"
                        aria-label={m.list.previous}
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                    >
                        <ChevronLeft className="size-4" aria-hidden />
                    </button>
                    <span>{m.list.pageOf(page, pages)}</span>
                    <button
                        type="button"
                        className="rounded p-2 hover:bg-slate-100 disabled:opacity-40"
                        aria-label={m.list.next}
                        disabled={page >= pages}
                        onClick={() => setPage(page + 1)}
                    >
                        <ChevronRight className="size-4" aria-hidden />
                    </button>
                </div>
            )}
            {current && (
                <>
                    <CancelDialog
                        orderNumber={current.customFields.orderNumber ?? current.code}
                        open={dialog === 'cancel'}
                        defaultReason={cancelReason}
                        onClose={() => setDialog(null)}
                        onCancel={async (reason, note) => {
                            const error = await act('cancel', {
                                orderId: current.id,
                                expectedStatus: 'new',
                                reason,
                                note,
                            });
                            if (!error) setDialog(null);
                            void query.refetch();
                        }}
                    />
                    <CallLaterDialog
                        open={dialog === 'callLater'}
                        onClose={() => setDialog(null)}
                        onSave={async callBackAt => {
                            const error = await act('callLater', {
                                orderId: current.id,
                                outcome: 'callLater',
                                callBackAt,
                            });
                            if (!error) setDialog(null);
                            void query.refetch();
                        }}
                    />
                    <StockDialog
                        items={stockShort}
                        onClose={() => setStockShort(null)}
                        onConfirmAnyway={() => {
                            setStockShort(null);
                            void run(current, 'confirm', { ignoreStockWarning: true });
                        }}
                        onCancelOrder={() => {
                            setStockShort(null);
                            setCancelReason('outOfStock');
                            setDialog('cancel');
                        }}
                    />
                </>
            )}
        </>
    );
}

function QueueCard(props: {
    order: OrderRow;
    active: boolean;
    snoozed: boolean;
    selected: boolean;
    onSelect(checked: boolean): void;
    onFocus(): void;
    onConfirm(): void;
    onNoAnswer(): void;
    onCallLater(): void;
    onCancel(): void;
}) {
    const { order } = props;
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const format = useFormat();
    const ago = useAgo();
    const address = order.shippingAddress;
    const fields = address?.customFields;
    const phone = address?.phoneNumber ?? order.customer?.customFields.phone;
    const number = order.customFields.orderNumber ?? order.code;
    const claim = order.bd.claim;
    const items = order.lines
        .filter(line => line.quantity > 0)
        .map(line => `${line.productVariant.name} ${m.orders.quantity(line.quantity)}`)
        .join(', ');
    return (
        <li
            onClick={props.onFocus}
            className={cn(
                'rounded-lg border bg-white p-4',
                props.active ? 'border-teal-600 ring-2 ring-teal-600/20' : 'border-slate-200',
            )}
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                    {can('ConfirmOrder') && !props.snoozed && (
                        <input
                            type="checkbox"
                            className="size-5 accent-teal-700"
                            aria-label={m.queue.select(number)}
                            checked={props.selected}
                            onChange={event => props.onSelect(event.target.checked)}
                        />
                    )}
                    <Link
                        to={`/orders/${order.id}`}
                        className="text-lg font-semibold text-teal-800 hover:underline"
                    >
                        {m.orders.number(number)}
                    </Link>
                    <span className="text-sm text-slate-600">
                        {m.orders.placed(ago(order.orderPlacedAt))}
                    </span>
                </div>
                <div className="flex flex-wrap gap-1">
                    {claim && !claim.mine && (
                        <Badge tone="sky">{m.orders.claim.other(claim.name ?? '')}</Badge>
                    )}
                    {props.snoozed && order.bd.queueAt && (
                        <Badge tone="violet">{m.queue.callAt(format.dateTime(order.bd.queueAt))}</Badge>
                    )}
                    {order.bd.possibleDuplicateOf && (
                        <Badge tone="orange">{m.orders.badges.duplicate(order.bd.possibleDuplicateOf)}</Badge>
                    )}
                    {order.bd.suggestCancel && <Badge tone="red">{m.orders.badges.suggestCancel}</Badge>}
                    {order.bd.callAttempts > 0 && (
                        <Badge>{m.orders.badges.calls(order.bd.callAttempts)}</Badge>
                    )}
                    <RiskBadge risk={order.bdRisk} otpStatus={order.bdOtpStatus} />
                </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1">
                    <p className="font-medium break-words">{address?.fullName}</p>
                    <div className="flex flex-wrap gap-2">
                        {phone && (
                            <a
                                href={`tel:${phone}`}
                                onClick={props.onFocus}
                                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 px-3 font-medium text-teal-800 tabular-nums hover:bg-teal-50"
                            >
                                <Phone className="size-4" aria-hidden />
                                {format.phone(phone)}
                            </a>
                        )}
                        {fields?.alternatePhone && (
                            <a
                                href={`tel:${fields.alternatePhone}`}
                                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 tabular-nums hover:bg-slate-50"
                            >
                                {m.orders.alternate}: {format.phone(fields.alternatePhone)}
                            </a>
                        )}
                    </div>
                    <p className="text-sm text-slate-700 break-words">
                        <PlaceName
                            districtId={fields?.districtId}
                            thanaId={fields?.thanaId}
                            area={fields?.area}
                        />
                    </p>
                </div>
                <div className="min-w-0 space-y-1 text-sm">
                    <p className="break-words">{items}</p>
                    <p className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold tabular-nums">
                            {format.money(order.totalWithTax)}
                        </span>
                        <PaymentBadge type={order.bd.paymentType} />
                    </p>
                    {order.customFields.customerNote && (
                        <p className="rounded bg-amber-50 px-2 py-1 break-words text-amber-950">
                            {order.customFields.customerNote}
                        </p>
                    )}
                </div>
            </div>
            {can('ConfirmOrder') && (
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={props.onConfirm}>{m.orders.actions.confirm}</Button>
                    {!props.snoozed && (
                        <Button variant="secondary" onClick={props.onNoAnswer}>
                            {m.orders.actions.noAnswer}
                        </Button>
                    )}
                    <Button variant="secondary" onClick={props.onCallLater}>
                        {m.orders.actions.callLater}
                    </Button>
                    {can('EditOrder') && (
                        <Link
                            to={`/orders/${order.id}?edit=1`}
                            className="inline-flex min-h-11 items-center rounded-md px-4 text-slate-700 hover:bg-slate-100"
                        >
                            {m.editOrder.button}
                        </Link>
                    )}
                    {can('CancelOrder') && (
                        <Button variant="ghost" className="text-red-700" onClick={props.onCancel}>
                            {m.orders.actions.cancel}
                        </Button>
                    )}
                </div>
            )}
        </li>
    );
}
