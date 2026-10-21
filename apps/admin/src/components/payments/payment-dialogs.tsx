import {
    PAYMENT_REJECT_REASONS,
    type PaymentRejectReason,
    REFUND_METHODS,
    type RefundMethod,
} from '@ecommbd/shared/payments';
import { useEffect, useState } from 'react';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { Field } from '../form/field';
import { TakaInput } from '../form/inputs';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Select, Textarea } from '../ui/input';

/** Verifies a payment for what the statement shows (the expected amount unless changed). */
export function VerifyPaymentDialog({
    expected,
    open,
    onClose,
    onVerify,
}: {
    expected: number;
    open: boolean;
    onClose(): void;
    onVerify(received: number): Promise<void>;
}) {
    const { messages: m } = useI18n();
    const format = useFormat();
    const v = m.payments.verify;
    const [received, setReceived] = useState<number | null>(expected);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) setReceived(expected);
    }, [open, expected]);
    return (
        <Dialog
            open={open}
            onClose={onClose}
            dismissible={!busy}
            title={v.verifyTitle(format.money(expected))}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        loading={busy}
                        disabled={!received}
                        onClick={async () => {
                            if (!received) return;
                            setBusy(true);
                            await onVerify(received);
                            setBusy(false);
                        }}
                    >
                        {v.verifyButton}
                    </Button>
                </>
            }
        >
            <Field label={v.received} hint={v.receivedHint}>
                {control => <TakaInput {...control} value={received} onChange={setReceived} />}
            </Field>
        </Dialog>
    );
}

/** Rejects a payment: a reason is required, "Other" needs a note. */
export function RejectPaymentDialog({
    open,
    onClose,
    onReject,
}: {
    open: boolean;
    onClose(): void;
    onReject(reason: PaymentRejectReason, note: string): Promise<void>;
}) {
    const { messages: m } = useI18n();
    const v = m.payments.verify;
    const [reason, setReason] = useState<PaymentRejectReason | ''>('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) {
            setReason('');
            setNote('');
        }
    }, [open]);
    return (
        <Dialog
            open={open}
            onClose={onClose}
            dismissible={!busy}
            title={v.rejectTitle}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        variant="danger"
                        loading={busy}
                        disabled={!reason || (reason === 'other' && !note.trim())}
                        onClick={async () => {
                            if (!reason) return;
                            setBusy(true);
                            await onReject(reason, note.trim());
                            setBusy(false);
                        }}
                    >
                        {v.rejectButton}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <Field label={v.reason}>
                    {control => (
                        <Select
                            {...control}
                            value={reason}
                            autoFocus
                            onChange={event => setReason(event.target.value as PaymentRejectReason)}
                        >
                            <option value="" />
                            {PAYMENT_REJECT_REASONS.map(code => (
                                <option key={code} value={code}>
                                    {m.payments.rejectReasons[code]}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
                <Field label={v.note} optional={reason !== 'other'}>
                    {control => (
                        <Textarea
                            {...control}
                            rows={2}
                            maxLength={500}
                            value={note}
                            onChange={e => setNote(e.target.value)}
                        />
                    )}
                </Field>
            </div>
        </Dialog>
    );
}

export interface RefundInput {
    amount: number;
    method: RefundMethod;
    transactionId: string;
    note: string;
}

/** Records money given back for one payment, at most what's left of it. */
export function RefundDialog({
    max,
    open,
    onClose,
    onRefund,
}: {
    max: number;
    open: boolean;
    onClose(): void;
    onRefund(input: RefundInput): Promise<void>;
}) {
    const { messages: m } = useI18n();
    const r = m.payments.refund;
    const [amount, setAmount] = useState<number | null>(max);
    const [method, setMethod] = useState<RefundMethod>('bkash');
    const [transactionId, setTransactionId] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) {
            setAmount(max);
            setTransactionId('');
            setNote('');
        }
    }, [open, max]);
    return (
        <Dialog
            open={open}
            onClose={onClose}
            dismissible={!busy}
            title={r.title}
            description={r.description}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        loading={busy}
                        disabled={!amount || amount > max}
                        onClick={async () => {
                            if (!amount) return;
                            setBusy(true);
                            await onRefund({
                                amount,
                                method,
                                transactionId: transactionId.trim(),
                                note: note.trim(),
                            });
                            setBusy(false);
                        }}
                    >
                        {r.submit}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <Field label={r.amount}>
                    {control => <TakaInput {...control} value={amount} onChange={setAmount} />}
                </Field>
                <Field label={r.method}>
                    {control => (
                        <Select
                            {...control}
                            value={method}
                            onChange={e => setMethod(e.target.value as RefundMethod)}
                        >
                            {REFUND_METHODS.map(code => (
                                <option key={code} value={code}>
                                    {m.payments.refundMethods[code]}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
                <Field label={r.transactionId} optional>
                    {control => (
                        <Input
                            {...control}
                            maxLength={40}
                            value={transactionId}
                            onChange={e => setTransactionId(e.target.value)}
                        />
                    )}
                </Field>
                <Field label={r.note} optional>
                    {control => (
                        <Textarea
                            {...control}
                            rows={2}
                            maxLength={500}
                            value={note}
                            onChange={e => setNote(e.target.value)}
                        />
                    )}
                </Field>
            </div>
        </Dialog>
    );
}
