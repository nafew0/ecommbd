import type { SmsEvent } from '@ecommbd/shared/sms';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { Messages } from '../../messages/en';
import { Badge, type BadgeTone, Card, CardBody, CardHeader } from '../ui/misc';

const MESSAGES = `
    query OrderSms($orderId: ID!) {
        bdSmsMessages(orderId: $orderId) { id createdAt event body status sendAfter sentAt }
    }
`;

type SmsStatus = keyof Messages['sms']['statuses'];

interface SmsRow {
    id: string;
    createdAt: string;
    event: SmsEvent;
    body: string;
    status: SmsStatus;
    sendAfter: string | null;
    sentAt: string | null;
}

const TONES: Record<SmsStatus, BadgeTone> = {
    queued: 'sky',
    scheduled: 'amber',
    sent: 'teal',
    delivered: 'green',
    failed: 'red',
    skipped: 'slate',
};

/** The SMS sent (or held, or skipped) for one order (roadmap phase 10), newest first. */
export function OrderSms({ orderId, className }: { orderId: string; className?: string }) {
    const { messages: m } = useI18n();
    const format = useFormat();
    const query = useQuery({
        queryKey: ['orderSms', orderId],
        queryFn: () =>
            adminApi<{ bdSmsMessages: SmsRow[] }>(MESSAGES, { orderId }).then(result => result.bdSmsMessages),
        // Like the order itself: an SMS sent after a status change shows up.
        refetchInterval: 30_000,
    });
    const rows = query.data ?? [];
    return (
        <Card className={className}>
            <CardHeader title={m.sms.orderSms} />
            <CardBody>
                {query.isSuccess && rows.length === 0 && (
                    <p className="text-sm text-slate-600">{m.sms.noOrderSms}</p>
                )}
                <ul className="space-y-3">
                    {rows.map(row => (
                        <li key={row.id} className="text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">{m.sms.events[row.event] ?? row.event}</span>
                                <span className="flex items-center gap-2 text-slate-500">
                                    {format.dateTime(row.sentAt ?? row.sendAfter ?? row.createdAt)}
                                    <Badge tone={TONES[row.status] ?? 'slate'}>
                                        {m.sms.statuses[row.status] ?? row.status}
                                    </Badge>
                                </span>
                            </div>
                            <p className="mt-1 break-words whitespace-pre-line text-slate-700">{row.body}</p>
                        </li>
                    ))}
                </ul>
            </CardBody>
        </Card>
    );
}
