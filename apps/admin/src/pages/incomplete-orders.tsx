import { DISMISS_REASONS, type DismissReason, INCOMPLETE_STATUSES, type IncompleteStatus } from '@ecommbd/shared/fraud';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Phone, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PlaceName } from '../components/address/place-name';
import { Field } from '../components/form/field';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Select } from '../components/ui/input';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAgo } from '../lib/orders';
import { useToast } from '../lib/toast';
import { useDebounced } from '../lib/use-debounced';

const PAGE_SIZE = 30;

const LIST = `
    query Incomplete($status: String, $search: String, $skip: Int, $take: Int) {
        bdIncompleteCheckouts(status: $status, search: $search, skip: $skip, take: $take) {
            totalItems
            items {
                id updatedAt status phone name districtId thanaId cartTotal orderId orderNumber smsSentAt
                cart { variantId name quantity unitPrice }
            }
        }
        bdIncompleteCheckoutCounts { open recovered converted dismissed expired }
    }
`;
const SEND_SMS = `mutation Send($id: ID!) { sendBdIncompleteCheckoutSms(id: $id) { id smsSentAt } }`;
const DISMISS = `mutation Dismiss($id: ID!, $reason: String!) { dismissBdIncompleteCheckout(id: $id, reason: $reason) { id } }`;

export interface IncompleteRow {
    id: string;
    updatedAt: string;
    status: IncompleteStatus;
    phone: string | null;
    name: string | null;
    districtId: string | null;
    thanaId: string | null;
    cartTotal: number;
    orderId: string | null;
    orderNumber: string | null;
    smsSentAt: string | null;
    cart: Array<{ variantId: string; name: string; quantity: number; unitPrice: number }> | null;
}

interface ListData {
    bdIncompleteCheckouts: { totalItems: number; items: IncompleteRow[] };
    bdIncompleteCheckoutCounts: Record<IncompleteStatus, number>;
}

/**
 * Incomplete orders (roadmap phase 11): shoppers who typed their phone at checkout and left. Staff
 * call (tap the number), send one reminder SMS, make the order for them, or dismiss with a reason.
 */
export function IncompleteOrdersPage() {
    const { messages: m } = useI18n();
    const t = m.incomplete;
    const format = useFormat();
    const ago = useAgo();
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [status, setStatus] = useState<IncompleteStatus>('open');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [dismissing, setDismissing] = useState<IncompleteRow | null>(null);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['incomplete', status, term, page],
        queryFn: () =>
            adminApi<ListData>(LIST, {
                status,
                search: term || null,
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
            }),
        placeholderData: keepPreviousData,
    });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['incomplete'] });
    const sendSms = useMutation({
        mutationFn: (id: string) => adminApi(SEND_SMS, { id }),
        onSuccess: () => {
            toast.success(t.smsQueued);
            refresh();
        },
        onError: () => toast.error(m.errors.generic),
    });
    const canAct = can('UpdateOrder');
    const n = m.common.number;
    const columns: Column<IncompleteRow>[] = [
        {
            key: 'customer',
            header: t.columns.customer,
            cell: row => (
                <div className="min-w-0">
                    <div className="font-medium">{row.name || t.noName}</div>
                    {row.phone && (
                        <a
                            href={`tel:${row.phone}`}
                            className="inline-flex items-center gap-1 text-teal-800 tabular-nums"
                            aria-label={t.call(format.phone(row.phone))}
                        >
                            <Phone className="size-3.5" aria-hidden />
                            {format.phone(row.phone)}
                        </a>
                    )}
                    {row.districtId && (
                        <div className="text-sm text-slate-600">
                            <PlaceName districtId={row.districtId} thanaId={row.thanaId} />
                        </div>
                    )}
                </div>
            ),
        },
        {
            key: 'cart',
            header: t.columns.cart,
            cell: row =>
                row.cart?.length ? (
                    <div className="text-sm">
                        <div>{row.cart.map(line => `${line.name} × ${n(line.quantity)}`).join(', ')}</div>
                        <div className="font-medium">{format.money(row.cartTotal)}</div>
                    </div>
                ) : (
                    <span className="text-sm text-slate-500">{t.noCart}</span>
                ),
        },
        {
            key: 'when',
            header: t.columns.when,
            cell: row => (
                <span className="text-sm text-slate-600" title={format.dateTime(row.updatedAt)}>
                    {ago(row.updatedAt)}
                </span>
            ),
            hideOnMobile: true,
        },
        {
            key: 'actions',
            header: t.columns.actions,
            cell: row =>
                row.status === 'open' ? (
                    <div className="flex flex-wrap gap-2">
                        {can('CreateManualOrder') && (
                            <Link
                                to={`/orders/phone?incomplete=${row.id}`}
                                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
                            >
                                <ShoppingCart className="size-4" aria-hidden />
                                {t.convert}
                            </Link>
                        )}
                        {canAct && (
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={Boolean(row.smsSentAt)}
                                loading={sendSms.isPending && sendSms.variables === row.id}
                                onClick={() => sendSms.mutate(row.id)}
                            >
                                <MessageSquare className="size-4" aria-hidden />
                                {row.smsSentAt ? t.smsSent : t.sendSms}
                            </Button>
                        )}
                        {canAct && (
                            <Button size="sm" variant="ghost" onClick={() => setDismissing(row)}>
                                {t.dismiss}
                            </Button>
                        )}
                    </div>
                ) : row.orderId && row.orderNumber ? (
                    <Link to={`/orders/${row.orderId}`} className="text-teal-800 underline-offset-2 hover:underline">
                        {t.order(row.orderNumber)}
                    </Link>
                ) : null,
        },
    ];
    const counts = query.data?.bdIncompleteCheckoutCounts;
    return (
        <>
            <PageHeader title={t.title} description={t.description} />
            {status === 'open' && (
                <p className="mb-4 rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-900">{t.callScript}</p>
            )}
            <ListPage
                rows={query.data?.bdIncompleteCheckouts.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isPending}
                tabs={{
                    items: INCOMPLETE_STATUSES.map(key => ({ key, label: t.tabs[key], count: counts?.[key] })),
                    active: status,
                    onChange: key => {
                        setStatus(key as IncompleteStatus);
                        setPage(1);
                    },
                }}
                search={{
                    value: search,
                    onChange: value => {
                        setSearch(value);
                        setPage(1);
                    },
                    placeholder: t.search,
                }}
                pagination={{
                    page,
                    pageSize: PAGE_SIZE,
                    total: query.data?.bdIncompleteCheckouts.totalItems ?? 0,
                    onChange: setPage,
                }}
                empty={<EmptyState icon={<ShoppingCart aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />}
            />
            <p className="mt-3 text-sm text-slate-500">{t.expiresNote}</p>
            <DismissDialog
                row={dismissing}
                onClose={() => setDismissing(null)}
                onDismiss={async reason => {
                    try {
                        await adminApi(DISMISS, { id: dismissing!.id, reason });
                        toast.success(t.dismissed);
                        setDismissing(null);
                        refresh();
                    } catch {
                        toast.error(m.errors.generic);
                    }
                }}
            />
        </>
    );
}

function DismissDialog(props: { row: IncompleteRow | null; onClose(): void; onDismiss(reason: DismissReason): Promise<void> }) {
    const { messages: m } = useI18n();
    const t = m.incomplete;
    const [reason, setReason] = useState<DismissReason>('wrongNumber');
    const [busy, setBusy] = useState(false);
    return (
        <Dialog
            open={Boolean(props.row)}
            onClose={props.onClose}
            dismissible={!busy}
            title={t.dismissTitle}
            footer={
                <>
                    <Button variant="secondary" onClick={props.onClose} disabled={busy}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        loading={busy}
                        onClick={async () => {
                            setBusy(true);
                            await props.onDismiss(reason);
                            setBusy(false);
                        }}
                    >
                        {t.dismiss}
                    </Button>
                </>
            }
        >
            <Field label={t.dismissReason}>
                {control => (
                    <Select {...control} value={reason} onChange={event => setReason(event.target.value as DismissReason)}>
                        {DISMISS_REASONS.map(key => (
                            <option key={key} value={key}>
                                {t.dismissReasons[key]}
                            </option>
                        ))}
                    </Select>
                )}
            </Field>
        </Dialog>
    );
}
