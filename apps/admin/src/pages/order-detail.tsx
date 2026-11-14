import {
    bdActionsFor,
    bdStatusOf,
    type BdCancelReason,
    isBdCancelReason,
} from '@ecommbd/shared/order-status';
import { EDITABLE_STATUSES } from '@ecommbd/shared/manual-orders';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Phone, Printer } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { EditOrderDialog } from '../components/orders/edit-order-dialog';
import { PlaceName } from '../components/address/place-name';
import { CallLaterDialog, CancelDialog, StockDialog } from '../components/orders/order-dialogs';
import { OrderSms } from '../components/orders/order-sms';
import { RiskBadge } from '../components/orders/risk-badge';
import { PaymentBadge, StatusBadge } from '../components/orders/status';
import { OrderCourier } from '../components/couriers/order-courier';
import { OnlineAttempts } from '../components/payments/online-attempts';
import {
    ORDER_PAYMENT_FIELDS,
    type OrderPayment,
    OrderPayments,
} from '../components/payments/order-payments';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/input';
import type { ActionItem } from '../components/ui/action-menu';
import { Page, TwoColumn } from '../components/ui/layout';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { CopyButton } from '../components/ui/stat';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
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
            ${ORDER_PAYMENT_FIELDS}
            surcharges { sku priceWithTax }
            bdAttribution {
                salesPage { id title slug }
                source medium campaign content term fbclid gclid ttclid referrer at
            }
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

/** Where the order came from (phase 16): plain text from links anyone can make, shown escaped. */
interface Attribution {
    salesPage: { id: string; title: string; slug: string } | null;
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
    fbclid: string | null;
    gclid: string | null;
    ttclid: string | null;
    referrer: string | null;
    at: string | null;
}

interface OrderData {
    order:
        | (OrderRow & {
              history: { items: HistoryItem[] };
              payments: OrderPayment[];
              surcharges: Array<{ sku: string; priceWithTax: number }>;
              bdAttribution: Attribution;
          })
        | null;
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
    const [searchParams, setSearchParams] = useSearchParams();
    const editing = searchParams.get('edit') === '1';
    const setEditing = (open: boolean) => setSearchParams(open ? { edit: '1' } : {}, { replace: true });
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
            <Page width="wide">
                <PageHeader back={{ to: '/orders', label: m.orders.back }} title={m.orders.title} />
                <Alert tone="warning">{m.orders.notFound}</Alert>
            </Page>
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
    // One main button (the next step) and up to two beside it; everything else is under "More".
    const allowed = buttons.filter(action => can(ACTION_PERMISSIONS[action]));
    const menu: ActionItem[] = [
        ...(can('EditOrder') && (EDITABLE_STATUSES as readonly string[]).includes(order.bd.status ?? '')
            ? [{ label: m.editOrder.button, onSelect: () => setEditing(true) }]
            : []),
        ...(can('PrintOrders')
            ? (['invoice', 'sticker'] as const).map(document => ({
                  label: m.print.documents[document],
                  icon: <Printer className="size-4" aria-hidden />,
                  onSelect: () => openPrint(document, [order.id]),
              }))
            : []),
        ...(actions.includes('cancel') && can(ACTION_PERMISSIONS.cancel)
            ? [
                  {
                      label: m.orders.actions.cancel,
                      tone: 'danger' as const,
                      onSelect: () => {
                          setCancelReason(order.bd.possibleDuplicateOf ? 'duplicate' : undefined);
                          setDialog('cancel');
                      },
                  },
              ]
            : []),
    ];
    const address = order.shippingAddress;
    const fields = address?.customFields;
    const phone = address?.phoneNumber ?? order.customer?.customFields.phone;
    const claim = order.bd.claim;

    return (
        <Page width="wide">
            <PageHeader
                back={{ to: '/orders', label: m.orders.back }}
                title={m.orders.number(number)}
                description={format.dateTime(order.orderPlacedAt)}
                badges={
                    <>
                        <StatusBadge status={order.bd.status} />
                        <PaymentBadge type={order.bd.paymentType} />
                    </>
                }
                menu={menu}
                actions={[
                    <Neighbours key="neighbours" orderId={order.id} />,
                    ...allowed
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
                        ))
                        .reverse(),
                ]}
            />
            <div className="mb-4 flex flex-wrap gap-2 empty:hidden">
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
                <RiskBadge risk={order.bdRisk} otpStatus={order.bdOtpStatus} />
            </div>
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
            <TwoColumn
                main={
                    <>
                        <Card>
                            <CardHeader title={m.orders.items} />
                            <CardBody>
                                <ul className="divide-y divide-line">
                                    {order.lines
                                        .filter(line => line.quantity > 0)
                                        .map(line => (
                                            <li key={line.id} className="flex justify-between gap-3 py-2">
                                                <span className="min-w-0 break-words">
                                                    {line.productVariant.name}{' '}
                                                    <span className="text-ink-muted">
                                                        {m.orders.quantity(line.quantity)}
                                                    </span>
                                                </span>
                                                <span className="tabular-nums">
                                                    {format.money(line.linePriceWithTax)}
                                                </span>
                                            </li>
                                        ))}
                                </ul>
                                <dl className="space-y-1 border-t border-line pt-3 text-sm">
                                    <Row label={m.orders.subtotal}>{format.money(order.subTotalWithTax)}</Row>
                                    <Row label={m.orders.delivery}>{format.money(order.shippingWithTax)}</Row>
                                    {order.surcharges
                                        .filter(surcharge => surcharge.sku === 'BD-COD-FEE')
                                        .map((surcharge, index) => (
                                            <Row key={index} label={m.payments.order.codFee}>
                                                {format.money(surcharge.priceWithTax)}
                                            </Row>
                                        ))}
                                    <Row label={m.orders.total} strong>
                                        {format.money(order.totalWithTax)}
                                    </Row>
                                    {order.bd.paidAmount > 0 && (
                                        <Row label={m.orders.paid}>{format.money(order.bd.paidAmount)}</Row>
                                    )}
                                </dl>
                                {order.bd.status !== 'returned' && order.bd.status !== 'cancelled' && (
                                    <div className="rounded-md bg-warn-soft px-4 py-3">
                                        <p className="text-sm text-warn">{m.orders.codDue}</p>
                                        <p className="text-2xl font-semibold tabular-nums text-warn">
                                            {format.money(order.bd.codDue)}
                                        </p>
                                    </div>
                                )}
                            </CardBody>
                        </Card>
                        <OrderPayments payments={order.payments} onChanged={() => void query.refetch()} />
                        <OnlineAttempts orderId={order.id} onChanged={() => void query.refetch()} />
                        <OrderCourier
                            orderId={order.id}
                            status={order.bd.status}
                            onChanged={() => void query.refetch()}
                        />
                        <Card>
                            <CardHeader title={m.orders.history} />
                            <CardBody>
                                {can('UpdateOrder') && (
                                    <StaffNote orderId={order.id} onAdded={() => void query.refetch()} />
                                )}
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
                                                    {who && <span className="text-ink-muted"> · {who}</span>}
                                                </span>
                                                <span
                                                    className="text-ink-muted"
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
                        <OrderSms orderId={order.id} />
                    </>
                }
                side={
                    <>
                        <Card>
                            <CardHeader title={m.orders.customer} />
                            <CardBody>
                                <p className="font-semibold break-words">{address?.fullName}</p>
                                {phone && (
                                    <div className="flex items-center gap-1">
                                        <a
                                            href={`tel:${phone}`}
                                            className="inline-flex min-h-10 flex-1 items-center gap-2 rounded-md border border-line-strong px-3 text-sm font-semibold tabular-nums hover:bg-surface-muted"
                                        >
                                            <Phone className="size-4 text-ink-muted" aria-hidden />
                                            {format.phone(phone)}
                                        </a>
                                        <CopyButton value={phone} label={m.orders.customer} />
                                    </div>
                                )}
                                {fields?.alternatePhone && (
                                    <p>
                                        {m.orders.alternate}:{' '}
                                        <a
                                            href={`tel:${fields.alternatePhone}`}
                                            className="tabular-nums underline"
                                        >
                                            {format.phone(fields.alternatePhone)}
                                        </a>
                                    </p>
                                )}
                                {order.customer && (
                                    <Link
                                        to={`/customers/${order.customer.id}`}
                                        className="block text-sm text-accent underline"
                                    >
                                        {m.orders.openCustomer}
                                    </Link>
                                )}
                                <div>
                                    <h3 className="flex items-center justify-between text-[13px] text-ink-muted">
                                        {m.orders.address}
                                        {address?.streetLine1 && (
                                            <CopyButton
                                                value={address.streetLine1}
                                                label={m.orders.address}
                                            />
                                        )}
                                    </h3>
                                    <p className="break-words">{address?.streetLine1}</p>
                                    <p className="break-words">
                                        <PlaceName
                                            districtId={fields?.districtId}
                                            thanaId={fields?.thanaId}
                                            area={fields?.area}
                                        />
                                    </p>
                                    {fields?.landmark && <p className="text-ink-muted">{fields.landmark}</p>}
                                </div>
                                {order.customFields.customerNote && (
                                    <div>
                                        <h3 className="text-sm text-ink-muted">{m.orders.note}</h3>
                                        <p className="break-words whitespace-pre-line">
                                            {order.customFields.customerNote}
                                        </p>
                                    </div>
                                )}
                            </CardBody>
                        </Card>
                        <AttributionCard attribution={order.bdAttribution} />
                    </>
                }
            />
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
            <EditOrderDialog
                order={{ id: order.id, status: order.bd.status ?? '', lines: order.lines }}
                open={editing}
                onClose={() => setEditing(false)}
                onSaved={() => {
                    setEditing(false);
                    void query.refetch();
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
        </Page>
    );
}

const NEIGHBOURS = `query ($orderId: ID!) { bdOrderNeighbours(orderId: $orderId) { newerId olderId } }`;

/** Arrows to the order placed just after and just before this one, so staff can work down the list. */
function Neighbours({ orderId }: { orderId: string }) {
    const { messages: m } = useI18n();
    const query = useQuery({
        queryKey: ['orders', 'neighbours', orderId],
        queryFn: () =>
            adminApi<{ bdOrderNeighbours: { newerId: string | null; olderId: string | null } }>(NEIGHBOURS, {
                orderId,
            }).then(result => result.bdOrderNeighbours),
        staleTime: 30_000,
    });
    const arrow = (id: string | null | undefined, label: string, Icon: typeof ChevronUp) =>
        id ? (
            <Link
                to={`/orders/${id}`}
                aria-label={label}
                title={label}
                className="inline-flex size-10 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
                <Icon className="size-4" aria-hidden />
            </Link>
        ) : (
            <span
                aria-hidden
                className="inline-flex size-10 items-center justify-center rounded-md border border-line text-ink-faint"
            >
                <Icon className="size-4" />
            </span>
        );
    return (
        <span className="inline-flex gap-1">
            {arrow(query.data?.newerId, m.orders.neighbours.newer, ChevronUp)}
            {arrow(query.data?.olderId, m.orders.neighbours.older, ChevronDown)}
        </span>
    );
}

const ADD_NOTE = `mutation ($input: AddNoteToOrderInput!) { addNoteToOrder(input: $input) { id } }`;

/** A note only staff see, kept in the order's history (Vendure's private order note). */
function StaffNote({ orderId, onAdded }: { orderId: string; onAdded(): void }) {
    const { messages: m } = useI18n();
    const toast = useToast();
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const c = m.orders.comment;
    return (
        <form
            className="flex flex-wrap items-end gap-2 border-b border-line pb-4"
            onSubmit={async event => {
                event.preventDefault();
                if (!note.trim()) return;
                setBusy(true);
                try {
                    await adminApi(ADD_NOTE, { input: { id: orderId, note: note.trim(), isPublic: false } });
                    setNote('');
                    toast.success(c.added);
                    onAdded();
                } catch {
                    toast.error(m.errors.generic);
                } finally {
                    setBusy(false);
                }
            }}
        >
            <label className="min-w-0 flex-1 basis-64 space-y-1">
                <span className="block text-[13px] text-ink-muted">{c.label}</span>
                <Textarea
                    rows={2}
                    maxLength={1000}
                    value={note}
                    placeholder={c.placeholder}
                    onChange={event => setNote(event.target.value)}
                    className="min-h-11"
                />
            </label>
            <Button type="submit" variant="secondary" loading={busy} disabled={!note.trim()}>
                {c.add}
            </Button>
        </form>
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
            className={strong ? 'flex justify-between font-semibold' : 'flex justify-between text-ink-muted'}
        >
            <dt>{label}</dt>
            <dd className="tabular-nums">{children}</dd>
        </div>
    );
}

/** The sales page and the ad or link an order came from (phase 16); nothing when it came directly. */
function AttributionCard({ attribution }: { attribution: Attribution }) {
    const { messages: m } = useI18n();
    const format = useFormat();
    const a = m.orders.attribution;
    const clickIds = [
        attribution.fbclid && 'Facebook',
        attribution.gclid && 'Google',
        attribution.ttclid && 'TikTok',
    ].filter(Boolean);
    const rows: Array<[string, string | null]> = [
        [a.source, attribution.source],
        [a.medium, attribution.medium],
        [a.campaign, attribution.campaign],
        [a.content, attribution.content],
        [a.term, attribution.term],
        [a.referrer, attribution.referrer],
        [a.clickIds, clickIds.length ? clickIds.join(', ') : null],
    ];
    const shown = rows.filter(([, value]) => value);
    if (!attribution.salesPage && !shown.length) return null;
    return (
        <Card>
            <CardHeader title={a.title} />
            <CardBody>
                {attribution.salesPage && (
                    <p>
                        <span className="text-sm text-ink-muted">{a.salesPage}: </span>
                        <Link
                            to={`/store/design/landing/${attribution.salesPage.id}`}
                            className="font-medium break-words text-accent underline"
                        >
                            {attribution.salesPage.title}
                        </Link>
                    </p>
                )}
                {shown.length > 0 && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                        {shown.map(([label, value]) => (
                            <div key={label} className="contents">
                                <dt className="text-ink-muted">{label}</dt>
                                <dd className="min-w-0 break-words">{value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
                {attribution.at && (
                    <p className="text-xs text-ink-muted">{a.visited(format.dateTime(attribution.at))}</p>
                )}
                {attribution.campaign && (
                    <Link
                        to={`/orders?campaign=${encodeURIComponent(attribution.campaign)}`}
                        className="block text-sm text-accent underline"
                    >
                        {a.sameCampaign}
                    </Link>
                )}
            </CardBody>
        </Card>
    );
}
