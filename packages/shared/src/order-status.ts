/**
 * BD order statuses on top of Vendure's order states (roadmap phase 04,
 * docs/decisions/order-states.md). The server's order process and the merchant admin both read
 * this table, so the admin never offers an action the server would refuse.
 */

export const BD_ORDER_STATUSES = [
    // Placed, waiting for an online payment (phase 18): holds stock, not in the confirmation queue.
    'awaitingPayment',
    'new',
    'confirmed',
    'packed',
    'shipped',
    'partiallyDelivered',
    'delivered',
    'returned',
    'cancelled',
] as const;

export type BdOrderStatus = (typeof BD_ORDER_STATUSES)[number];

/** The states our order process adds to Vendure's. */
export const BD_CUSTOM_ORDER_STATES = ['AwaitingPayment', 'Confirmed', 'Packed', 'Returned'] as const;

const STATUS_OF_STATE: Record<string, BdOrderStatus> = {
    AwaitingPayment: 'awaitingPayment',
    PaymentAuthorized: 'new',
    PaymentSettled: 'new',
    Confirmed: 'confirmed',
    Packed: 'packed',
    PartiallyShipped: 'shipped',
    Shipped: 'shipped',
    PartiallyDelivered: 'partiallyDelivered',
    Delivered: 'delivered',
    Returned: 'returned',
    Cancelled: 'cancelled',
};

/** The merchant's status for a Vendure state; `null` for carts, drafts and Vendure's internal states. */
export function bdStatusOf(state: string): BdOrderStatus | null {
    return STATUS_OF_STATE[state] ?? null;
}

/** The Vendure states behind a status (for filtering lists). */
export function vendureStatesOf(status: BdOrderStatus): string[] {
    return Object.keys(STATUS_OF_STATE).filter(state => STATUS_OF_STATE[state] === status);
}

/**
 * Every allowed transition from a placed state. Anything else from these states is refused, even
 * where Vendure's default process would allow it. States not listed (carts, drafts, `Modifying`)
 * keep Vendure's own rules.
 */
export const BD_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
    // Paid in full (PaymentSettled), an online advance paid with COD for the rest (PaymentAuthorized),
    // or not paid in time (Cancelled, by the expiry task or staff).
    AwaitingPayment: ['PaymentSettled', 'PaymentAuthorized', 'Cancelled'],
    PaymentAuthorized: [
        'Confirmed',
        'Cancelled',
        'PaymentSettled',
        'Modifying',
        'ArrangingAdditionalPayment',
    ],
    // `Packed` only with "skip confirmation for prepaid orders" (see isBdTransitionAllowed).
    PaymentSettled: ['Confirmed', 'Cancelled', 'Packed', 'Modifying', 'ArrangingAdditionalPayment'],
    // `Modifying`: editing before shipping (phase 05); the edit returns the order to its status.
    Confirmed: ['Packed', 'Cancelled', 'Modifying'],
    Packed: ['Shipped', 'PartiallyShipped', 'Cancelled', 'Modifying'],
    PartiallyShipped: ['Shipped', 'PartiallyDelivered'],
    Shipped: ['Delivered', 'PartiallyDelivered', 'Returned'],
    PartiallyDelivered: ['Delivered', 'Returned'],
    Delivered: [],
    Returned: [],
    Cancelled: [],
};

export interface TransitionRules {
    /** Store setting: prepaid orders may be packed without a confirmation call. */
    skipConfirmationForPrepaid: boolean;
}

export function isBdTransitionAllowed(from: string, to: string, rules: TransitionRules): boolean {
    const allowed = BD_TRANSITIONS[from];
    if (!allowed) {
        return true;
    }
    if (from === 'PaymentSettled' && to === 'Packed') {
        return rules.skipConfirmationForPrepaid;
    }
    return allowed.includes(to);
}

/** States from which cancelling needs a reason (placed, not yet shipped). */
export const CANCEL_NEEDS_REASON_FROM: readonly string[] = [
    'AwaitingPayment',
    'PaymentAuthorized',
    'PaymentSettled',
    'Confirmed',
    'Packed',
];

export type BdOrderAction = 'confirm' | 'pack' | 'ship' | 'deliver' | 'return' | 'cancel';

/** What staff can do next with an order in this status, in button order. */
export function bdActionsFor(
    status: BdOrderStatus | null,
    options: { prepaid: boolean } & TransitionRules,
): BdOrderAction[] {
    switch (status) {
        case 'awaitingPayment':
            return ['cancel'];
        case 'new':
            return options.prepaid && options.skipConfirmationForPrepaid
                ? ['confirm', 'pack', 'cancel']
                : ['confirm', 'cancel'];
        case 'confirmed':
            return ['pack', 'cancel'];
        case 'packed':
            return ['ship', 'cancel'];
        case 'shipped':
        case 'partiallyDelivered':
            return ['deliver', 'return'];
        default:
            return [];
    }
}

export const BD_CANCEL_REASONS = [
    'fake',
    'customerCancelled',
    'unreachable',
    'duplicate',
    'outOfStock',
    'priceIssue',
    // The online payment didn't arrive in time (phase 18's expiry task).
    'paymentNotReceived',
    'other',
] as const;

export type BdCancelReason = (typeof BD_CANCEL_REASONS)[number];

export function isBdCancelReason(value: unknown): value is BdCancelReason {
    return (BD_CANCEL_REASONS as readonly unknown[]).includes(value);
}

export type BdPaymentType = 'cod' | 'advance' | 'prepaid';

/** From what's been received: nothing → COD; part → advance paid; everything → prepaid. */
export function bdPaymentType(totalWithTax: number, settledAmount: number): BdPaymentType {
    if (settledAmount <= 0) {
        return 'cod';
    }
    return settledAmount >= totalWithTax ? 'prepaid' : 'advance';
}

export type BdStatusTone = 'slate' | 'amber' | 'sky' | 'violet' | 'indigo' | 'teal' | 'green' | 'orange' | 'red';

/** Badge colours, the same in every screen. */
export const BD_STATUS_TONES: Record<BdOrderStatus, BdStatusTone> = {
    awaitingPayment: 'slate',
    new: 'amber',
    confirmed: 'sky',
    packed: 'violet',
    shipped: 'indigo',
    partiallyDelivered: 'teal',
    delivered: 'green',
    returned: 'orange',
    cancelled: 'red',
};
