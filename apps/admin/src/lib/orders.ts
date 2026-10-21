import type { BdOrderAction, BdOrderStatus, BdPaymentType } from '@ecommbd/shared/order-status';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { adminApi } from './api';
import { useI18n } from './i18n';
import { useToast } from './toast';
import type { RiskLevel, RiskReasonCode } from '@ecommbd/shared/fraud';

/** The fields every order screen shows (roadmap phase 04). */
export const ORDER_FIELDS = `
    fragment BdOrderRow on Order {
        id
        code
        state
        orderPlacedAt
        totalWithTax
        subTotalWithTax
        shippingWithTax
        customFields { orderNumber customerNote }
        customer { id firstName lastName customFields { phone } }
        shippingAddress {
            fullName
            phoneNumber
            streetLine1
            city
            customFields { districtId thanaId area landmark alternatePhone }
        }
        lines { id quantity linePriceWithTax productVariant { id name } }
        bd {
            status
            paymentType
            paidAmount
            codDue
            cancelReason
            cancelNote
            callAttempts
            lastCallAt
            queueAt
            claim { name mine until }
            possibleDuplicateOf
            suggestCancel
            imported
        }
        bdRisk { score level reasons { code count } }
        bdOtpStatus
    }
`;

/** The risk score kept on the order (phase 11). */
export interface OrderRisk {
    score: number;
    level: RiskLevel;
    reasons: Array<{ code: RiskReasonCode; count: number | null }>;
}

export interface OrderRow {
    id: string;
    code: string;
    state: string;
    orderPlacedAt: string | null;
    totalWithTax: number;
    subTotalWithTax: number;
    shippingWithTax: number;
    customFields: { orderNumber: string | null; customerNote: string | null };
    customer: {
        id: string;
        firstName: string;
        lastName: string;
        customFields: { phone: string | null };
    } | null;
    shippingAddress: {
        fullName: string | null;
        phoneNumber: string | null;
        streetLine1: string | null;
        city: string | null;
        customFields: {
            districtId: string | null;
            thanaId: string | null;
            area: string | null;
            landmark: string | null;
            alternatePhone: string | null;
        } | null;
    } | null;
    lines: Array<{
        id: string;
        quantity: number;
        linePriceWithTax: number;
        productVariant: { id: string; name: string };
    }>;
    bd: {
        status: BdOrderStatus | null;
        paymentType: BdPaymentType;
        paidAmount: number;
        codDue: number;
        cancelReason: string | null;
        cancelNote: string | null;
        callAttempts: number;
        lastCallAt: string | null;
        queueAt: string | null;
        claim: { name: string | null; mine: boolean; until: string } | null;
        possibleDuplicateOf: string | null;
        suggestCancel: boolean;
        imported: boolean;
    };
    /** Null without the ReadRisk permission (phase 11). */
    bdRisk: OrderRisk | null;
    bdOtpStatus: 'verified' | 'unverified' | null;
}

export interface OrderActionError {
    __typename: 'BdOrderActionError';
    reason: string;
    message: string;
    currentStatus: BdOrderStatus | null;
    changedBy: string | null;
    changedAt: string | null;
    details: string[];
}

export type ActionName = BdOrderAction | 'noAnswer' | 'callLater';

/** Which mutation each action calls, and its input type. */
const MUTATIONS: Record<ActionName, [string, string]> = {
    confirm: ['confirmBdOrder', 'BdConfirmOrderInput'],
    pack: ['packBdOrder', 'BdOrderActionInput'],
    ship: ['markBdOrderShipped', 'BdOrderActionInput'],
    deliver: ['markBdOrderDelivered', 'BdOrderActionInput'],
    return: ['markBdOrderReturned', 'BdReturnOrderInput'],
    cancel: ['cancelBdOrder', 'BdCancelOrderInput'],
    noAnswer: ['recordBdCallAttempt', 'BdCallAttemptInput'],
    callLater: ['recordBdCallAttempt', 'BdCallAttemptInput'],
};

/** The permission each action needs; the server checks it either way. */
export const ACTION_PERMISSIONS: Record<ActionName, string> = {
    confirm: 'ConfirmOrder',
    pack: 'PackOrder',
    ship: 'UpdateOrder',
    deliver: 'UpdateOrder',
    return: 'UpdateOrder',
    cancel: 'CancelOrder',
    noAnswer: 'ConfirmOrder',
    callLater: 'ConfirmOrder',
};

const RESULT = `
    __typename
    ... on Order { ...BdOrderRow }
    ... on BdOrderActionError { reason message currentStatus changedBy changedAt details }
`;

/** "3 minutes ago" in the admin's language. */
export function useAgo() {
    const { messages: m } = useI18n();
    return useCallback(
        (iso: string | null | undefined) => {
            if (!iso) return '';
            const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
            if (minutes < 1) return m.orders.ago.justNow;
            if (minutes < 60) return m.orders.ago.minutes(minutes);
            if (minutes < 24 * 60) return m.orders.ago.hours(Math.floor(minutes / 60));
            return m.orders.ago.days(Math.floor(minutes / (24 * 60)));
        },
        [m],
    );
}

/**
 * Runs an order action and tells staff how it went. Returns the error when there is one, so a
 * screen can react (the stock warning opens a dialog); other errors are shown as a toast. When the
 * order moved on in the meantime, the toast says who did what: "Already confirmed by Karim, 1 minute ago."
 */
export function useOrderActions() {
    const { messages: m } = useI18n();
    const toast = useToast();
    const queryClient = useQueryClient();
    const ago = useAgo();
    return useCallback(
        async (action: ActionName, input: Record<string, unknown>): Promise<OrderActionError | null> => {
            const [name, type] = MUTATIONS[action];
            let result: OrderRow | OrderActionError;
            try {
                const data = await adminApi<Record<string, OrderRow | OrderActionError>>(
                    `mutation ($input: ${type}!) { ${name}(input: $input) { ${RESULT} } } ${ORDER_FIELDS}`,
                    { input },
                );
                result = data[name]!;
            } catch {
                toast.error(m.errors.generic);
                return null;
            } finally {
                void queryClient.invalidateQueries({ queryKey: ['orders'] });
            }
            if ('reason' in result) {
                if (result.reason === 'ALREADY_CHANGED' && result.currentStatus) {
                    toast.error(
                        m.orders.alreadyChanged(
                            m.orders.statuses[result.currentStatus],
                            result.changedBy,
                            ago(result.changedAt),
                        ),
                    );
                } else if (result.reason !== 'INSUFFICIENT_STOCK') {
                    toast.error(result.message);
                }
                return result;
            }
            toast.success(m.orders.done[action]);
            return null;
        },
        [m, toast, queryClient, ago],
    );
}

/** Claims a New order while a staff member looks at it ("Rahim is calling"); lets go afterwards. */
export function claimOrder(orderId: string) {
    return adminApi(`mutation ($id: ID!) { claimBdOrder(orderId: $id) { __typename } }`, {
        id: orderId,
    }).catch(() => undefined);
}

export function releaseOrder(orderId: string) {
    return adminApi(`mutation ($id: ID!) { releaseBdOrderClaim(orderId: $id) }`, { id: orderId }).catch(
        () => undefined,
    );
}
