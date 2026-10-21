import {
    bdActionsFor,
    bdStatusOf,
    type BdCancelReason,
    isBdCancelReason,
} from '@ecommbd/shared/order-status';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Phone, Printer } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PlaceName } from '../components/address/place-name';
import { CallLaterDialog, CancelDialog, StockDialog } from '../components/orders/order-dialogs';
import { PaymentBadge, StatusBadge } from '../components/orders/status';
import { Button } from '../components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { openPrint } from '../lib/print';
import {
    ACTION_PERMISSIONS,
    type ActionName,
    claimOrder,
    ORDER_FIELDS,
    type OrderRow,
    releaseOrder,
    useAgo,
    useOrderActions,
} from '../lib/orders';

const ORDER = `
    query Order($id: ID!) {
        order(id: $id) {
            ...BdOrderRow
            history(options: { sort: { createdAt: DESC }, take: 100 }) {
                items { id type createdAt data administrator { firstName lastName } }
            }
        }
        bdOrderSettings
    }
    ${ORDER_FIELDS}
`;

interface HistoryItem {
    id: string;
    type: string;
    createdAt: string;
    data: Record<string, string | undefined>;
    administrator: { firstName: string; lastName: string } | null;
}

interface OrderData {
    order: (OrderRow & { history: { items: HistoryItem[] } }) | null;
    bdOrderSettings: { skipConfirmationForPrepaid: boolean };
}

/** One order (roadmap phase 04): what was ordered, who, where, money, history and the next actions. */
export function OrderDetailPage() {
    const { id = '' } = useParams();
    const { messages: m } = useI18n();
    const format = useFormat();
    const ago = useAgo();
    const { can } = useAuth();
    const act = useOrderActions();
    const confirm = useConfirm();
    const query = useQuery({
        queryKey: ['orders', 'detail', id],
        queryFn: () => adminApi<OrderData>(ORDER, { id }),
        refetchInterval: 30_000,
    });
    const order = query.data?.order;
    const [dialog, setDialog] = useState<'cancel' | 'callLater' | null>(null);
    const [cancelReason, setCancelReason] = useState<BdCancelReason | undefined>();
    const [stockShort, setStockShort] = useState<string[] | null>(null);
    const [busy, setBusy] = useState<ActionName | null>(null);
    const isNew = order?.bd.status === 'new';

    // Looking at a New order claims it, so others see "… is calling".
    useEffect(() => {
        if (!isNew || !can('ConfirmOrder')) return;
        void claimOrder(id).then(() => query.refetch());
        return () => void releaseOrder(id);
    }, [id, isNew]);

    if (query.isPending) return <PageSkeleton />;
    if (!order) {
        return (
            <>
                <BackLink />
                <Alert tone="warning">{m.orders.notFound}</Alert>
            </>
        );
    }

    const number = order.customFields.orderNumber ?? order.code;
    const run = async (action: ActionName, extra: Record<string, unknown> = {}) => {
        if (
            action === 'return' &&
            !(await confirm({
                title: m.orders.returnDialogTitle,
                body: m.orders.returnStatusOnly,
                confirmLabel: m.orders.actions.return,
            }))
        )
            return;
        setBusy(action);
        const error = await act(action, { orderId: order.id, expectedStatus: order.bd.status, ...extra });
        setBusy(null);
        if (error?.reason === 'INSUFFICIENT_STOCK') {
            setStockShort(error.details);
        }
        return error;
    };
    const actions = bdActionsFor(order.bd.status, {
        prepaid: order.bd.paymentType === 'prepaid',
        skipConfirmationForPrepaid: query.data?.bdOrderSettings.skipConfirmationForPrepaid ?? false,
    });
    const buttons: ActionName[] = [
        ...actions.filter(action => action !== 'cancel'),
        ...(isNew ? (['noAnswer', 'callLater'] as const) : []),
    ];
    const address = order.shippingAddress;
    const fields = address?.customFields;
    const phone = address?.phoneNumber ?? order.customer?.customFields.phone;
    const claim = order.bd.claim;

    return (
        <>
            <BackLink />
            <PageHeader
                title={m.orders.number(number)}
                description={format.dateTime(order.orderPlacedAt)}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={order.bd.status} />
                        <PaymentBadge type={order.bd.paymentType} />
                        {can('PrintOrders') &&
                            (['invoice', 'sticker'] as const).map(document => (
                                <Button
                                    key={document}
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => openPrint(document, [order.id])}
                                >
                                    <Printer className="size-4" aria-hidden />
                                    {m.print.documents[document]}
                                </Button>
                            ))}
                    </div>
                }
            />
            <div className="mb-4 flex flex-wrap gap-2">
                {claim && (
                    <Badge tone="sky">
                        {claim.mine ? m.orders.claim.mine : m.orders.claim.other(claim.name ?? '')}
                    </Badge>
                )}
                {order.bd.possibleDuplicateOf && (
                    <Badge tone="orange">{m.orders.badges.duplicate(order.bd.possibleDuplicateOf)}</Badge>
                )}
                {order.bd.suggestCancel && <Badge tone="red">{m.orders.badges.suggestCancel}</Badge>}
                {order.bd.callAttempts > 0 && <Badge>{m.orders.badges.calls(order.bd.callAttempts)}</Badge>}
                {order.bd.imported && <Badge>{m.orders.badges.imported}</Badge>}
            </div>
            {(buttons.length > 0 || actions.includes('cancel')) && (
                <div className="mb-4 flex flex-wrap gap-2">
                    {buttons
                        .filter(action => can(ACTION_PERMISSIONS[action]))
                        .map((action, index) => (
                            <Button
                                key={action}
                                variant={index === 0 ? 'primary' : 'secondary'}
                                loading={busy === action}
                                onClick={() =>
                                    action === 'callLater' ? setDialog('callLater') : void run(action)
                                }
                            >
                                {m.orders.actions[action]}
                            </Button>
                        ))}
                    {actions.includes('cancel') && can(ACTION_PERMISSIONS.cancel) && (
                        <Button
                            variant="ghost"
                            className="text-red-700"
                            onClick={() => {
                                setCancelReason(order.bd.possibleDuplicateOf ? 'duplicate' : undefined);
                                setDialog('cancel');
                            }}
                        >
                            {m.orders.actions.cancel}
                        </Button>
                    )}
                </div>
            )}
            {order.bd.status === 'cancelled' && order.bd.cancelReason && (
                <div className="mb-4">
                    <Alert tone="warning">
                        {m.orders.cancelled(
                            isBdCancelReason(order.bd.cancelReason)
                                ? m.orders.cancelReasons[order.bd.cancelReason]
                                : order.bd.cancelReason,
                        )}
                        {order.bd.cancelNote && ` — ${order.bd.cancelNote}`}
                    </Alert>
                </div>
            )}
            {order.bd.status === 'returned' && (
                <div className="mb-4">
                    <Alert tone="warning">{m.orders.returnStatusOnly}</Alert>
                </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader title={m.orders.items} />
                    <CardBody>
                        <ul className="divide-y divide-slate-100">
                            {order.lines
                                .filter(line => line.quantity > 0)
                                .map(line => (
                                    <li key={line.id} className="flex justify-between gap-3 py-2">
                                        <span className="min-w-0 break-words">
                                            {line.productVariant.name}{' '}
                                            <span className="text-slate-600">
                                                {m.orders.quantity(line.quantity)}
                                            </span>
                                        </span>
                                        <span className="tabular-nums">
                                            {format.money(line.linePriceWithTax)}
                                        </span>
                                    </li>
                                ))}
                        </ul>
                        <dl className="space-y-1 border-t border-slate-100 pt-3 text-sm">
                            <Row label={m.orders.subtotal}>{format.money(order.subTotalWithTax)}</Row>
                            <Row label={m.orders.delivery}>{format.money(order.shippingWithTax)}</Row>
                            <Row label={m.orders.total} strong>
                                {format.money(order.totalWithTax)}
                            </Row>
                            {order.bd.paidAmount > 0 && (
                                <Row label={m.orders.paid}>{format.money(order.bd.paidAmount)}</Row>
                            )}
                        </dl>
                        {order.bd.status !== 'returned' && order.bd.status !== 'cancelled' && (
                            <div className="rounded-md bg-amber-50 px-4 py-3">
                                <p className="text-sm text-amber-900">{m.orders.codDue}</p>
                                <p className="text-2xl font-semibold tabular-nums text-amber-950">
                                    {format.money(order.bd.codDue)}
                                </p>
                            </div>
                        )}
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={m.orders.customer} />
                    <CardBody>
                        <p className="text-lg font-semibold break-words">{address?.fullName}</p>
                        {phone && (
                            <a
                                href={`tel:${phone}`}
                                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 font-medium text-white hover:bg-teal-800"
                            >
                                <Phone className="size-4" aria-hidden />
                                {format.phone(phone)}
                            </a>
                        )}
                        {fields?.alternatePhone && (
                            <p>
                                {m.orders.alternate}:{' '}
                                <a href={`tel:${fields.alternatePhone}`} className="tabular-nums underline">
                                    {format.phone(fields.alternatePhone)}
                                </a>
                            </p>
                        )}
                        {order.customer && (
                            <Link
                                to={`/customers/${order.customer.id}`}
                                className="block text-sm text-teal-800 underline"
                            >
                                {m.orders.openCustomer}
                            </Link>
                        )}
                        <div>
                            <h3 className="text-sm text-slate-600">{m.orders.address}</h3>
                            <p className="break-words">{address?.streetLine1}</p>
                            <p className="break-words">
                                <PlaceName
                                    districtId={fields?.districtId}
                                    thanaId={fields?.thanaId}
                                    area={fields?.area}
                                />
                            </p>
                            {fields?.landmark && <p className="text-slate-600">{fields.landmark}</p>}
                        </div>
                        {order.customFields.customerNote && (
                            <div>
                                <h3 className="text-sm text-slate-600">{m.orders.note}</h3>
                                <p className="break-words whitespace-pre-line">
                                    {order.customFields.customerNote}
                                </p>
                            </div>
                        )}
                    </CardBody>
                </Card>
                <Card className="lg:col-span-2">
                    <CardHeader title={m.orders.history} />
                    <CardBody>
                        <ol className="space-y-2">
                            {order.history.items.map(entry => {
                                const text = historyText(entry, m, format.dateTime);
                                if (!text) return null;
                                const who = entry.administrator
                                    ? m.orders.historyBy(
                                          `${entry.administrator.firstName} ${entry.administrator.lastName}`.trim(),
                                      )
                                    : null;
                                return (
                                    <li
                                        key={entry.id}
                                        className="flex flex-wrap justify-between gap-x-4 text-sm"
                                    >
                                        <span>
                                            {text}
                                            {who && <span className="text-slate-600"> · {who}</span>}
                                        </span>
                                        <span
                                            className="text-slate-500"
                                            title={format.dateTime(entry.createdAt)}
                                        >
                                            {ago(entry.createdAt)}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    </CardBody>
                </Card>
            </div>
            <CancelDialog
                orderNumber={number}
                open={dialog === 'cancel'}
                defaultReason={cancelReason}
                onClose={() => setDialog(null)}
                onCancel={async (reason, note) => {
                    const error = await run('cancel', { reason, note });
                    if (!error) setDialog(null);
                }}
            />
            <CallLaterDialog
                open={dialog === 'callLater'}
                onClose={() => setDialog(null)}
                onSave={async callBackAt => {
                    const error = await act('callLater', {
                        orderId: order.id,
                        outcome: 'callLater',
                        callBackAt,
                    });
                    if (!error) setDialog(null);
                }}
            />
            <StockDialog
                items={stockShort}
                onClose={() => setStockShort(null)}
                onConfirmAnyway={() => {
                    setStockShort(null);
                    void run('confirm', { ignoreStockWarning: true });
                }}
                onCancelOrder={() => {
                    setStockShort(null);
                    setCancelReason('outOfStock');
                    setDialog('cancel');
                }}
            />
        </>
    );
}

/** One history line in the merchant's words; null for Vendure's internal entries. */
function historyText(
    entry: HistoryItem,
    m: ReturnType<typeof useI18n>['messages'],
    dateTime: (iso: string) => string,
): string | null {
    const data = entry.data;
    switch (entry.type) {
        case 'ORDER_STATE_TRANSITION': {
            if (data.from === 'ArrangingPayment' && bdStatusOf(data.to ?? '') === 'new')
                return m.orders.historyEvents.placed;
            const status = bdStatusOf(data.to ?? '');
            const previous = bdStatusOf(data.from ?? '');
            return status && status !== previous
                ? m.orders.historyEvents.status(m.orders.statuses[status])
                : null;
        }
        case 'BD_CALL_ATTEMPT':
            return data.outcome === 'callLater' && data.callBackAt
                ? m.orders.historyEvents.callLater(dateTime(data.callBackAt))
                : m.orders.historyEvents.noAnswer;
        case 'ORDER_CANCELLATION':
            return m.orders.historyEvents.cancelled(
                isBdCancelReason(data.reason) ? m.orders.cancelReasons[data.reason] : (data.reason ?? ''),
            );
        case 'ORDER_NOTE':
            return data.note ? m.orders.historyEvents.note(data.note) : null;
        default:
            return null;
    }
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
    return (
        <div
            className={strong ? 'flex justify-between font-semibold' : 'flex justify-between text-slate-700'}
        >
            <dt>{label}</dt>
            <dd className="tabular-nums">{children}</dd>
        </div>
    );
}

function BackLink() {
    const { messages: m } = useI18n();
    return (
        <Link
            to="/orders"
            className="mb-3 inline-flex items-center gap-1 text-sm text-teal-800 hover:underline"
        >
            <ArrowLeft className="size-4" aria-hidden />
            {m.orders.back}
        </Link>
    );
}
