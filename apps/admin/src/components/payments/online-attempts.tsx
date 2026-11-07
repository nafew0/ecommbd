import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAgo } from '../../lib/orders';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Badge, type BadgeTone, Card, CardBody, CardHeader } from '../ui/misc';

interface Attempt {
    id: string;
    createdAt: string;
    gateway: string;
    mode: string;
    amount: number;
    status: string;
    gatewayTransactionId: string | null;
    payerAccount: string | null;
    failureCode: string | null;
    lastCheckedAt: string | null;
    reviewReason: string | null;
    reviewState: string | null;
}

const FIELDS = `id createdAt gateway mode amount status gatewayTransactionId payerAccount failureCode lastCheckedAt reviewReason reviewState`;
const ATTEMPTS = `query ($orderId: ID!) { bdPaymentAttempts(orderId: $orderId) { ${FIELDS} } }`;
const CHECK = `mutation ($id: ID!) { checkBdPaymentAttempt(id: $id) { ${FIELDS} } }`;
const LOOK_UP = `query ($id: ID!) {
    bdLookupBkashTransaction(attemptId: $id) {
        ... on BdBkashTransaction { status amount payerAccount error }
        ... on BdOnlinePaymentError { message detail }
    }
}`;

type LookUp =
    | { status: string; amount: number | null; payerAccount: string | null; error: string | null }
    | { message: string; detail?: string | null };

const TONES: Record<string, BadgeTone> = {
    created: 'slate',
    started: 'amber',
    paid: 'green',
    failed: 'red',
    cancelled: 'slate',
    expired: 'slate',
};

/**
 * Every try at paying an order online (phase 18): gateway, status, the gateway's transaction ID to
 * look up in its panel, and "Check status now", which asks the gateway (server to server). A bKash
 * payment also has "Look up transaction" (bKash's Search Transaction), for support calls.
 */
export function OnlineAttempts({ orderId, onChanged }: { orderId: string; onChanged(): void }) {
    const { messages: m } = useI18n();
    const o = m.onlinePayments;
    const format = useFormat();
    const ago = useAgo();
    const toast = useToast();
    const { can } = useAuth();
    const [checking, setChecking] = useState<string | null>(null);
    const [lookedUp, setLookedUp] = useState<Record<string, string>>({});
    const query = useQuery({
        queryKey: ['paymentAttempts', orderId],
        queryFn: () =>
            adminApi<{ bdPaymentAttempts: Attempt[] }>(ATTEMPTS, { orderId }).then(r => r.bdPaymentAttempts),
    });
    const attempts = query.data ?? [];
    if (attempts.length === 0) return null;

    const check = async (id: string) => {
        setChecking(id);
        try {
            await adminApi(CHECK, { id });
            toast.success(o.attempts.checked);
            await query.refetch();
            onChanged();
        } catch {
            toast.error(m.errors.generic);
        } finally {
            setChecking(null);
        }
    };

    const lookUp = async (id: string) => {
        setChecking(`${id}:lookUp`);
        try {
            const { bdLookupBkashTransaction: found } = await adminApi<{ bdLookupBkashTransaction: LookUp }>(
                LOOK_UP,
                { id },
            );
            const text =
                'message' in found
                    ? found.detail
                        ? `${found.message} (${found.detail})`
                        : found.message
                    : found.error
                      ? o.attempts.lookUpFailed(found.error)
                      : o.attempts.lookedUp(
                            found.status,
                            found.amount === null ? '—' : format.money(found.amount),
                        );
            setLookedUp(current => ({ ...current, [id]: text }));
        } catch {
            toast.error(m.errors.generic);
        } finally {
            setChecking(null);
        }
    };

    return (
        <Card>
            <CardHeader title={o.attempts.title} />
            <CardBody>
                <ul className="divide-y divide-slate-100">
                    {attempts.map(attempt => (
                        <li key={attempt.id} className="space-y-1 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">
                                    {o.gateways[attempt.gateway] ?? attempt.gateway}
                                    {attempt.mode === 'sandbox' && (
                                        <span className="ml-2 text-sm font-normal text-slate-500">
                                            ({o.modes.sandbox})
                                        </span>
                                    )}
                                </span>
                                <span className="tabular-nums">{format.money(attempt.amount)}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                <Badge tone={TONES[attempt.status] ?? 'slate'}>
                                    {o.attempts.statuses[attempt.status] ?? attempt.status}
                                </Badge>
                                {attempt.reviewState && (
                                    <Badge tone={attempt.reviewState === 'open' ? 'red' : 'slate'}>
                                        {o.reviews.reasons[attempt.reviewReason ?? ''] ??
                                            attempt.reviewReason}{' '}
                                        · {o.reviews.states[attempt.reviewState] ?? attempt.reviewState}
                                    </Badge>
                                )}
                                {attempt.gatewayTransactionId && (
                                    <span className="font-mono">{attempt.gatewayTransactionId}</span>
                                )}
                                {attempt.payerAccount && (
                                    <span className="text-slate-600">
                                        {o.attempts.payer(attempt.payerAccount)}
                                    </span>
                                )}
                                {attempt.failureCode && (
                                    <span className="text-slate-600">
                                        {o.attempts.failure(attempt.failureCode)}
                                    </span>
                                )}
                                {attempt.lastCheckedAt && (
                                    <span className="text-slate-500">
                                        {o.attempts.lastChecked(ago(attempt.lastCheckedAt))}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(attempt.status === 'started' || attempt.status === 'failed') &&
                                    can('UpdateOrder') && (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            loading={checking === attempt.id}
                                            onClick={() => void check(attempt.id)}
                                        >
                                            {o.attempts.checkNow}
                                        </Button>
                                    )}
                                {attempt.gateway === 'bkash' && attempt.gatewayTransactionId && (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        loading={checking === `${attempt.id}:lookUp`}
                                        onClick={() => void lookUp(attempt.id)}
                                    >
                                        {o.attempts.lookUp}
                                    </Button>
                                )}
                                {attempt.reviewState === 'open' && (
                                    <Link
                                        to="/orders/payment-reviews"
                                        className="text-sm text-teal-800 underline"
                                    >
                                        {o.attempts.inReview}
                                    </Link>
                                )}
                            </div>
                            {lookedUp[attempt.id] && (
                                <p className="text-sm text-slate-700" role="status">
                                    {lookedUp[attempt.id]}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            </CardBody>
        </Card>
    );
}
