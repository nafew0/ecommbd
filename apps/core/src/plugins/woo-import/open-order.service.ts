import { Injectable } from '@nestjs/common';
import {
    Customer,
    isGraphQlErrorResult,
    Order,
    OrderService,
    RequestContext,
    StockLevelService,
    StockLocationService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { LegacyOrder } from './entities';
import { arrays, catalogPrice, gmt, minor, text, WooRecord } from './helpers';
import { mapWooAddress, ImportMapperService } from './import-mapper.service';
import { WooImportService } from './woo-import.service';

@Injectable()
export class WooOpenOrderService {
    constructor(
        private connection: TransactionalConnection,
        private migration: WooImportService,
        private mapper: ImportMapperService,
        private orders: OrderService,
        private stock: StockLevelService,
        private locations: StockLocationService,
    ) {}

    async convert(
        ctx: RequestContext,
        legacyId: number,
        input: { sourceFrozen?: boolean; inventoryAlreadyReduced?: boolean },
    ) {
        if (input.sourceFrozen !== true || typeof input.inventoryAlreadyReduced !== 'boolean')
            throw new UserInputError('error.woo-import.freeze');
        const liveId = await this.connection.withTransaction(ctx, async txCtx => {
            const legacy = await this.connection
                .getRepository(txCtx, LegacyOrder)
                .createQueryBuilder('o')
                .setLock('pessimistic_write')
                .where('o.id = :id AND o.channelId = :channelId', { id: legacyId, channelId: ctx.channelId })
                .getOne();
            if (!legacy) throw new UserInputError('error.woo-import.notFound');
            // The same source lock is used by start/connect; no import may reset stock while a
            // reviewed order is being handed over to live fulfillment.
            await this.connection
                .getRepository(txCtx, LegacyOrder)
                .query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [2100, legacy.sourceId]);
            if (legacy.liveOrderId) return legacy.liveOrderId;
            const running = await this.migration.runs(txCtx, legacy.sourceId);
            if (running.some(r => ['queued', 'running'].includes(r.status)))
                throw new UserInputError('error.woo-import.busy');
            if (!running.some(r => r.mode !== 'dryRun' && r.status === 'completed'))
                throw new UserInputError('error.woo-import.review');
            const source = await this.migration.source(txCtx, legacy.sourceId);
            const row = legacy.snapshot as WooRecord;
            if (
                legacy.number.length > 32 ||
                (await this.connection
                    .getRepository(txCtx, Order)
                    .exists({ where: { customFields: { orderNumber: legacy.number } } }))
            )
                throw new UserInputError('error.woo-import.number');
            const created = gmt(row.date_created_gmt);
            if (
                !created ||
                Date.now() - created.getTime() > 14 * 86400_000 ||
                created > new Date() ||
                !['pending', 'processing', 'on-hold'].includes(legacy.status) ||
                row.payment_method !== 'cod' ||
                gmt(row.date_paid_gmt) ||
                legacy.currency !== 'BDT' ||
                BigInt(legacy.refunded) !== BigInt('0') ||
                BigInt(minor(row.discount_total)) !== BigInt('0') ||
                arrays(row.coupon_lines).length ||
                arrays(row.fee_lines).length ||
                BigInt(minor(row.total_tax)) !== BigInt('0')
            ) {
                throw new UserInputError('error.woo-import.openOrder');
            }
            const address = mapWooAddress(row.shipping?.address_1 ? row.shipping : (row.billing ?? {}));
            const customer = legacy.customerId
                ? await this.connection.getRepository(txCtx, Customer).findOneBy({ id: legacy.customerId })
                : null;
            if (!address.resolved || !address.streetLine1 || !customer?.customFields.phone)
                throw new UserInputError('error.woo-import.address');
            const lines: Array<{ variantId: string; quantity: number; expectedTotal: number }> = [];
            for (const item of arrays(row.line_items)) {
                const key = item.variation_id
                    ? `variation:${item.variation_id}`
                    : `product:${item.product_id}`;
                const mapped = await this.mapper.mapping(txCtx, source, 'variants', key);
                if (
                    !mapped?.targetId ||
                    !Number.isSafeInteger(item.quantity) ||
                    item.quantity < 1 ||
                    item.quantity > 1000
                )
                    throw new UserInputError('error.woo-import.openOrder');
                lines.push({
                    variantId: mapped.targetId,
                    quantity: item.quantity,
                    expectedTotal: catalogPrice(item.total),
                });
            }
            if (!lines.length || lines.length > 50) throw new UserInputError('error.woo-import.openOrder');
            // Vendure merges duplicate variants into one line. Refuse ambiguous source lines
            // rather than lose their original discounts or compare them by array position.
            if (new Set(lines.map(line => line.variantId)).size !== lines.length)
                throw new UserInputError('error.woo-import.openOrder');
            await this.stock.lockStockLevelsForVariants(
                txCtx,
                lines.map(l => l.variantId),
                { includeUntrackedVariants: true },
            );
            if (input.inventoryAlreadyReduced) {
                const location = await this.locations.defaultStockLocation(txCtx);
                // Woo's available quantity already excludes this order. Restore its reservation
                // before Vendure allocates it, so available stock stays unchanged after conversion.
                for (const line of lines)
                    await this.stock.updateStockOnHandForLocation(
                        txCtx,
                        line.variantId,
                        location.id,
                        line.quantity,
                    );
            }
            const draft = await this.orders.createDraft(txCtx);
            await this.connection.getRepository(txCtx, Order).update(draft.id, {
                customFields: {
                    imported: true,
                    sendSms: false,
                    paymentChoice: 'cod',
                    source: 'other',
                    orderNumber: legacy.number,
                    customerNote: text(row.customer_note, 500),
                    deliveryChargeOverride: catalogPrice(row.shipping_total),
                    locale: 'bn',
                },
            });
            await this.orders.addCustomerToOrder(txCtx, draft.id, customer);
            for (const line of lines) {
                const result = await this.orders.addItemToOrder(
                    txCtx,
                    draft.id,
                    line.variantId,
                    line.quantity,
                );
                if (isGraphQlErrorResult(result)) throw new UserInputError('error.woo-import.stock');
            }
            const { resolved: _resolved, ...shipping } = address;
            await this.orders.setShippingAddress(txCtx, draft.id, {
                ...shipping,
                phoneNumber: customer.customFields.phone,
            });
            const eligible = await this.orders.getEligibleShippingMethods(txCtx, draft.id);
            if (!eligible.length) throw new UserInputError('error.woo-import.address');
            const shippingResult = await this.orders.setShippingMethod(txCtx, draft.id, [eligible[0].id]);
            if (
                isGraphQlErrorResult(shippingResult) ||
                shippingResult.totalWithTax !== catalogPrice(row.total) ||
                shippingResult.lines.length !== lines.length ||
                shippingResult.lines.some(line => {
                    const expected = lines.find(item => item.variantId === String(line.productVariantId));
                    return (
                        !expected ||
                        line.quantity !== expected.quantity ||
                        line.linePriceWithTax !== expected.expectedTotal
                    );
                })
            )
                throw new UserInputError('error.woo-import.quote');
            const transition = await this.orders.transitionToState(txCtx, draft.id, 'ArrangingPayment');
            if (isGraphQlErrorResult(transition)) throw new UserInputError('error.woo-import.openOrder');
            const placed = await this.orders.addPaymentToOrder(txCtx, draft.id, {
                method: 'bd-cod',
                metadata: {},
            });
            if (isGraphQlErrorResult(placed) || placed.state !== 'PaymentAuthorized')
                throw new UserInputError('error.woo-import.openOrder');
            await this.orders.addNoteToOrder(txCtx, {
                id: draft.id,
                isPublic: false,
                note: `WooCommerce ${legacy.number}; source ${legacy.sourceOrderId}. Reviewed open-order conversion.`,
            });
            await this.connection
                .getRepository(txCtx, LegacyOrder)
                .update(legacy.id, { liveOrderId: Number(draft.id) });
            return Number(draft.id);
        });
        // Placement event payloads retain imported=true. Existing SMS/email listeners skip those
        // payloads before reloading. Future staff actions work normally after this activation.
        await this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.connection
                .getRepository(txCtx, Order)
                .createQueryBuilder('o')
                .setLock('pessimistic_write')
                .where('o.id = :id', { id: liveId })
                .getOneOrFail();
            if (
                order.customFields.imported &&
                ['PaymentAuthorized', 'PaymentSettled'].includes(order.state)
            ) {
                await this.connection.getRepository(txCtx, Order).update(liveId, {
                    customFields: { imported: false, sendSms: true, confirmQueueAt: new Date() },
                });
            }
        });
        return this.orders.findOne(ctx, liveId);
    }
}
