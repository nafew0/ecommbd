import { isPrivateMetaPath, metaPageUrl } from '@ecommbd/shared/meta-url';
import { describe, expect, it } from 'vitest';
import type { CartActionResult, CartOrder } from '../src/lib/cart';
import { initiateCheckoutEvent, metaAddedValue, purchaseEvents, viewContentEvent } from '../src/lib/meta';
import type { MetaConfig } from '../src/lib/store';
import { addedEvent } from '../src/scripts/meta';

/** Meta tracking (phase 20): what the storefront sends, and what it never lets out. */

const meta: MetaConfig = {
    pixelIds: ['1111111111'],
    browserPixel: true,
    purchaseTrigger: 'placed',
    purchaseValue: 'withoutDelivery',
};

const order = {
    code: 'ABC123XYZ',
    state: 'PaymentAuthorized',
    subTotalWithTax: 250_000,
    shippingWithTax: 6_000,
    totalWithTax: 256_000,
    lines: [
        { quantity: 2, unitPriceWithTax: 125_000, productVariant: { id: '12' } },
        { quantity: 1, unitPriceWithTax: 0, productVariant: { id: '13' } },
    ],
} as unknown as CartOrder;

describe('the page address Meta gets', () => {
    it('has no order code, payment attempt or tracking token in it', () => {
        const pages = {
            'https://shop.example.com/checkout/thank-you/?order=ABC123XYZ':
                'https://shop.example.com/checkout/thank-you/',
            'https://shop.example.com/s/offer/thank-you/?order=ABC123XYZ&utm_campaign=eid':
                'https://shop.example.com/s/offer/thank-you/?utm_campaign=eid',
            'https://shop.example.com/en/t/9f8e7d6c5b4a/': 'https://shop.example.com/en/t/-/',
            'https://shop.example.com/search/?q=01712345678': 'https://shop.example.com/search/',
            'https://shop.example.com/product/panjabi/?fbclid=IwAR2#reviews':
                'https://shop.example.com/product/panjabi/?fbclid=IwAR2',
        };
        for (const [href, clean] of Object.entries(pages)) expect(metaPageUrl(href)).toBe(clean);
    });

    it('never tracks the tracking, payment and account pages, in either language', () => {
        for (const path of ['/t/abc/', '/en/t/abc/', '/track/', '/en/track/', '/checkout/pay/', '/account/'])
            expect(isPrivateMetaPath(path)).toBe(true);
        for (const path of [
            '/',
            '/cart/',
            '/checkout/',
            '/checkout/thank-you/',
            '/s/offer/',
            '/en/product/x/',
        ])
            expect(isPrivateMetaPath(path)).toBe(false);
    });
});

describe('event IDs and product data', () => {
    it('gives InitiateCheckout one ID per cart, so a reload counts once', () => {
        const event = initiateCheckoutEvent(order);
        expect(event.eventId).toBe('checkout-ABC123XYZ');
        expect(initiateCheckoutEvent(order).eventId).toBe(event.eventId);
        expect(event.data).toMatchObject({ content_ids: ['12', '13'], num_items: 3, value: 2500 });
    });

    it('gives the thank-you Purchase the server’s ID, only when the store sends it on placing', () => {
        const [purchase] = purchaseEvents(order, meta);
        expect(purchase).toMatchObject({
            name: 'Purchase',
            eventId: 'purchase-ABC123XYZ',
            browserOnly: true,
            data: { content_ids: ['12', '13'], value: 2500, currency: 'BDT' },
        });
        expect(purchaseEvents(order, { ...meta, purchaseValue: 'withDelivery' })[0]!.data!.value).toBe(2560);
        expect(purchaseEvents(order, { ...meta, purchaseTrigger: 'confirmed' })).toEqual([]);
        expect(purchaseEvents(order, { ...meta, browserPixel: false })).toEqual([]);
        expect(purchaseEvents({ ...order, state: 'AwaitingPayment' }, meta)).toEqual([]);
        expect(purchaseEvents(null, meta)).toEqual([]);
    });

    it('names products by variant ID with the price in taka', () => {
        expect(viewContentEvent('12', 125_000)).toEqual({
            name: 'ViewContent',
            data: { content_ids: ['12'], content_type: 'product', value: 1250, currency: 'BDT' },
        });
    });
});

describe('AddToCart only for an add that worked', () => {
    const form = (variantId: string, quantity = '২') => {
        const data = new FormData();
        data.set('variantId', variantId);
        data.set('quantity', quantity);
        return data;
    };
    const added: CartActionResult = { intent: 'add', order };

    it('tells the next page what was added, Bangla digits too', () => {
        expect(metaAddedValue(meta, added, form('12'))).toBe('12.2.1250');
        expect(metaAddedValue(meta, { ...added, intent: 'buy' }, form('12', '1'))).toBe('12.1.1250');
        expect(addedEvent('12.2.1250')).toEqual({
            name: 'AddToCart',
            data: {
                content_ids: ['12'],
                contents: [{ id: '12', quantity: 2, item_price: 1250 }],
                content_type: 'product',
                value: 2500,
                currency: 'BDT',
            },
        });
    });

    it('says nothing when the add failed, the item isn’t in the cart, or the store has no Pixel', () => {
        expect(metaAddedValue(meta, { ...added, message: 'Only 1 left' }, form('12'))).toBeNull();
        expect(metaAddedValue(meta, { ...added, intent: 'remove' }, form('12'))).toBeNull();
        expect(metaAddedValue(meta, added, form('99'))).toBeNull();
        expect(metaAddedValue({ ...meta, pixelIds: [] }, added, form('12'))).toBeNull();
        expect(addedEvent(null)).toBeNull();
        expect(addedEvent('12.2.<script>')).toBeNull();
    });
});
