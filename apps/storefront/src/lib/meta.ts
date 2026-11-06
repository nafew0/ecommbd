import { checkoutEventId, purchaseEventId } from '@ecommbd/shared/meta';
import { env } from '../env';
import { META_ADDED_COOKIE, type MetaEvent } from '../scripts/meta';
import { type CartActionResult, type CartOrder, formInteger } from './cart';
import type { MetaConfig } from './store';

/**
 * Meta events the storefront's server puts on a page (phase 20), for `scripts/meta.ts` to send.
 * Product IDs are variant IDs as the Shop API gives them: the server's Purchase uses the same form.
 * Values in whole taka.
 */

const taka = (minor: number) => Math.round(minor / 100);

type OrderLines = Pick<CartOrder, 'lines'>['lines'];

function contents(lines: OrderLines) {
    return {
        content_ids: lines.map(line => line.productVariant.id),
        contents: lines.map(line => ({
            id: line.productVariant.id,
            quantity: line.quantity,
            item_price: taka(line.unitPriceWithTax),
        })),
        content_type: 'product',
        num_items: lines.reduce((sum, line) => sum + line.quantity, 0),
    };
}

/** ViewContent of one product (its variant on show and that variant's price). */
export function viewContentEvent(variantId: string, price: number): MetaEvent {
    return {
        name: 'ViewContent',
        data: { content_ids: [variantId], content_type: 'product', value: taka(price), currency: 'BDT' },
    };
}

/**
 * InitiateCheckout, once per cart: its ID comes from the order's code, so reloading the checkout or
 * coming back to it sends nothing new (Meta and our outbox both keep one event per ID).
 */
export function initiateCheckoutEvent(
    order: Pick<CartOrder, 'code' | 'lines' | 'subTotalWithTax'>,
): MetaEvent {
    return {
        name: 'InitiateCheckout',
        eventId: checkoutEventId(order.code),
        data: { ...contents(order.lines), value: taka(order.subTotalWithTax), currency: 'BDT' },
    };
}

/**
 * The thank-you pages' Purchase (the store's checkout and sales pages): only for the browser Pixel,
 * only when the store sends Purchase on placing, and not while an online payment is still awaited.
 * Its ID is the server's (`purchase-<code>`), so Meta keeps one of the two.
 */
export function purchaseEvents(
    order: Pick<CartOrder, 'code' | 'state' | 'lines' | 'totalWithTax' | 'shippingWithTax'> | null,
    meta: MetaConfig,
): MetaEvent[] {
    if (
        !order ||
        !meta.browserPixel ||
        meta.purchaseTrigger !== 'placed' ||
        order.state === 'AwaitingPayment'
    )
        return [];
    const value = order.totalWithTax - (meta.purchaseValue === 'withDelivery' ? 0 : order.shippingWithTax);
    return [
        {
            name: 'Purchase',
            eventId: purchaseEventId(order.code),
            browserOnly: true,
            data: { ...contents(order.lines), value: taka(value), currency: 'BDT' },
        },
    ];
}

/**
 * After "Add to cart" or "Buy now": the cookie value telling the tracker the add worked
 * (`<variant ID>.<quantity>.<price in taka>`), or null when it didn't (a stock or cart limit) or the
 * store has no Pixel.
 */
export function metaAddedValue(meta: MetaConfig, result: CartActionResult, form: FormData): string | null {
    if (!meta.pixelIds.length || result.message || (result.intent !== 'add' && result.intent !== 'buy'))
        return null;
    const id = form.get('variantId');
    const line = result.order?.lines.find(item => item.productVariant.id === id);
    if (!line || typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id)) return null;
    const quantity = formInteger(form.get('quantity'), 1, 99) ?? 1;
    return `${id}.${quantity}.${taka(line.unitPriceWithTax)}`;
}

/** The Set-Cookie line for `metaAddedValue` (five minutes; the tracker reads and clears it). */
export function metaAddedCookie(value: string): string {
    return `${META_ADDED_COOKIE}=${value}; Path=/; Max-Age=300; SameSite=Lax${env().SECURE_COOKIES ? '; Secure' : ''}`;
}
