import { DELIVERY_METHODS } from '@ecommbd/shared';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    Order,
    Permission,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
} from '@vendure/core';
import { IsNull } from 'typeorm';
import { DeliveryService } from './delivery.service';
import { ShippingSettingsService } from './shipping-settings.service';

/** `Order.bdDelivery` (Shop and Admin API). */
@Resolver('Order')
export class OrderDeliveryResolver {
    constructor(private delivery: DeliveryService) {}

    @ResolveField()
    async bdDelivery(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const info = await this.delivery.info(ctx, order);
        const quotes = await Promise.all(DELIVERY_METHODS.map(method => this.delivery.quote(ctx, order, method)));
        const standard = quotes[0];
        const unavailableReason = quotes.some(quote => quote.ok) || standard.ok ? null : standard.reason;
        return {
            ...info,
            unavailableReason,
            unavailableMessage: unavailableReason ? ctx.translate(`message.shipping-bd.${unavailableReason}`) : null,
        };
    }
}

@Resolver()
export class ShippingAdminResolver {
    constructor(
        private settings: ShippingSettingsService,
        private connection: TransactionalConnection,
        private translator: TranslatorService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings)
    bdShippingSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Allow(Permission.UpdateShippingMethod)
    updateBdShippingSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.settings.update(ctx, args.input);
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async bdProductsMissingWeight(@Ctx() ctx: RequestContext, @Args() args: { take?: number }) {
        const [variants, totalItems] = await this.connection.getRepository(ctx, ProductVariant).findAndCount({
            where: { deletedAt: IsNull(), customFields: { weightGrams: IsNull() } },
            relations: { translations: true },
            order: { id: 'ASC' },
            take: Math.min(Math.max(args.take ?? 20, 1), 100),
        });
        return {
            totalItems,
            items: variants.map(variant => ({
                productId: variant.productId,
                variantId: variant.id,
                name: this.translator.translate(variant, ctx).name,
                sku: variant.sku,
            })),
        };
    }
}
