import type { MfsProvider } from '@ecommbd/shared/payments';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { RejectPaymentDialog, VerifyPaymentDialog } from '../components/payments/payment-dialogs';
import { Button } from '../components/ui/button';
import { Badge, Card, CardBody, EmptyState, PageHeader, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAgo } from '../lib/orders';
import { useToast } from '../lib/toast';

const QUEUE = `{
    bdPaymentsToVerify {
        paymentId orderId orderCode orderNumber customerName customerPhone orderTotal
        provider senderNumber transactionId lookalikes purpose amount createdAt overdue
    }
}`;

const RESULT = `... on Payment { id state } ... on BdPaymentError { reason message }`;
const VERIFY = `mutation ($input: BdVerifyPaymentInput!) { verifyBdPayment(input: $input) { ${RESULT} } }`;
const REJECT = `mutation ($input: BdRejectPaymentInput!) { rejectBdPayment(input: $input) { ${RESULT} } }`;

interface Waiting {
    paymentId: string;
    orderId: string;
    orderCode: string;
    orderNumber: string | null;
    customerName: string;
    customerPhone: string;
    orderTotal: number;
    provider: string;
    senderNumber: string;
    transactionId: string;
    lookalikes: string[];
    purpose: 'advance' | 'full';
    amount: number;
    createdAt: string;
    overdue: boolean;
}

type CheckResult = { id: string; state: string } | { reason: string; message: string };

/**
 * Verify payments (roadmap phase 08): bKash, Nagad and Rocket payments waiting for a person to
 * find them in the statement. Oldest first; never verified automatically.
 */
export function VerifyPaymentsPage() {
    const { messages: m } = useI18n();
    const v = m.payments.verify;
    const format = useFormat();
    const ago = useAgo();
    const toast = useToast();
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['paymentsToVerify'],
        queryFn: () => adminApi<{ bdPaymentsToVerify: Waiting[] }>(QUEUE).then(r => r.bdPaymentsToVerify),
        refetchInterval: 30_000,
    });
    const [dialog, setDialog] = useState<{ kind: 'verify' | 'reject'; payment: Waiting } | null>(null);

    const finish = (result: CheckResult, success: string) => {
        if ('reason' in result) {
            toast.error(result.message);
        } else {
            toast.success(success);
        }
        setDialog(null);
        void queryClient.invalidateQueries({ queryKey: ['paymentsToVerify'] });
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
    };

    if (query.isPending) return <PageSkeleton />;
    const items = query.data ?? [];
    return (
        <>
            <PageHeader title={v.title} description={v.description} />
            {items.length === 0 ? (
                <EmptyState icon={<Wallet className="size-6" aria-hidden />} title={v.empty} body="" />
            ) : (
                <ul className="space-y-3">
                    {items.map(payment => (
                        <li key={payment.paymentId}>
                            <Card>
                                <CardBody className="space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <Link
                                            to={`/orders/${payment.orderId}`}
                                            className="font-semibold text-teal-800 underline-offset-2 hover:underline"
                                        >
                                            {v.order(payment.orderNumber ?? payment.orderCode)}
                                        </Link>
                                        <div className="flex flex-wrap gap-2">
                                            <Badge tone="violet">
                                                {m.payments.providers[payment.provider as MfsProvider] ??
                                                    payment.provider}
                                            </Badge>
                                            <Badge tone="slate">
                                                {payment.purpose === 'advance' ? v.advance : v.full}
                                            </Badge>
                                            {payment.overdue ? (
                                                <Badge tone="red">{v.overdue}</Badge>
                                            ) : (
                                                <Badge tone="amber">
                                                    {v.waiting(ago(payment.createdAt))}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600">
                                        {payment.customerName} ·{' '}
                                        <a className="underline" href={`tel:${payment.customerPhone}`}>
                                            {format.phone(payment.customerPhone)}
                                        </a>
                                    </p>
                                    <dl className="grid gap-3 sm:grid-cols-3">
                                        <div>
                                            <dt className="text-sm text-slate-600">{v.transactionId}</dt>
                                            <dd className="font-mono text-lg font-semibold tracking-wider break-all">
                                                {payment.transactionId}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-sm text-slate-600">{v.sender}</dt>
                                            <dd className="font-medium">
                                                {format.phone(payment.senderNumber)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-sm text-slate-600">{v.expected}</dt>
                                            <dd className="text-lg font-semibold tabular-nums">
                                                {format.money(payment.amount)}
                                            </dd>
                                        </div>
                                    </dl>
                                    {payment.lookalikes.length > 0 && (
                                        <p className="text-sm text-amber-800">
                                            {v.lookalikes(payment.lookalikes.join(' '))}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        <Button onClick={() => setDialog({ kind: 'verify', payment })}>
                                            {v.verifyButton}
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={() => setDialog({ kind: 'reject', payment })}
                                        >
                                            {v.rejectButton}
                                        </Button>
                                    </div>
                                </CardBody>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}
            <VerifyPaymentDialog
                expected={dialog?.payment.amount ?? 0}
                open={dialog?.kind === 'verify'}
                onClose={() => setDialog(null)}
                onVerify={async received => {
                    if (!dialog) return;
                    const result = await adminApi<{ verifyBdPayment: CheckResult }>(VERIFY, {
                        input: { paymentId: dialog.payment.paymentId, receivedAmount: received },
                    }).catch(() => ({ verifyBdPayment: { reason: 'NETWORK', message: m.errors.generic } }));
                    finish(result.verifyBdPayment, v.verified);
                }}
            />
            <RejectPaymentDialog
                open={dialog?.kind === 'reject'}
                onClose={() => setDialog(null)}
                onReject={async (reason, note) => {
                    if (!dialog) return;
                    const result = await adminApi<{ rejectBdPayment: CheckResult }>(REJECT, {
                        input: { paymentId: dialog.payment.paymentId, reason, note: note || null },
                    }).catch(() => ({ rejectBdPayment: { reason: 'NETWORK', message: m.errors.generic } }));
                    finish(result.rejectBdPayment, v.rejected);
                }}
            />
        </>
    );
}
