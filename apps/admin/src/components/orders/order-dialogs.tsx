import { BD_CANCEL_REASONS, type BdCancelReason } from '@ecommbd/shared/order-status';
import { fromDhaka, dhakaParts } from '@ecommbd/shared/time';
import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { Field } from '../form/field';
import { DhakaDateTimeInput } from '../form/inputs';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Select, Textarea } from '../ui/input';

/** Asks why an order is cancelled (a reason is required; "Other" needs a note). */
export function CancelDialog({
    orderNumber,
    open,
    onClose,
    onCancel,
    defaultReason,
}: {
    orderNumber: string;
    open: boolean;
    onClose(): void;
    onCancel(reason: BdCancelReason, note: string): Promise<void>;
    defaultReason?: BdCancelReason;
}) {
    const { messages: m } = useI18n();
    const [reason, setReason] = useState<BdCancelReason | ''>(defaultReason ?? '');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) {
            setReason(defaultReason ?? '');
            setNote('');
        }
    }, [open, defaultReason]);
    const needsNote = reason === 'other' && !note.trim();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            dismissible={!busy}
            title={m.orders.cancelDialog.title(orderNumber)}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>
                        {m.orders.cancelDialog.keep}
                    </Button>
                    <Button
                        variant="danger"
                        loading={busy}
                        disabled={!reason || needsNote}
                        onClick={async () => {
                            if (!reason) return;
                            setBusy(true);
                            await onCancel(reason, note.trim());
                            setBusy(false);
                        }}
                    >
                        {m.orders.cancelDialog.submit}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <Field label={m.orders.cancelDialog.reason}>
                    {control => (
                        <Select
                            {...control}
                            value={reason}
                            autoFocus
                            onChange={event => setReason(event.target.value as BdCancelReason)}
                        >
                            <option value="" />
                            {BD_CANCEL_REASONS.map(code => (
                                <option key={code} value={code}>
                                    {m.orders.cancelReasons[code]}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
                <Field
                    label={m.orders.cancelDialog.note}
                    hint={m.orders.cancelDialog.noteHint}
                    optional={reason !== 'other'}
                >
                    {control => (
                        <Textarea
                            {...control}
                            value={note}
                            maxLength={500}
                            onChange={event => setNote(event.target.value)}
                        />
                    )}
                </Field>
            </div>
        </Dialog>
    );
}

/** Today at an hour in Dhaka time, or tomorrow if that hour has passed. */
function nextDhakaHour(hour: number, dayOffset = 0): string {
    const now = new Date();
    const { year, month, day } = dhakaParts(now);
    let at = fromDhaka(year, month, day + dayOffset, hour);
    if (at <= now) at = new Date(at.getTime() + 24 * 60 * 60 * 1000);
    return at.toISOString();
}

/** Picks when to call the customer again, with quick choices for the usual answers. */
export function CallLaterDialog({
    open,
    onClose,
    onSave,
}: {
    open: boolean;
    onClose(): void;
    onSave(callBackAt: string): Promise<void>;
}) {
    const { messages: m } = useI18n();
    const [when, setWhen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) setWhen(new Date(Date.now() + 60 * 60 * 1000).toISOString());
    }, [open]);
    const quick: Array<[string, () => string]> = [
        [m.orders.callLaterDialog.inOneHour, () => new Date(Date.now() + 60 * 60 * 1000).toISOString()],
        [m.orders.callLaterDialog.thisEvening, () => nextDhakaHour(19)],
        [m.orders.callLaterDialog.tomorrowMorning, () => nextDhakaHour(10, 1)],
    ];
    return (
        <Dialog
            open={open}
            onClose={onClose}
            dismissible={!busy}
            title={m.orders.callLaterDialog.title}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        loading={busy}
                        disabled={!when}
                        onClick={async () => {
                            if (!when) return;
                            setBusy(true);
                            await onSave(when);
                            setBusy(false);
                        }}
                    >
                        {m.orders.callLaterDialog.submit}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                    {quick.map(([label, at]) => (
                        <Button key={label} variant="secondary" size="sm" onClick={() => setWhen(at())}>
                            {label}
                        </Button>
                    ))}
                </div>
                <Field label={m.orders.callLaterDialog.when} hint={m.inputs.dhakaTimeHint}>
                    {control => <DhakaDateTimeInput {...control} value={when} onChange={setWhen} />}
                </Field>
            </div>
        </Dialog>
    );
}

/** Stock ran out after the order was placed: confirm anyway, or cancel it as out of stock. */
export function StockDialog({
    items,
    onClose,
    onConfirmAnyway,
    onCancelOrder,
}: {
    items: string[] | null;
    onClose(): void;
    onConfirmAnyway(): void;
    onCancelOrder(): void;
}) {
    const { messages: m } = useI18n();
    return (
        <Dialog
            open={items !== null}
            onClose={onClose}
            title={m.orders.stockDialog.title}
            description={m.orders.stockDialog.body((items ?? []).join(', '))}
            footer={
                <>
                    <Button variant="danger" onClick={onCancelOrder}>
                        {m.orders.stockDialog.cancelOutOfStock}
                    </Button>
                    <Button onClick={onConfirmAnyway}>{m.orders.stockDialog.confirmAnyway}</Button>
                </>
            }
        />
    );
}
