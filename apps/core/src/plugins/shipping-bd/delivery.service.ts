import { type DeliveryZone, zoneOf } from '@ecommbd/bd-geo';
import {
    type DeliveryLine,
    type DeliveryMethod,
    type DeliveryQuote,
    freeDeliveryRemaining,
    quoteDelivery,
    type ShippingSettings,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    type Order,
    ProductVariant,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';
import { ShippingSettingsService } from './shipping-settings.service';

/** What a product and variant contribute to the delivery charge. */
interface VariantDelivery {
    weightGrams: number | null;
    freeDelivery: boolean;
    insideDhaka: number | null;
    outsideDhaka: number | null;
    surcharge: number;
    collectionIds: string[];
}

export interface OrderDeliveryInfo {
    zone: DeliveryZone | null;
    freeDeliveryThreshold: number | null;
    freeDeliveryRemaining: number | null;
}

/**
 * Turns an order (a cart, a draft order or a placed order) into the calculator's input. The only
 * shopper input used is the address's district and thana IDs, which bd-core already validated.
 */
@Injectable()
export class DeliveryService {
    constructor(
        private settingsService: ShippingSettingsService,
        private connection: TransactionalConnection,
        private requestCache: RequestContextCacheService,
    ) {}

    async quote(ctx: RequestContext, order: Order, method: DeliveryMethod): Promise<DeliveryQuote> {
        const settings = await this.settingsService.get(ctx);
        const { districtId, thanaId } = addressOf(order);
        return quoteDelivery(settings, {
            method,
            zone: districtId ? zoneOf(districtId, thanaId) : undefined,
            districtId,
            thanaId,
            subTotal: order.subTotalWithTax,
            lines: await this.lines(ctx, order, settings),
        });
    }

    /** The zone and "spend ৳X more for free delivery", for the cart and manual orders. */
    async info(ctx: RequestContext, order: Order): Promise<OrderDeliveryInfo> {
        const settings = await this.settingsService.get(ctx);
        const { districtId, thanaId } = addressOf(order);
        const zone = (districtId && zoneOf(districtId, thanaId)) || undefined;
        const free = freeDeliveryRemaining(settings, zone, order.subTotalWithTax);
        return {
            zone: zone ?? null,
            freeDeliveryThreshold: free?.threshold ?? null,
            freeDeliveryRemaining: free?.remaining ?? null,
        };
    }

    private async lines(ctx: RequestContext, order: Order, settings: ShippingSettings): Promise<DeliveryLine[]> {
        const lines = order.lines ?? [];
        const variants = await this.variants(
            ctx,
            lines.map(line => String(line.productVariantId)),
        );
        const freeCollections = new Set(settings.freeCollectionIds);
        return lines.map(line => {
            const variant = variants.get(String(line.productVariantId));
            return {
                quantity: line.quantity,
                weightGrams: variant?.weightGrams ?? null,
                freeDelivery:
                    !!variant &&
                    (variant.freeDelivery || variant.collectionIds.some(id => freeCollections.has(id))),
                insideDhaka: variant?.insideDhaka ?? null,
                outsideDhaka: variant?.outsideDhaka ?? null,
                surcharge: variant?.surcharge ?? 0,
            };
        });
    }

    /** Product and variant delivery fields, once per request for the same variants. */
    private variants(ctx: RequestContext, ids: string[]): Promise<Map<string, VariantDelivery>> {
        const unique = [...new Set(ids)].sort();
        return this.requestCache.get(ctx, `shippingBd.variants:${unique.join(',')}`, async () => {
            if (!unique.length) {
                return new Map();
            }
            const rows = await this.connection.getRepository(ctx, ProductVariant).find({
                where: { id: In(unique) },
                relations: { product: true, collections: true },
                withDeleted: true,
            });
            return new Map(
                rows.map(variant => {
                    const product = variant.product.customFields;
                    return [
                        String(variant.id),
                        {
                            weightGrams: variant.customFields.weightGrams ?? null,
                            freeDelivery: product.freeDelivery ?? false,
                            insideDhaka: product.deliveryInsideDhaka ?? null,
                            outsideDhaka: product.deliveryOutsideDhaka ?? null,
                            surcharge: product.deliverySurcharge ?? 0,
                            collectionIds: (variant.collections ?? []).map(collection => String(collection.id)),
                        },
                    ];
                }),
            );
        });
    }
}

function addressOf(order: Order): { districtId?: string; thanaId?: string } {
    const fields = (order.shippingAddress?.customFields ?? {}) as { districtId?: string; thanaId?: string };
    return { districtId: fields.districtId || undefined, thanaId: fields.thanaId || undefined };
}
