import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ActionMenu } from '../components/ui/action-menu';
import { useI18n } from '../lib/i18n';
import type { Attention, AttentionKey } from './use-shell';

const SEEN_KEY = 'ecommbd-admin-attention-seen';

/** Where each kind of waiting work is done, in the order a merchant should look at it. */
const ITEMS: Array<{ key: AttentionKey; to: string }> = [
    { key: 'waitingConfirmation', to: '/orders/confirm' },
    { key: 'paymentsToVerify', to: '/orders/payments' },
    { key: 'confirmedNotPacked', to: '/orders?status=confirmed' },
    { key: 'unmappedAddresses', to: '/orders/unmapped-addresses' },
    { key: 'incompleteOpen', to: '/orders/incomplete' },
    { key: 'lowStock', to: '/products/stock' },
];

function readSeen(): Attention {
    try {
        return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Attention;
    } catch {
        return {};
    }
}

/**
 * The bell: a short list of the work that is waiting, each line going to the screen where it is
 * done. A dot shows when a count has grown since the list was last opened on this device. The
 * counts come from the shell's one-minute refresh; nothing is stored on the server.
 */
export function Notifications({ attention }: { attention: Attention }) {
    const { messages: m } = useI18n();
    const navigate = useNavigate();
    const [seen, setSeen] = useState(readSeen);
    const waiting = ITEMS.filter(item => (attention[item.key] ?? 0) > 0);
    const unread = waiting.some(item => (attention[item.key] ?? 0) > (seen[item.key] ?? 0));
    const n = m.common.number;

    const markSeen = () => {
        setSeen(attention);
        try {
            localStorage.setItem(SEEN_KEY, JSON.stringify(attention));
        } catch {
            // Not remembered: the dot shows again after a reload.
        }
    };

    return (
        <ActionMenu
            label={unread ? m.attention.titleNew : m.attention.title}
            variant="ghost"
            size="icon"
            className="text-white/80 hover:bg-white/10 hover:text-white"
            onOpen={markSeen}
            trigger={
                <span className="relative">
                    <Bell className="size-5" aria-hidden />
                    {unread && (
                        <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warn-soft ring-2 ring-bar" />
                    )}
                </span>
            }
            items={
                waiting.length
                    ? waiting.map(item => ({
                          label: m.attention.items[item.key](n(attention[item.key] ?? 0)),
                          onSelect: () => void navigate(item.to),
                      }))
                    : [{ label: m.attention.empty, onSelect: () => undefined, disabled: true }]
            }
        />
    );
}
