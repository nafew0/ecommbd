import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/input';
import { Badge, Card, CardBody, EmptyState, PageHeader, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAgo } from '../lib/orders';
import { useToast } from '../lib/toast';

export const REVIEW_FIELDS = `
    id orderId orderCode orderNumber gateway mode amount paidAmount paidAt status
    gatewayTransactionId reviewReason reviewState reviewNote reviewedBy
`;

const REVIEWS = `{ bdPaymentReviews { ${REVIEW_FIELDS} } }`;

const DECIDE = `mutation ($id: ID!, $action: String!, $note: String) {
    reviewBdPayment(id: $id, action: $action, note: $note) {
        ... on BdPaymentAttempt { id reviewState }
        ... on BdOnlinePaymentError { reason message detail }
    }
}`;

export interface ReviewItem {
    id: string;
    orderId: string;
    orderCode: string | null;
    orderNumber: string | null;
    gateway: string;
    mode: string;
    amount: number;
    paidAmount: number | null;
    paidAt: string | null;
    gatewayTransactionId: string | null;
    reviewReason: string;
    reviewState: string;
}

type Decision =
    { id: string; reviewState: string } | { reason: string; message: string; detail?: string | null };

/**
 * Payment reviews (roadmap phase 18): online money that couldn't go to its order by itself (paid
 * late, paid twice, flagged risky, wrong amount). Each needs a person; nothing is refunded
 * automatically. Deciding needs ManagePayments (checked on the server too).
 */
export function PaymentReviewsPage() {
    const { messages: m } = useI18n();
    const r = m.onlinePayments.reviews;
    const format = useFormat();
    const ago = useAgo();
    const toast = useToast();
    const confirm = useConfirm();
    const { can } = useAuth();
    const canDecide = can('ManagePayments');
    const queryClient = useQueryClient();
    const [resolving, setResolving] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const query = useQuery({
        queryKey: ['paymentReviews'],
        queryFn: () =>
            adminApi<{ bdPaymentReviews: ReviewItem[] }>(REVIEWS).then(result => result.bdPaymentReviews),
        refetchInterval: 60_000,
    });

    const decide = async (item: ReviewItem, action: 'accept' | 'refund' | 'resolve', text?: string) => {
        setBusy(`${item.id}:${action}`);
        const result = await adminApi<{ reviewBdPayment: Decision }>(DECIDE, {
            id: item.id,
            action,
            note: text ?? null,
        }).catch(() => ({ reviewBdPayment: { reason: 'NETWORK', message: m.errors.generic } as Decision }));
        setBusy(null);
        const decision = result.reviewBdPayment;
        if ('reason' in decision) {
            toast.error(decision.detail ? `${decision.message} (${decision.detail})` : decision.message);
            return;
        }
        toast.success(r.done);
        setResolving(null);
        setNote('');
        void queryClient.invalidateQueries({ queryKey: ['paymentReviews'] });
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
    };

    if (query.isPending) return <PageSkeleton />;
    const items = query.data ?? [];
    return (
        <>
            <PageHeader title={r.title} description={r.description} />
            {items.length === 0 ? (
                <EmptyState icon={<ShieldCheck className="size-6" aria-hidden />} title={r.empty} body="" />
            ) : (
                <ul className="space-y-3">
                    {items.map(item => {
                        const amount = format.money(item.paidAmount ?? item.amount);
                        return (
                            <li key={item.id}>
                                <Card>
                                    <CardBody className="space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <Link
                                                to={`/orders/${item.orderId}`}
                                                className="font-semibold text-teal-800 underline-offset-2 hover:underline"
                                            >
                                                {r.order(item.orderNumber ?? item.orderCode ?? item.orderId)}
                                            </Link>
                                            <div className="flex flex-wrap gap-2">
                                                <Badge tone="violet">
                                                    {m.onlinePayments.gateways[item.gateway] ?? item.gateway}
                                                </Badge>
                                                <Badge tone={item.reviewReason === 'risky' ? 'amber' : 'red'}>
                                                    {r.reasons[item.reviewReason] ?? item.reviewReason}
                                                </Badge>
                                            </div>
                                        </div>
                                        <p className="text-sm text-slate-700">
                                            {r.reasonHints[item.reviewReason]}
                                        </p>
                                        <dl className="grid gap-3 sm:grid-cols-3">
                                            <div>
                                                <dt className="text-sm text-slate-600">{r.paid}</dt>
                                                <dd className="text-lg font-semibold tabular-nums">
                                                    {amount}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt className="text-sm text-slate-600">{r.transaction}</dt>
                                                <dd className="font-mono break-all">
                                                    {item.gatewayTransactionId ?? '—'}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt className="text-sm text-slate-600">
                                                    {m.onlinePayments.mode}
                                                </dt>
                                                <dd>
                                                    {m.onlinePayments.modes[item.mode] ?? item.mode}
                                                    {item.paidAt ? ` · ${ago(item.paidAt)}` : ''}
                                                </dd>
                                            </div>
                                        </dl>
                                        {canDecide && resolving === item.id && (
                                            <Field label={r.resolveNote}>
                                                {control => (
                                                    <Textarea
                                                        {...control}
                                                        rows={2}
                                                        maxLength={500}
                                                        value={note}
                                                        onChange={event => setNote(event.target.value)}
                                                    />
                                                )}
                                            </Field>
                                        )}
                                        {canDecide && (
                                            <div className="flex flex-wrap gap-2">
                                                {item.reviewReason === 'risky' && (
                                                    <Button
                                                        loading={busy === `${item.id}:accept`}
                                                        onClick={() => void decide(item, 'accept')}
                                                    >
                                                        {r.accept}
                                                    </Button>
                                                )}
                                                <Button
                                                    variant={
                                                        item.reviewReason === 'risky'
                                                            ? 'secondary'
                                                            : 'primary'
                                                    }
                                                    loading={busy === `${item.id}:refund`}
                                                    onClick={async () => {
                                                        if (
                                                            await confirm({
                                                                title: r.confirmRefund(amount),
                                                                danger: true,
                                                            })
                                                        ) {
                                                            void decide(item, 'refund');
                                                        }
                                                    }}
                                                >
                                                    {r.refund}
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    loading={busy === `${item.id}:resolve`}
                                                    onClick={() =>
                                                        resolving === item.id
                                                            ? void decide(item, 'resolve', note)
                                                            : setResolving(item.id)
                                                    }
                                                >
                                                    {r.resolve}
                                                </Button>
                                            </div>
                                        )}
                                    </CardBody>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}
