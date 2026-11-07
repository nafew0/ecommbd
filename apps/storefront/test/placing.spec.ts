import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopperContext } from '../src/lib/cart';
import { placedOrderByCode, placedSessionOrder, placeOnce } from '../src/lib/checkout';
import { CoreQueryError, CoreUnavailableError } from '../src/lib/core';
import { t } from '../src/lib/i18n';
import { ShopSession } from '../src/lib/session';

/**
 * Placing an order (src/lib/checkout.ts) against a small fake of the core's Shop API: just enough
 * of Vendure's order states, stock and order-by-code rules to show what the checkout does when
 * stock runs short, when the payment step fails, and when the core's answer is lost.
 */

// The idempotency store in memory (no Redis in unit tests).
delete process.env.REDIS_CACHE_HOST;

const en = t('en');
const bn = t('bn');

interface FakeLine {
    id: string;
    quantity: number;
    /** What can still be sold. */
    stock: number;
    name: string;
}

/** What the payment step does: places the order, fails, or places it but the answer is lost. */
type PaymentMode = 'place' | 'error' | 'waiting' | 'lost';

class FakeCore {
    state = 'AddingItems';
    placed = false;
    lines: FakeLine[] = [];
    payment: PaymentMode = 'place';
    calls: string[] = [];
    readonly code = 'ORDER0001';

    order() {
        const total = this.lines.reduce((sum, line) => sum + line.quantity * 125_000, 0);
        return {
            id: '1',
            code: this.code,
            state: this.state,
            active: !this.placed,
            orderPlacedAt: this.placed ? '2026-10-23T08:00:00.000Z' : null,
            totalQuantity: this.lines.reduce((sum, line) => sum + line.quantity, 0),
            subTotalWithTax: total,
            shippingWithTax: 0,
            totalWithTax: total,
            shippingLines: [],
            surcharges: [],
            discounts: [],
            payments: [],
            lines: this.lines.map(line => ({
                id: line.id,
                quantity: line.quantity,
                unitPriceWithTax: 125_000,
                linePriceWithTax: line.quantity * 125_000,
                featuredAsset: null,
                productVariant: {
                    id: line.id,
                    name: line.name,
                    // Vendure's own label: only "out of stock" once nothing at all is left.
                    stockLevel: line.stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
                    product: { name: line.name, slug: 'x' },
                },
            })),
            customer: null,
            shippingAddress: null,
            customFields: {
                orderNumber: this.placed ? '1001' : null,
                customerNote: null,
                paymentChoice: 'cod',
            },
            bdDelivery: { zone: 'dhaka_city', freeDeliveryThreshold: null, freeDeliveryRemaining: null },
            bdTrackingToken: null,
        };
    }

    /** One Shop API call: the operation's name picks the answer. */
    answer(operation: string, variables: Record<string, unknown>): unknown {
        const ok = (data: unknown) => ({ data });
        switch (operation) {
            case 'ActiveOrder':
                return ok({ activeOrder: this.placed ? null : this.order() });
            case 'SetCustomer':
                return ok({ setCustomerForOrderByPhone: { __typename: 'Order' } });
            case 'SetAddress':
                return ok({ setOrderShippingAddressBD: { __typename: 'Order' } });
            case 'ShippingOptions':
                return ok({
                    eligibleShippingMethods: [
                        { id: '1', code: 'bd-standard', name: 'Standard', priceWithTax: 0, metadata: null },
                    ],
                });
            case 'SetShipping':
                return ok({ setOrderShippingMethod: { __typename: 'Order' } });
            case 'SetPaymentChoice':
                return ok({ setBdPaymentChoice: { id: '1' } });
            case 'PaymentOptions':
                return ok({
                    bdPaymentOptions: {
                        codAvailable: true,
                        codUnavailableMessage: null,
                        advanceAmount: 0,
                        codAmount: 0,
                        codFee: 0,
                        codOtpRequired: false,
                        mfs: [],
                        // Online gateways (phase 18): none in these cash-on-delivery cases.
                        online: [],
                    },
                    eligiblePaymentMethods: [],
                });
            case 'ToState': {
                const to = variables.state as string;
                // Vendure refuses to take payment while a line wants more than it can sell.
                const short = this.lines.some(line => line.quantity > line.stock);
                const allowed =
                    (to === 'ArrangingPayment' && this.state === 'AddingItems' && !short) ||
                    (to === 'AddingItems' && this.state === 'ArrangingPayment');
                if (!allowed) {
                    return ok({
                        transitionOrderToState: {
                            __typename: 'OrderStateTransitionError',
                            message: 'refused',
                            transitionError: 'refused',
                        },
                    });
                }
                this.state = to;
                return ok({ transitionOrderToState: { __typename: 'Order' } });
            }
            case 'AdjustLine': {
                if (this.state !== 'AddingItems') {
                    return ok({
                        adjustOrderLine: {
                            __typename: 'OrderModificationError',
                            errorCode: 'X',
                            message: 'x',
                        },
                    });
                }
                const line = this.lines.find(item => item.id === variables.lineId)!;
                const wanted = variables.quantity as number;
                if (wanted <= line.stock) {
                    line.quantity = wanted;
                    return ok({ adjustOrderLine: { __typename: 'Order', ...this.order() } });
                }
                // Cut to what can be sold; none left: the line goes.
                line.quantity = line.stock;
                if (line.stock === 0) this.lines = this.lines.filter(item => item !== line);
                return ok({
                    adjustOrderLine: {
                        __typename: 'InsufficientStockError',
                        errorCode: 'INSUFFICIENT_STOCK_ERROR',
                        message: 'short',
                        quantityAvailable: line.stock,
                    },
                });
            }
            case 'AddPayment': {
                if (this.payment === 'error') return { errors: [{ message: 'Something broke' }] };
                if (this.payment === 'waiting') {
                    return ok({ addPaymentToOrder: { __typename: 'Order', ...this.order() } });
                }
                this.placed = true;
                this.state = 'PaymentAuthorized';
                if (this.payment === 'lost')
                    throw new DOMException('The operation timed out', 'TimeoutError');
                return ok({ addPaymentToOrder: { __typename: 'Order', ...this.order() } });
            }
            case 'OrderByCode':
                // Vendure's rule: FORBIDDEN for anything this session may not read (and unplaced orders).
                if (variables.code !== this.code || !this.placed) {
                    return {
                        errors: [
                            {
                                message: 'You are not currently authorized',
                                extensions: { code: 'FORBIDDEN' },
                            },
                        ],
                    };
                }
                return ok({ orderByCode: this.order() });
            default:
                throw new Error(`The fake core has no answer for ${operation}`);
        }
    }

    fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
        const operation = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? '';
        this.calls.push(operation === 'ToState' ? `ToState ${String(body.variables.state)}` : operation);
        return new Response(JSON.stringify(this.answer(operation, body.variables)), {
            headers: { 'content-type': 'application/json' },
        });
    };
}

let core: FakeCore;
let sessions = 0;

beforeEach(() => {
    core = new FakeCore();
    vi.stubGlobal('fetch', core.fetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** A shopper with a session of their own (the "placing" note is kept per session). */
function shopper(): ShopperContext {
    sessions++;
    return { session: new ShopSession(`shop-session=s${sessions}; shop-session.sig=x`), lang: 'en' };
}

/** The checkout form as the browser sends it, showing the cart's current total. */
function checkoutForm(key = crypto.randomUUID()) {
    const form = new FormData();
    for (const [name, value] of Object.entries({
        name: 'Rahim Uddin',
        phone: '01712345678',
        districtId: 'BD3026',
        thanaId: 'BD3026M26',
        streetLine1: 'House 12, Road 5, Mirpur 10',
        payment: 'cod',
        idempotencyKey: key,
        expectedTotal: String(core.order().totalWithTax),
    }))
        form.set(name, value);
    return form;
}

describe('placing an order when stock runs short', () => {
    it('lowers a line to what is left and says so: 3 in the cart, 2 left', async () => {
        core.lines = [{ id: 'L1', quantity: 3, stock: 2, name: 'Cotton Panjabi' }];
        const buyer = shopper();
        const outcome = await placeOnce(buyer, checkoutForm(), en);
        expect(outcome).toEqual({
            kind: 'invalid',
            errors: { form: en.stockChanged([{ name: 'Cotton Panjabi', quantity: 2 }]) },
        });
        expect(en.stockChanged([{ name: 'Cotton Panjabi', quantity: 2 }])).toContain(
            'Only 2 of Cotton Panjabi left, so your cart now has 2.',
        );
        expect(core.lines).toMatchObject([{ quantity: 2 }]);
        // The shopper checks the new total and orders again: placed.
        expect(await placeOnce(buyer, checkoutForm(), en)).toEqual({ kind: 'placed', code: 'ORDER0001' });
    });

    it('takes out a line with nothing left, and says it in Bangla too', async () => {
        core.lines = [
            { id: 'L1', quantity: 1, stock: 5, name: 'Cotton Panjabi' },
            { id: 'L2', quantity: 2, stock: 0, name: 'Silk Saree' },
        ];
        const outcome = await placeOnce(shopper(), checkoutForm(), en);
        expect(outcome).toEqual({
            kind: 'invalid',
            errors: { form: en.stockChanged([{ name: 'Silk Saree', quantity: 0 }]) },
        });
        expect(core.lines.map(line => line.id)).toEqual(['L1']);
        expect(bn.stockChanged([{ name: 'পাঞ্জাবি', quantity: 2 }])).toContain(
            'পাঞ্জাবি আছে মাত্র ২টি, তাই কার্টে এখন ২টি।',
        );
        expect(bn.stockChanged([{ name: 'শাড়ি', quantity: 0 }])).toContain('শাড়ি এইমাত্র শেষ হয়ে গেছে');
    });
});

describe('placing an order when the payment step fails', () => {
    it('moves the order back to the cart when the payment step throws', async () => {
        core.lines = [{ id: 'L1', quantity: 1, stock: 5, name: 'Cotton Panjabi' }];
        core.payment = 'error';
        const buyer = shopper();
        const form = checkoutForm();
        await expect(placeOnce(buyer, form, en)).rejects.toBeInstanceOf(CoreQueryError);
        expect(core.state).toBe('AddingItems');
        expect(core.calls.slice(-2)).toEqual(['AddPayment', 'ToState AddingItems']);
        // The key was freed and the cart can change: the retry places the order.
        core.payment = 'place';
        expect(await placeOnce(buyer, form, en)).toEqual({ kind: 'placed', code: 'ORDER0001' });
    });

    it('moves the order back to the cart when the payment leaves it waiting', async () => {
        core.lines = [{ id: 'L1', quantity: 1, stock: 5, name: 'Cotton Panjabi' }];
        core.payment = 'waiting';
        expect(await placeOnce(shopper(), checkoutForm(), en)).toEqual({
            kind: 'invalid',
            errors: { form: en.checkoutFailed },
        });
        expect(core.state).toBe('AddingItems');
    });

    it('starts from the cart state when an earlier attempt could not move the order back', async () => {
        core.lines = [{ id: 'L1', quantity: 1, stock: 5, name: 'Cotton Panjabi' }];
        core.state = 'ArrangingPayment';
        expect(await placeOnce(shopper(), checkoutForm(), en)).toEqual({ kind: 'placed', code: 'ORDER0001' });
    });
});

describe('placing an order when the core’s answer is lost', () => {
    it('finds the order the core placed, instead of an empty cart', async () => {
        core.lines = [{ id: 'L1', quantity: 1, stock: 5, name: 'Cotton Panjabi' }];
        core.payment = 'lost';
        const buyer = shopper();
        const form = checkoutForm();
        // The storefront gave up waiting (the page answers 503); the core placed the order.
        await expect(placeOnce(buyer, form, en)).rejects.toBeInstanceOf(CoreUnavailableError);
        expect(core.placed).toBe(true);
        // The retry, with the same key: that order, marked as placed already.
        expect(await placeOnce(buyer, form, en)).toEqual({ kind: 'placed', code: 'ORDER0001', again: true });
        // Found once: from here the thank-you page and the last_order cookie take over.
        expect(await placedSessionOrder(buyer)).toBeNull();
    });

    it('forgets an attempt that got its answer, so a second order is never taken for it', async () => {
        core.lines = [{ id: 'L1', quantity: 1, stock: 5, name: 'Cotton Panjabi' }];
        const buyer = shopper();
        expect(await placeOnce(buyer, checkoutForm(), en)).toEqual({ kind: 'placed', code: 'ORDER0001' });
        expect(await placedSessionOrder(buyer)).toBeNull();
        // Another tab, after this one placed it: nothing left to place.
        expect(await placeOnce(buyer, checkoutForm(), en)).toEqual({ kind: 'empty' });
    });
});

describe('the thank-you page’s order', () => {
    it('is null for an order this session may not read (Vendure says FORBIDDEN)', async () => {
        core.lines = [{ id: 'L1', quantity: 1, stock: 5, name: 'Cotton Panjabi' }];
        // Mistyped, or not placed: Vendure answers FORBIDDEN for both.
        expect(await placedOrderByCode(shopper(), 'NOTMYORDER1')).toBeNull();
        expect(await placedOrderByCode(shopper(), core.code)).toBeNull();
        expect(await placedOrderByCode(shopper(), 'bad code!')).toBeNull();
        core.placed = true;
        expect(await placedOrderByCode(shopper(), core.code)).toMatchObject({ code: core.code });
    });
});
