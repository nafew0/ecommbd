import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Badge, type BadgeTone, Card, CardBody, CardHeader } from '../ui/misc';
import { RefundDialog, type RefundInput } from './payment-dialogs';

/** The payment fields the order page asks for. */
export const ORDER_PAYMENT_FIELDS = `
    payments {
        id method amount state metadata
        refunds { total state method transactionId }
    }
`;

export interface OrderPayment {
    id: string;
    method: string;
    amount: number;
    state: string;
    metadata: { verification?: string; transactionId?: string; senderNumber?: string } | null;
    refunds: Array<{ total: number; state: string; method: string; transactionId: string | null }>;
}

const REFUND = `
    mutation ($input: BdRecordRefundInput!) {
        recordBdRefund(input: $input) {
            ... on Refund { id }
            ... on BdPaymentError { reason message }
        }
    }
`;

const TONES: Record<string, BadgeTone> = {
    pending: 'amber',
    Authorized: 'sky',
    Settled: 'green',
    Declined: 'red',
    Cancelled: 'slate',
};

/** Payments on one order (phase 08): what came in, what's waiting, refunds and "Record refund". */
export function OrderPayments({ payments, onChanged }: { payments: OrderPayment[]; onChanged(): void }) {
    const { messages: m } = useI18n();
    const p = m.payments;
    const format = useFormat();
    const { can } = useAuth();
    const toast = useToast();
    const [refunding, setRefunding] = useState<{ id: string; max: number } | null>(null);
    const shown = payments.filter(payment => payment.state !== 'Error' && payment.state !== 'Created');

    return (
        <Card>
            <CardHeader title={p.order.title} />
            <CardBody>
                {shown.length === 0 ? (
                    <p className="text-sm text-slate-600">{p.order.none}</p>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {shown.map(payment => {
                            const pending =
                                payment.metadata?.verification === 'pending' &&
                                payment.state === 'Authorized';
                            const state = pending ? 'pending' : payment.state;
                            const refunded = payment.refunds
                                .filter(refund => refund.state === 'Settled')
                                .reduce((sum, refund) => sum + refund.total, 0);
                            const left = payment.amount - refunded;
                            return (
                                <li key={payment.id} className="space-y-1 py-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-medium">
                                            {p.methods[payment.method] ?? payment.method}
                                        </span>
                                        <span className="tabular-nums">{format.money(payment.amount)}</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <Badge tone={TONES[state] ?? 'slate'}>
                                            {p.states[state] ?? state}
                                        </Badge>
                                        {payment.metadata?.transactionId && (
                                            <span className="font-mono">
                                                {payment.metadata.transactionId}
                                            </span>
                                        )}
                                        {refunded > 0 && (
                                            <span className="text-slate-600">
                                                {p.order.refunded(format.money(refunded))}
                                            </span>
                                        )}
                                    </div>
                                    {pending && can('VerifyPayment') && (
                                        <Link
                                            to="/orders/payments"
                                            className="text-sm text-teal-800 underline"
                                        >
                                            {p.order.checkInQueue}
                                        </Link>
                                    )}
                                    {payment.state === 'Settled' && left > 0 && can('VerifyPayment') && (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setRefunding({ id: payment.id, max: left })}
                                        >
                                            {p.order.refundButton}
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardBody>
            <RefundDialog
                max={refunding?.max ?? 0}
                open={!!refunding}
                onClose={() => setRefunding(null)}
                onRefund={async (input: RefundInput) => {
                    if (!refunding) return;
                    try {
                        const { recordBdRefund } = await adminApi<{
                            recordBdRefund: { id: string } | { reason: string; message: string };
                        }>(REFUND, {
                            input: {
                                paymentId: refunding.id,
                                amount: input.amount,
                                method: input.method,
                                transactionId: input.transactionId || null,
                                note: input.note || null,
                            },
                        });
                        if ('reason' in recordBdRefund) {
                            toast.error(recordBdRefund.message);
                            return;
                        }
                        toast.success(p.refund.saved);
                        setRefunding(null);
                        onChanged();
                    } catch {
                        toast.error(m.errors.generic);
                    }
                }}
            />
        </Card>
    );
}
