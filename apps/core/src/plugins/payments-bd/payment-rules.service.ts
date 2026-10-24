import {
    advanceAmount,
    type CodRefusal,
    codFee,
    codRefusal,
    enabledMfsProviders,
    type MfsAccountType,
    type MfsProvider,
    type PaymentOrderFacts,
    type ShippingZone,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    type Order,
    OrderService,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';
import { DeliveryService, ShippingSettingsService } from '../shipping-bd';
import { COD_FEE_SKU, MFS_HANDLER_CODE, MFS_METHOD_CODES } from './constants';
import { PaymentSettingsService } from './payment-settings.service';
import { codBlocked, risky } from './risk';

export type CodUnavailableReason = CodRefusal | 'COD_BLOCKED';

export interface MfsOption {
    provider: MfsProvider;
    methodCode: string;
    number: string;
    accountType: MfsAccountType;
}

export interface PaymentOptions {
    codAvailable: boolean;
    codUnavailableReason: CodUnavailableReason | null;
    /** Paid first by mobile banking when the order is COD; 0 when none is needed. */
    advanceAmount: number;
    /** Collected on delivery: the total (with the COD fee) minus the advance. */
    codAmount: number;
    /** The COD fee the order has, or would have with COD. */
    codFee: number;
    mfs: MfsOption[];
}

/**
 * The payment rules for one order: may it pay by COD, does it need an advance, what is the COD fee,
 * and which mobile banking numbers can it be paid to. The COD fee is an order surcharge
 * (`BD-COD-FEE`), worked out like the advance from the total before the fee.
 */
@Injectable()
export class PaymentRulesService {
    constructor(
        private settings: PaymentSettingsService,
        private shippingSettings: ShippingSettingsService,
        private delivery: DeliveryService,
        private orderService: OrderService,
        private connection: TransactionalConnection,
    ) {}

    /** The COD fee surcharges on the order, read from the database (a loaded order may be stale). */
    async feeSurcharges(ctx: RequestContext, order: Order) {
        const surcharges = await this.orderService.getOrderSurcharges(ctx, order.id);
        return surcharges.filter(surcharge => surcharge.sku === COD_FEE_SKU);
    }

    async facts(ctx: RequestContext, order: Order): Promise<PaymentOrderFacts> {
        const fee = (await this.feeSurcharges(ctx, order)).reduce((sum, s) => sum + s.priceWithTax, 0);
        const { zone } = await this.delivery.info(ctx, order);
        const variantIds = (order.lines ?? []).map(line => line.productVariantId);
        const variants = variantIds.length
            ? await this.connection.getRepository(ctx, ProductVariant).find({
                  where: { id: In(variantIds) },
                  relations: { collections: true },
                  withDeleted: true,
              })
            : [];
        return {
            total: order.totalWithTax - fee,
            delivery: order.shippingWithTax,
            zone: (zone ?? undefined) as ShippingZone | undefined,
            productIds: [...new Set(variants.map(variant => String(variant.productId)))],
            collectionIds: [
                ...new Set(variants.flatMap(variant => (variant.collections ?? []).map(c => String(c.id)))),
            ],
            risky: await risky(ctx, order),
        };
    }

    async options(ctx: RequestContext, order: Order): Promise<PaymentOptions> {
        const settings = await this.settings.get(ctx);
        const facts = await this.facts(ctx, order);
        const refusal: CodUnavailableReason | null =
            codRefusal(settings, facts) ?? ((await codBlocked(ctx, order)) ? 'COD_BLOCKED' : null);
        const advance = advanceAmount(settings, facts);
        const fee = codFee(await this.shippingSettings.get(ctx), facts.total - advance);
        return {
            codAvailable: refusal === null,
            codUnavailableReason: refusal,
            advanceAmount: advance,
            codAmount: facts.total + fee - advance,
            codFee: fee,
            mfs: enabledMfsProviders(settings).map(provider => ({
                provider,
                methodCode: MFS_METHOD_CODES[provider],
                number: settings.mfs[provider].number,
                accountType: settings.mfs[provider].accountType,
            })),
        };
    }

    /** The COD fee the order should have for its current payment choice. */
    async expectedFee(ctx: RequestContext, order: Order): Promise<number> {
        if (order.customFields.paymentChoice === 'prepaid') {
            return 0;
        }
        const options = await this.options(ctx, order);
        return options.codAvailable ? options.codFee : 0;
    }

    /**
     * Puts the right COD fee on the order (none for prepaid orders). Called when the shopper chooses
     * how to pay, and by staff screens; the COD payment refuses an order whose fee is out of date.
     */
    async syncCodFee(ctx: RequestContext, order: Order): Promise<Order> {
        const expected = await this.expectedFee(ctx, order);
        const current = await this.feeSurcharges(ctx, order);
        if (current.length === 1 && current[0].priceWithTax === expected) {
            return order;
        }
        for (const surcharge of current) {
            await this.orderService.removeSurchargeFromOrder(ctx, order.id, surcharge.id);
        }
        if (expected > 0) {
            await this.orderService.addSurchargeToOrder(ctx, order.id, {
                description:
                    ctx.languageCode === 'bn' ? 'ক্যাশ অন ডেলিভারি চার্জ' : 'Cash on delivery charge',
                sku: COD_FEE_SKU,
                listPrice: expected,
                listPriceIncludesTax: true,
                taxLines: [],
            });
        }
        // Read again: Vendure's removeSurchargeFromOrder returns the order before the row is deleted.
        return (await this.orderService.findOne(ctx, order.id)) ?? order;
    }

    /**
     * Advance money already on the order: mobile banking (pending or verified), and an online advance
     * started at a gateway (phase 18, `Pending` until the gateway confirms it).
     */
    async mfsCovered(ctx: RequestContext, order: Order): Promise<number> {
        const payments = await this.orderService.getOrderPayments(ctx, order.id);
        const mfs = payments
            .filter(payment => isMfs(payment.method))
            .filter(payment => payment.state === 'Authorized' || payment.state === 'Settled')
            .reduce((sum, payment) => sum + payment.amount, 0);
        return mfs + (await this.pendingOnline(ctx, order));
    }

    /**
     * Online payments waiting for the gateway (phase 18). Vendure already leaves them out of what's
     * left to pay (only declined, cancelled and failed payments don't count), so a COD payment after
     * an online advance takes only the rest.
     */
    async pendingOnline(ctx: RequestContext, order: Order): Promise<number> {
        const payments = await this.orderService.getOrderPayments(ctx, order.id);
        return payments
            .filter(payment => (payment.metadata as { kind?: string } | null)?.kind === 'gateway')
            .filter(payment => payment.state === 'Pending')
            .reduce((sum, payment) => sum + payment.amount, 0);
    }
}

const MFS_CODES = new Set(Object.values(MFS_METHOD_CODES));

/** A payment made by mobile banking "Send Money" (method codes `bd-bkash`…, handler `bd-manual-mfs`). */
export function isMfs(method: string): boolean {
    return MFS_CODES.has(method) || method === MFS_HANDLER_CODE;
}
