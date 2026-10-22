import type { SalesPageSettings } from '@ecommbd/sections';

/**
 * The price of a sales page order (roadmap phase 16, docs/decisions.md): packs and the add-on are
 * price rules, not products. The order holds N of the product at its normal price; the "Sales page
 * offer" promotion takes off the difference, so the total is exactly the pack's price (plus the
 * add-on's special price). The browser never sends a price, and anyone calling the API directly
 * gets no more than the offers the page shows to everyone.
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
    // The add-on: one at its special price.
    const add = bumpVariant
        ? lines.find(line => line.variantId === bumpVariant && line.quantity > 0)
        : undefined;
    if (add && bump.price) discount += Math.max(0, add.unitPrice - bump.price);
    // The pack: every unit of the page's product together, when there's a pack of exactly that many.
    const main = lines.filter(line => line.productId === page.productId && line.variantId !== bumpVariant);
    const quantity = main.reduce((sum, line) => sum + line.quantity, 0);
    const pack = packs.find(item => item.quantity === quantity);
    if (pack) {
        const normal = main.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
        discount += Math.max(0, normal - pack.price);
    }
    return discount;
}
