import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Work that is waiting, counted for the menu and the bell. A key is missing when the role may not see it. */
export interface Attention {
    waitingConfirmation?: number;
    confirmedNotPacked?: number;
    incompleteOpen?: number;
    paymentsToVerify?: number;
    unmappedAddresses?: number;
    lowStock?: number;
}

export type AttentionKey = keyof Attention;

interface ShellData {
    shell: { storeName: { bn: string; en: string }; storefrontUrl: string | null };
    stats?: { waitingConfirmation: number; confirmedNotPacked: number };
    incomplete?: { open: number };
    payments?: Array<{ paymentId: string }>;
    unmapped?: Array<{ districtId: string }>;
    low?: Array<{ variantId: string }>;
}

/**
 * One request for what the shell shows: the store's name and address, and the counts of work
 * waiting. Only the parts this role may read are asked for, so one missing permission never fails
 * the rest. Refreshed every minute.
 */
export function useShell() {
    const { can } = useAuth();
    const parts = [
        'shell: bdAdminShell { storeName { bn en } storefrontUrl }',
        can('ReadOrder') && 'stats: bdOrderStats { waitingConfirmation confirmedNotPacked }',
        can('ReadOrder') && 'incomplete: bdIncompleteCheckoutCounts { open }',
        can('VerifyPayment') && 'payments: bdPaymentsToVerify { paymentId }',
        can('ReadOrder') && can('BookCourier') && 'unmapped: bdUnmappedAddresses { districtId }',
        (can('ReadProduct') || can('ReadCatalog')) && 'low: bdStock(lowOnly: true, take: 200) { variantId }',
    ].filter(Boolean);
    const query = useQuery({
        queryKey: ['shell', parts.length],
        queryFn: () => adminApi<ShellData>(`query Shell { ${parts.join(' ')} }`),
        refetchInterval: 60_000,
    });
    const data = query.data;
    const attention: Attention = {
        waitingConfirmation: data?.stats?.waitingConfirmation,
        confirmedNotPacked: data?.stats?.confirmedNotPacked,
        incompleteOpen: data?.incomplete?.open,
        paymentsToVerify: data?.payments?.length,
        unmappedAddresses: data?.unmapped?.length,
        lowStock: data?.low?.length,
    };
    return { shell: data?.shell, attention };
}
