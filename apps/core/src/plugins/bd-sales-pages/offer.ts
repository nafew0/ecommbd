import type { SalesPageSettings } from '@ecommbd/sections';

/**
 * The price of a sales page order (roadmap phase 16, docs/decisions.md): packs and the add-on are
 * price rules, not products. The order holds N of the product at its normal price; the "Sales page
 * offer" promotion takes off the difference, so the total is exactly the pack's price (plus the
 * add-on's special price). The browser never sends a price. The offer only applies to an order the
 * page's own order form built (the internal `salesPageOffer` field, offer-promotion.ts), never to
 * the shopper's normal cart, and the add-on's price only comes with the page's product: anyone
 * calling the API directly gets no more than the page offers everyone.
 */

export interface OfferLine {
    productId: string;
    variantId: string;
    quantity: number;
    /** The price of one, tax included (prices include tax in BD stores), in poisha. */
    unitPrice: number;
}

export interface OfferPage {
    productId: string | null;
    settings: Pick<SalesPageSettings, 'packs' | 'bump'>;
}

/** How much the page's offers take off these lines, in poisha (0 when nothing applies). */
export function offerDiscount(page: OfferPage, lines: OfferLine[]): number {
    if (!page.productId) return 0;
    const { bump, packs } = page.settings;
    const bumpVariant = bump.enabled && bump.variantId && bump.price ? bump.variantId : null;
    let discount = 0;
    // The page's product, every variant together (the add-on is another product's variant).
    const main = lines.filter(line => line.productId === page.productId && line.variantId !== bumpVariant);
    const quantity = main.reduce((sum, line) => sum + line.quantity, 0);
    // The add-on: one at its special price, and only with the page's product in the same order.
    // It's an offer "with your order", not a cheap way to buy the add-on on its own.
    const add =
        bumpVariant && quantity > 0
            ? lines.find(line => line.variantId === bumpVariant && line.quantity > 0)
            : undefined;
    if (add && bump.price) discount += Math.max(0, add.unitPrice - bump.price);
    // The pack: every unit of the page's product together, when there's a pack of exactly that many.
    const pack = packs.find(item => item.quantity === quantity);
    if (pack) {
        const normal = main.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
        discount += Math.max(0, normal - pack.price);
    }
    return discount;
}
