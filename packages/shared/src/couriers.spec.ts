import { describe, expect, it } from 'vitest';
import {
    courierCod,
    courierOutcome,
    courierPhone,
    courierStatusKey,
    courierTrackingUrl,
    defaultCourierSettings,
    matchPlace,
    outcomeMovesOn,
    parseCourierSettings,
    placeKey,
} from './couriers';

describe('courier statuses', () => {
    it('maps every Steadfast status', () => {
        const cases: Array<[string, string]> = [
            ['in_review', 'booked'],
            ['pending', 'pickedUp'],
            ['delivered', 'delivered'],
            ['partial_delivered', 'partiallyDelivered'],
            ['cancelled', 'returned'],
            ['hold', 'note'],
            ['unknown', 'note'],
            ['delivered_approval_pending', 'note'],
            ['partial_delivered_approval_pending', 'note'],
            ['cancelled_approval_pending', 'note'],
            ['unknown_approval_pending', 'note'],
            ['something_new', 'note'],
        ];
        for (const [status, outcome] of cases)
            expect(courierOutcome('steadfast', status), status).toBe(outcome);
    });

    it('maps every Pathao status, as a slug or a webhook event', () => {
        const cases: Array<[string, string]> = [
            ['Pending', 'booked'],
            ['order.created', 'booked'],
            ['order.pickup-requested', 'booked'],
            ['Assigned_for_Pickup', 'booked'],
            ['order.pickup-failed', 'note'],
            ['Pickup_Cancelled', 'cancelled'],
            ['order.picked', 'pickedUp'],
            ['At_the_Sorting_HUB', 'pickedUp'],
            ['order.in-transit', 'pickedUp'],
            ['Received_at_Last_Mile_HUB', 'pickedUp'],
            ['order.assigned-for-delivery', 'pickedUp'],
            ['order.delivered', 'delivered'],
            ['Partial_Delivery', 'partiallyDelivered'],
            ['order.returned', 'returned'],
            ['Return', 'returned'],
            ['Paid_Return', 'returned'],
            ['order.delivery-failed', 'note'],
            ['On_Hold', 'note'],
            ['order.paid', 'note'],
            ['Exchange', 'note'],
        ];
        for (const [status, outcome] of cases) expect(courierOutcome('pathao', status), status).toBe(outcome);
        expect(courierStatusKey('order.at-the-sorting-hub')).toBe('at_the_sorting_hub');
    });

    it('only moves forward, and never past a final outcome', () => {
        expect(outcomeMovesOn('booked', 'pickedUp')).toBe(true);
        expect(outcomeMovesOn('pickedUp', 'delivered')).toBe(true);
        expect(outcomeMovesOn('pickedUp', 'booked')).toBe(false);
        expect(outcomeMovesOn('delivered', 'pickedUp')).toBe(false);
        expect(outcomeMovesOn('delivered', 'returned')).toBe(false);
        expect(outcomeMovesOn('partiallyDelivered', 'returned')).toBe(true);
        expect(outcomeMovesOn('booked', 'cancelled')).toBe(true);
        expect(outcomeMovesOn('pickedUp', 'cancelled')).toBe(false);
        expect(outcomeMovesOn('booked', 'note')).toBe(false);
    });
});

describe('formats', () => {
    it('writes phones and COD amounts the way couriers take them', () => {
        expect(courierPhone('+8801712345678')).toBe('01712345678');
        expect(courierCod(131000)).toBe(1310);
        expect(courierCod(-5)).toBe(0);
        expect(courierTrackingUrl('steadfast', { consignmentId: '1', trackingCode: 'ABC12' })).toBe(
            'https://steadfast.com.bd/t/ABC12',
        );
    });

    it('validates settings', () => {
        expect(parseCourierSettings(defaultCourierSettings()).ok).toBe(true);
        const bad = {
            ...defaultCourierSettings(),
            defaultByZone: { ...defaultCourierSettings().defaultByZone, dhaka_city: 'redx' },
        };
        expect(parseCourierSettings(bad).ok).toBe(false);
    });
});

describe('place matching', () => {
    it('makes the usual spellings the same', () => {
        expect(placeKey('Chittagong')).toBe(placeKey('Chattogram'));
        expect(placeKey('Bogra')).toBe(placeKey('Bogura'));
        expect(placeKey('Comilla Sadar')).toBe(placeKey('Cumilla'));
        expect(placeKey("Cox's Bazar")).toBe(placeKey('Coxs Bazar'));
        expect(placeKey('Mohammadpur (Dhaka)')).toBe(placeKey('Mohammadpur'));
    });

    const zones = [
        { id: 1, name: 'Mirpur' },
        { id: 2, name: 'Dhanmondi' },
        { id: 3, name: 'Gulshan' },
        { id: 4, name: 'Uttara Sector 4' },
        { id: 5, name: 'Uttara Sector 7' },
        { id: 6, name: 'Badda' },
    ];

    it('matches by name or alias, exact first', () => {
        expect(matchPlace(['Mirpur', 'মিরপুর'], zones)?.id).toBe(1);
        expect(matchPlace(['Dhanmondi'], zones)?.id).toBe(2);
        expect(matchPlace(['Gulshan Thana'], zones)?.id).toBe(3);
    });

    it('never guesses between several', () => {
        expect(matchPlace(['Uttara'], zones)).toBeNull();
        expect(matchPlace(['Nowhere'], zones)).toBeNull();
        expect(matchPlace([], zones)).toBeNull();
    });
});
