import type {
    OrderItemPriceCalculationStrategy,
    PriceCalculationResult,
    ProductVariant,
    RequestContext,
} from '@vendure/core';

/**
 * A line's price: the price staff set for it (manual orders and edits, with OverridePrice), else
 * the variant's price, as Vendure's default strategy does. Prices are typed as the shopper pays
 * them (prices include tax).
 */
export class BdOrderItemPriceStrategy implements OrderItemPriceCalculationStrategy {
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: unknown },
    ): PriceCalculationResult {
        const override = orderLineCustomFields?.priceOverride;
        if (typeof override === 'number' && Number.isSafeInteger(override) && override >= 0) {
            return { price: override, priceIncludesTax: ctx.channel.pricesIncludeTax };
        }
        return { price: productVariant.listPrice, priceIncludesTax: productVariant.listPriceIncludesTax };
    }
}
