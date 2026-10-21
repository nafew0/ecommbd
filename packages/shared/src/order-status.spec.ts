import { describe, expect, it } from 'vitest';
import {
    BD_ORDER_STATUSES,
    BD_STATUS_TONES,
    BD_TRANSITIONS,
    bdActionsFor,
    bdPaymentType,
    bdStatusOf,
    isBdCancelReason,
    isBdTransitionAllowed,
    vendureStatesOf,
} from './order-status';

const rules = { skipConfirmationForPrepaid: false };

describe('BD order statuses', () => {
    it('maps Vendure states to statuses, and statuses back to states', () => {
        expect(bdStatusOf('PaymentAuthorized')).toBe('new');
        expect(bdStatusOf('PaymentSettled')).toBe('new');
        expect(bdStatusOf('PartiallyShipped')).toBe('shipped');
        expect(bdStatusOf('Returned')).toBe('returned');
        expect(bdStatusOf('AddingItems')).toBeNull();
        expect(bdStatusOf('Draft')).toBeNull();
        expect(vendureStatesOf('new')).toEqual(['PaymentAuthorized', 'PaymentSettled']);
        expect(vendureStatesOf('shipped')).toEqual(['PartiallyShipped', 'Shipped']);
        for (const status of BD_ORDER_STATUSES) {
            expect(vendureStatesOf(status).length).toBeGreaterThan(0);
            expect(BD_STATUS_TONES[status]).toBeTruthy();
        }
    });

    it('allows the BD workflow and refuses shortcuts', () => {
        expect(isBdTransitionAllowed('PaymentAuthorized', 'Confirmed', rules)).toBe(true);
        expect(isBdTransitionAllowed('Confirmed', 'Packed', rules)).toBe(true);
        expect(isBdTransitionAllowed('Packed', 'Shipped', rules)).toBe(true);
        expect(isBdTransitionAllowed('Shipped', 'Returned', rules)).toBe(true);
        expect(isBdTransitionAllowed('PartiallyDelivered', 'Returned', rules)).toBe(true);
        // Shortcuts Vendure's default process would allow:
        expect(isBdTransitionAllowed('PaymentSettled', 'Shipped', rules)).toBe(false);
        expect(isBdTransitionAllowed('PaymentAuthorized', 'Packed', rules)).toBe(false);
        expect(isBdTransitionAllowed('Shipped', 'Cancelled', rules)).toBe(false);
        expect(isBdTransitionAllowed('Delivered', 'Cancelled', rules)).toBe(false);
        expect(isBdTransitionAllowed('Confirmed', 'PaymentSettled', rules)).toBe(false);
    });

    it('packs prepaid orders without confirmation only with the store setting', () => {
        expect(isBdTransitionAllowed('PaymentSettled', 'Packed', rules)).toBe(false);
        expect(isBdTransitionAllowed('PaymentSettled', 'Packed', { skipConfirmationForPrepaid: true })).toBe(
            true,
        );
    });

    it('leaves carts, drafts and Modifying to Vendure', () => {
        expect(isBdTransitionAllowed('ArrangingPayment', 'PaymentAuthorized', rules)).toBe(true);
        expect(isBdTransitionAllowed('Modifying', 'PaymentSettled', rules)).toBe(true);
        expect(Object.keys(BD_TRANSITIONS)).not.toContain('Draft');
    });

    it('offers the next actions for each status', () => {
        const options = { prepaid: false, skipConfirmationForPrepaid: false };
        expect(bdActionsFor('new', options)).toEqual(['confirm', 'cancel']);
        expect(bdActionsFor('new', { prepaid: true, skipConfirmationForPrepaid: true })).toEqual([
            'confirm',
            'pack',
            'cancel',
        ]);
        expect(bdActionsFor('new', { prepaid: true, skipConfirmationForPrepaid: false })).toEqual([
            'confirm',
            'cancel',
        ]);
        expect(bdActionsFor('confirmed', options)).toEqual(['pack', 'cancel']);
        expect(bdActionsFor('packed', options)).toEqual(['ship', 'cancel']);
        expect(bdActionsFor('shipped', options)).toEqual(['deliver', 'return']);
        expect(bdActionsFor('partiallyDelivered', options)).toEqual(['deliver', 'return']);
        for (const done of ['delivered', 'returned', 'cancelled'] as const) {
            expect(bdActionsFor(done, options)).toEqual([]);
        }
        expect(bdActionsFor(null, options)).toEqual([]);
    });

    it('knows the cancel reasons', () => {
        expect(isBdCancelReason('fake')).toBe(true);
        expect(isBdCancelReason('other')).toBe(true);
        expect(isBdCancelReason('bored')).toBe(false);
        expect(isBdCancelReason(undefined)).toBe(false);
    });

    it('derives the payment type from what was received', () => {
        expect(bdPaymentType(125000, 0)).toBe('cod');
        expect(bdPaymentType(125000, 12000)).toBe('advance');
        expect(bdPaymentType(125000, 125000)).toBe('prepaid');
        expect(bdPaymentType(125000, 130000)).toBe('prepaid');
    });
});
