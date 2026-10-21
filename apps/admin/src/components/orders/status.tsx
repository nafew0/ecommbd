import { BD_STATUS_TONES, type BdOrderStatus, type BdPaymentType } from '@ecommbd/shared/order-status';
import { useI18n } from '../../lib/i18n';
import { Badge } from '../ui/misc';

/** The order's status in the merchant's words and colours, the same on every screen. */
export function StatusBadge({ status }: { status: BdOrderStatus | null }) {
    const { messages: m } = useI18n();
    if (!status) return null;
    return <Badge tone={BD_STATUS_TONES[status]}>{m.orders.statuses[status]}</Badge>;
}

export function PaymentBadge({ type }: { type: BdPaymentType }) {
    const { messages: m } = useI18n();
    return <Badge tone={type === 'cod' ? 'slate' : 'green'}>{m.orders.paymentTypes[type]}</Badge>;
}
