import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import type { AstroGlobal } from 'astro';
import { ACTIVE_ORDER, ADD_TO_CART, ADJUST_LINE, REMOVE_LINE } from './checkout-queries';
import { clientIpOf, type ResultOf, shopQuery } from './core';
import type { Lang, Strings } from './i18n';
import { cartCountCookie, ShopSession } from './session';

/**
 * The cart (roadmap phase 14), shared by the cart page (`/cart/`, plain forms) and the cart drawer
 * (`/cart/drawer/`, the script's fragments). Every change runs in the shopper's own session.
 */

export type CartOrder = NonNullable<ResultOf<typeof ACTIVE_ORDER>['activeOrder']>;

export interface ShopperContext {
    session: ShopSession;
    lang: Lang;
    clientIp?: string;
}

export function shopperContext(Astro: AstroGlobal): ShopperContext {
    return {
        session: new ShopSession(Astro.request.headers.get('cookie')),
        lang: Astro.locals.lang,
        clientIp: clientIpOf(Astro.request, () => Astro.clientAddress),
    };
}

export async function activeOrder(shopper: ShopperContext): Promise<CartOrder | null> {
    const { activeOrder: order } = await shopQuery(ACTIVE_ORDER, {}, shopper.lang, shopper);
    return order ?? null;
}

export type CartIntent = 'add' | 'buy' | 'update' | 'remove';

export interface CartActionResult {
    intent: CartIntent | null;
    order: CartOrder | null;
    /** For the shopper, in their language: stock limits and the like. */
    message?: string;
}

/** A whole number from a form field, Bangla digits too; null when it isn't one. */
export function formInteger(value: FormDataEntryValue | null, min: number, max: number): number | null {
    if (typeof value !== 'string') return null;
    const digits = banglaToAsciiDigits(value.trim());
    if (!/^\d{1,4}$/.test(digits)) return null;
    return Math.min(Math.max(Number(digits), min), max);
}

const MAX_QUANTITY = 99;

/** Carries out one cart change from a form. */
export async function cartAction(
    shopper: ShopperContext,
    form: FormData,
    s: Strings,
): Promise<CartActionResult> {
    const raw = form.get('intent');
    const intent = (['add', 'buy', 'update', 'remove'] as const).find(value => value === raw) ?? null;
    const id = (name: string) => {
        const value = form.get(name);
        return typeof value === 'string' && /^[\w-]{1,40}$/.test(value) ? value : null;
    };
    let result:
        | ResultOf<typeof ADD_TO_CART>['addItemToOrder']
        | ResultOf<typeof REMOVE_LINE>['removeOrderLine']
        | null = null;
    if (intent === 'add' || intent === 'buy') {
        const variantId = id('variantId');
        const quantity = formInteger(form.get('quantity'), 1, MAX_QUANTITY) ?? 1;
        if (!variantId) return { intent, order: await activeOrder(shopper), message: s.chooseOption };
        result = (await shopQuery(ADD_TO_CART, { variantId, quantity }, shopper.lang, shopper))
            .addItemToOrder;
    } else if (intent === 'update' || intent === 'remove') {
        const lineId = id('lineId');
        const quantity = intent === 'remove' ? 0 : formInteger(form.get('quantity'), 0, MAX_QUANTITY);
        if (lineId && quantity === 0) {
            result = (await shopQuery(REMOVE_LINE, { lineId }, shopper.lang, shopper)).removeOrderLine;
        } else if (lineId && quantity != null) {
            result = (await shopQuery(ADJUST_LINE, { lineId, quantity }, shopper.lang, shopper))
                .adjustOrderLine;
        }
    }
    if (!result) return { intent, order: await activeOrder(shopper) };
    if (result.__typename === 'Order') return { intent, order: result as CartOrder };
    // Vendure still adds what it can when stock runs short.
    const message =
        result.__typename === 'InsufficientStockError'
            ? s.onlyLeft('quantityAvailable' in result ? Number(result.quantityAvailable) : 0)
            : result.__typename === 'OrderLimitError'
              ? s.cartLimit
              : s.cartError;
    return { intent, order: await activeOrder(shopper), message };
}

/** The session cookies and the header's item count, for the browser. */
export function applyCartCookies(headers: Headers, shopper: ShopperContext, order: CartOrder | null) {
    shopper.session.apply(headers);
    headers.append('set-cookie', cartCountCookie(order?.totalQuantity ?? 0));
}

/** Lines whose product sold out since they were added. */
export function soldOutLines(order: CartOrder | null) {
    return (order?.lines ?? []).filter(line => line.productVariant.stockLevel === 'OUT_OF_STOCK');
}
