import { bdStatusOf, cleanText, EDITABLE_STATUSES, isWholeTaka, maxManualDiscount } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    HistoryService,
    type ID,
    Injector,
    isGraphQlErrorResult,
    Order,
    OrderModification,
    OrderService,
    Payment,
    PaymentService,
    ProductVariant,
    Refund,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { lockAndCheckStock } from '../bd-catalog';
import { channelPrice } from '../bd-catalog/product-form.service';
import { BdAddressError, normalizeAddressInput } from '../bd-core';
import { settledAmount } from '../bd-orders';
import { COD_METHOD_CODE, EDIT_REFUND_REASON, PaymentRulesService } from '../payments-bd';
import {
    applyManualDiscountPermission,
    MANUAL_DISCOUNT_SKU,
    ORDER_EDIT_HISTORY_TYPE,
    overridePricePermission,
    unlimitedDiscountPermission,
} from './constants';
import { editBlockedBy } from './edit-guard';
import { BdManualOrderError, Refusal, refuse } from './errors';
import type { ManualAddressInput } from './manual-order.service';

export interface EditOrderInput {
    orderId: ID;
    /** The status the staff member saw; if the order moved on, nothing is changed. */
    expectedStatus?: string | null;
    /** Every line the order should have: existing ones by orderLineId (quantity 0 removes), new ones by variantId. */
    lines: Array<{
        orderLineId?: ID | null;
        variantId?: ID | null;
        quantity: number;
        unitPrice?: number | null;
    }>;
    address?: ManualAddressInput | null;
    /** undefined: unchanged; null: back to the delivery rules; a number: this charge. */
    deliveryCharge?: number | null;
    /** undefined: unchanged; 0: no discount. */
    discount?: number | null;
    note?: string | null;
}

interface Snapshot {
    lines: Array<{ name: string; quantity: number; unitPrice: number }>;
    delivery: number;
    discount: number;
    total: number;
    address: string;
}

/**
 * Editing orders before they ship (roadmap phase 05), with Vendure's order modification: items,
 * quantities, staff prices, address, delivery charge and discount. Afterwards the money follows the
 * new total: a COD order's amount due on delivery changes; a prepaid order's increase is collected
 * on delivery (a COD payment for the difference); a decrease leaves money to refund, which staff
 * record (phase 08). Every edit is an order history entry with before and after.
 */
@Injectable()
export class OrderEditService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private paymentService: PaymentService,
        private historyService: HistoryService,
        private moduleRef: ModuleRef,
    ) {}

    /** From the payments plugin, found like Vendure's own injector does (any module). */
    private get rules() {
        return this.moduleRef.get(PaymentRulesService, { strict: false });
    }

    async edit(ctx: RequestContext, input: EditOrderInput): Promise<Order | BdManualOrderError> {
        const invalid = this.check(ctx, input);
        if (invalid) return invalid;
        try {
            const orderId = await this.connection.withTransaction(ctx, txCtx => this.apply(txCtx, input));
            return (await this.orderService.findOne(ctx, orderId))!;
        } catch (error) {
            if (error instanceof Refusal) return error.error;
            throw error;
        }
    }

    private check(ctx: RequestContext, input: EditOrderInput): BdManualOrderError | null {
        const can = (permission: string) => ctx.userHasPermissions([permission as never]);
        for (const line of input.lines) {
            if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 1000) {
                return new BdManualOrderError('INVALID_QUANTITY');
            }
            if (!line.orderLineId && !line.variantId) return new BdManualOrderError('UNKNOWN_PRODUCT');
            if (line.unitPrice != null) {
                if (!can(overridePricePermission.Permission))
                    return new BdManualOrderError('PRICE_OVERRIDE_NOT_ALLOWED');
                if (
                    !Number.isSafeInteger(line.unitPrice) ||
                    line.unitPrice < 0 ||
                    !isWholeTaka(line.unitPrice)
                ) {
                    return new BdManualOrderError('INVALID_PRICE');
                }
            }
        }
        if (!input.lines.some(line => line.quantity > 0)) return new BdManualOrderError('NO_ITEMS');
        const money = (value: number | null | undefined) =>
            value == null || (Number.isSafeInteger(value) && value >= 0 && isWholeTaka(value));
        if (!money(input.discount) || !money(input.deliveryCharge))
            return new BdManualOrderError('INVALID_PRICE');
        if (input.discount && !can(applyManualDiscountPermission.Permission)) {
            return new BdManualOrderError('DISCOUNT_NOT_ALLOWED');
        }
        if (input.deliveryCharge !== undefined && !can(overridePricePermission.Permission)) {
            return new BdManualOrderError('PRICE_OVERRIDE_NOT_ALLOWED');
        }
        return null;
    }

    private async apply(ctx: RequestContext, input: EditOrderInput): Promise<ID> {
        const [locked] = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .setLock('pessimistic_write')
            .where('order.id = :id', { id: input.orderId })
            .getMany();
        if (!locked) throw refuse('ORDER_NOT_FOUND');
        const order = (await this.orderService.findOne(ctx, input.orderId, [
            'lines',
            'lines.productVariant',
            'surcharges',
            'shippingLines',
        ]))!;
        const status = bdStatusOf(order.state);
        if (!status || !(EDITABLE_STATUSES as readonly string[]).includes(status))
            throw refuse('NOT_EDITABLE');
        if (input.expectedStatus && input.expectedStatus !== status)
            throw refuse('ALREADY_CHANGED', [status]);
        const blocked = await editBlockedBy(ctx, order);
        if (blocked) throw refuse(blocked);
        const before = this.snapshot(order);

        const adjustOrderLines: Array<{
            orderLineId: ID;
            quantity: number;
            customFields?: Record<string, unknown>;
        }> = [];
        const addItems: Array<{
            productVariantId: ID;
            quantity: number;
            customFields?: Record<string, unknown>;
        }> = [];
        const extraStock: Array<{ productVariantId: ID; quantity: number }> = [];
        const variants = this.connection.getRepository(ctx, ProductVariant);
        const seen = new Set<string>();
        for (const line of input.lines) {
            if (line.orderLineId) {
                const existing = order.lines.find(l => String(l.id) === String(line.orderLineId));
                if (!existing) throw refuse('UNKNOWN_PRODUCT');
                seen.add(String(existing.id));
                const priceChanged =
                    line.unitPrice !== undefined &&
                    (line.unitPrice ?? null) !== (existing.customFields.priceOverride ?? null);
                if (line.quantity !== existing.quantity || priceChanged) {
                    adjustOrderLines.push({
                        orderLineId: existing.id,
                        quantity: line.quantity,
                        ...(priceChanged
                            ? {
                                  customFields: {
                                      priceOverride: line.unitPrice ?? null,
                                      originalUnitPrice:
                                          existing.customFields.originalUnitPrice ??
                                          existing.unitPriceWithTax,
                                  },
                              }
                            : {}),
                    });
                }
                if (line.quantity > existing.quantity) {
                    extraStock.push({
                        productVariantId: existing.productVariantId,
                        quantity: line.quantity - existing.quantity,
                    });
                }
            } else if (line.quantity > 0) {
                const variant = await variants.findOne({
                    where: { id: line.variantId! },
                    relations: { productVariantPrices: true },
                });
                if (!variant || variant.deletedAt) throw refuse('UNKNOWN_PRODUCT');
                addItems.push({
                    productVariantId: variant.id,
                    quantity: line.quantity,
                    ...(line.unitPrice != null
                        ? {
                              customFields: {
                                  priceOverride: line.unitPrice,
                                  originalUnitPrice: channelPrice(ctx, variant),
                              },
                          }
                        : {}),
                });
                extraStock.push({ productVariantId: variant.id, quantity: line.quantity });
            }
        }
        // Lines left out of the input are removed.
        for (const line of order.lines.filter(l => l.quantity > 0 && !seen.has(String(l.id)))) {
            adjustOrderLines.push({ orderLineId: line.id, quantity: 0 });
        }

        let updateShippingAddress: ReturnType<typeof normalizeAddressInput> | undefined;
        if (input.address) {
            try {
                updateShippingAddress = normalizeAddressInput({
                    streetLine1: cleanText(input.address.streetLine1).slice(0, 255),
                    countryCode: 'BD',
                    customFields: {
                        districtId: input.address.districtId,
                        thanaId: input.address.thanaId,
                        area: input.address.area ?? null,
                        landmark: input.address.landmark ?? null,
                    },
                });
            } catch (error) {
                if (error instanceof BdAddressError) throw refuse('INVALID_ADDRESS', [error.code]);
                throw error;
            }
        }
        const deliveryChanged =
            input.deliveryCharge !== undefined &&
            (input.deliveryCharge ?? null) !== (order.customFields.deliveryChargeOverride ?? null);
        const discountChanged = input.discount != null && input.discount !== before.discount;
        if (
            !adjustOrderLines.length &&
            !addItems.length &&
            !updateShippingAddress &&
            !deliveryChanged &&
            !discountChanged
        ) {
            throw refuse('NOTHING_CHANGED');
        }
        if (extraStock.length) {
            const short = await lockAndCheckStock(
                ctx,
                { lines: extraStock } as unknown as Order,
                new Injector(this.moduleRef),
            );
            if (short.length) throw refuse('INSUFFICIENT_STOCK', short);
        }

        const fromState = order.state;
        const modifying = await this.orderService.transitionToState(ctx, order.id, 'Modifying');
        if (isGraphQlErrorResult(modifying)) throw refuse('NOT_EDITABLE', [modifying.transitionError]);
        if (deliveryChanged) {
            await this.connection
                .getRepository(ctx, Order)
                .update(order.id, { customFields: { deliveryChargeOverride: input.deliveryCharge ?? null } });
        }
        if (discountChanged) {
            for (const surcharge of order.surcharges.filter(s => s.sku === MANUAL_DISCOUNT_SKU)) {
                await this.orderService.removeSurchargeFromOrder(ctx, order.id, surcharge.id);
            }
        }
        const modification = {
            orderId: order.id,
            adjustOrderLines,
            addItems,
            surcharges:
                discountChanged && input.discount
                    ? [
                          {
                              description: 'ছাড় / Discount',
                              sku: MANUAL_DISCOUNT_SKU,
                              price: -input.discount,
                              priceIncludesTax: true,
                          },
                      ]
                    : [],
            updateShippingAddress,
            note: cleanText(input.note ?? '').slice(0, 500) || undefined,
            options: { recalculateShipping: true },
        };
        // Vendure wants a refund for every price drop, so a dry run tells us the drop first. Its
        // "dry run" still saves new lines inside our transaction, so it runs in a savepoint that is
        // rolled back.
        const current = (await this.orderService.findOne(ctx, order.id))!;
        const raw = this.connection.getRepository(ctx, Order);
        await raw.query('SAVEPOINT bd_edit_dry_run');
        const dry = await this.orderService.modifyOrder(ctx, { ...modification, dryRun: true } as never);
        await raw.query('ROLLBACK TO SAVEPOINT bd_edit_dry_run');
        if (isGraphQlErrorResult(dry)) throw refuse('NOT_EDITABLE', [dry.message]);
        const drop = current.totalWithTax - dry.totalWithTax;
        const modified = await this.orderService.modifyOrder(ctx, {
            ...modification,
            dryRun: false,
            refunds: drop > 0 ? await this.refundsFor(ctx, order.id, drop) : [],
        } as never);
        if (isGraphQlErrorResult(modified)) {
            throw refuse(
                modified.errorCode === 'INSUFFICIENT_STOCK_ERROR' ? 'INSUFFICIENT_STOCK' : 'NOT_EDITABLE',
                [modified.message],
            );
        }
        if (input.discount) {
            const cap = maxManualDiscount(
                modified.subTotalWithTax,
                ctx.userHasPermissions([unlimitedDiscountPermission.Permission as never]),
            );
            if (input.discount > cap || input.discount > modified.subTotalWithTax) {
                throw refuse('DISCOUNT_TOO_LARGE', [String(Math.min(cap, modified.subTotalWithTax))]);
            }
        }
        await this.dropNotCollected(ctx, order.id);
        const synced = await this.rules.syncCodFee(ctx, modified);
        await this.followTotal(ctx, synced);
        // A New order goes back as Vendure's PaymentAuthorized while something is still to collect,
        // PaymentSettled once it's all paid (both are "New" for staff).
        const stillToCollect = (await this.orderService.getOrderPayments(ctx, order.id)).some(
            p => p.state === 'Authorized',
        );
        const isNew = fromState === 'PaymentAuthorized' || fromState === 'PaymentSettled';
        const target = isNew ? (stillToCollect ? 'PaymentAuthorized' : 'PaymentSettled') : fromState;
        const back = await this.orderService.transitionToState(ctx, order.id, target as never);
        if (isGraphQlErrorResult(back)) throw refuse('NOT_EDITABLE', [back.transitionError]);

        const after = this.snapshot(
            (await this.orderService.findOne(ctx, order.id, [
                'lines',
                'lines.productVariant',
                'surcharges',
                'shippingLines',
            ]))!,
        );
        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId: order.id,
            type: ORDER_EDIT_HISTORY_TYPE,
            data: { before, after, note: cleanText(input.note ?? '').slice(0, 500) },
        });
        return order.id;
    }

    /**
     * The money follows the new total. What isn't received or waiting for verification is due on
     * delivery: the COD payment's amount is set to it (or a COD payment is added for it); nothing
     * due cancels the COD payment. Vendure needs each price change "settled" by a payment before the
     * order leaves Modifying, so unsettled changes point at that payment.
     */
    /**
     * Where a price drop goes: first the money not collected yet (the COD payment), then money
     * received, largest payment first. Refunds on money received stay as "refund due" (pending).
     */
    private async refundsFor(ctx: RequestContext, orderId: ID, drop: number) {
        const payments = await this.orderService.getOrderPayments(ctx, orderId);
        const refunded = (payment: Payment) =>
            (payment.refunds ?? []).filter(r => r.state !== 'Failed').reduce((sum, r) => sum + r.total, 0);
        const candidates = [
            ...payments.filter(p => p.method === COD_METHOD_CODE && p.state === 'Authorized'),
            ...payments.filter(p => p.state === 'Settled').sort((a, b) => b.amount - a.amount),
        ];
        const refunds: Array<{ paymentId: ID; amount: number; reason: string }> = [];
        let left = drop;
        for (const payment of candidates) {
            const room = payment.amount - refunded(payment);
            if (left <= 0 || room <= 0) continue;
            const amount = Math.min(room, left);
            refunds.push({ paymentId: payment.id, amount, reason: EDIT_REFUND_REASON });
            left -= amount;
        }
        if (left > 0 || !refunds.length) throw refuse('PAYMENT_REFUSED');
        return refunds;
    }

    /** "Less to collect" refunds Vendure needed on payments not collected yet: the COD amount says it instead. */
    private async dropNotCollected(ctx: RequestContext, orderId: ID) {
        const payments = await this.orderService.getOrderPayments(ctx, orderId);
        const ids = payments
            .flatMap(p => p.refunds ?? [])
            .filter(r => (r.metadata as { notCollected?: boolean } | undefined)?.notCollected)
            .map(r => r.id);
        if (!ids.length) return;
        const modifications = this.connection.getRepository(ctx, OrderModification);
        for (const modification of await modifications.find({
            where: { order: { id: orderId } },
            relations: { refund: true },
        })) {
            if (modification.refund && ids.some(id => String(id) === String(modification.refund!.id))) {
                await modifications.update(modification.id, { refund: null as never });
            }
        }
        // Vendure links each refund to order lines (order_line_reference); those links go first.
        const refunds = this.connection.getRepository(ctx, Refund);
        await refunds.query('DELETE FROM "order_line_reference" WHERE "refundId" = ANY($1)', [ids]);
        await refunds.delete(ids as never);
    }

    private async followTotal(ctx: RequestContext, order: Order): Promise<void> {
        const payments = await this.orderService.getOrderPayments(ctx, order.id);
        const received = settledAmount({ payments });
        const waiting = payments
            .filter(p => p.state === 'Authorized' && p.method !== COD_METHOD_CODE)
            .reduce((sum, p) => sum + p.amount, 0);
        const due = order.totalWithTax - received - waiting;
        const repository = this.connection.getRepository(ctx, Payment);
        let cod = payments.find(p => p.method === COD_METHOD_CODE && p.state === 'Authorized');
        if (cod && due > 0) {
            await repository.update(cod.id, { amount: due });
        } else if (cod) {
            await this.paymentService.cancelPayment(ctx, cod.id);
        } else if (due > 0) {
            const created = await this.paymentService.createPayment(ctx, order, due, COD_METHOD_CODE, {});
            if (isGraphQlErrorResult(created) || created.state !== 'Authorized') {
                throw refuse('PAYMENT_REFUSED', [
                    isGraphQlErrorResult(created) ? created.message : (created.errorMessage ?? ''),
                ]);
            }
            await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder()
                .relation('payments')
                .of(order)
                .add(created);
            cod = created;
        }
        const settled = payments.filter(p => p.state === 'Settled').sort((a, b) => b.amount - a.amount)[0];
        const target = cod && due > 0 ? cod : (settled ?? cod);
        const modifications = await this.connection
            .getRepository(ctx, OrderModification)
            .find({ where: { order: { id: order.id } }, relations: { payment: true, refund: true } });
        for (const modification of modifications.filter(m => !m.isSettled)) {
            if (!target) throw refuse('PAYMENT_REFUSED');
            await this.connection
                .getRepository(ctx, OrderModification)
                .update(modification.id, { payment: { id: target.id } });
        }
    }

    private snapshot(order: Order): Snapshot {
        const address = order.shippingAddress;
        return {
            lines: order.lines
                .filter(line => line.quantity > 0)
                .map(line => ({
                    name: line.productVariant?.name ?? String(line.productVariantId),
                    quantity: line.quantity,
                    unitPrice: line.unitPriceWithTax,
                })),
            delivery: order.shippingWithTax,
            discount: (order.surcharges ?? [])
                .filter(s => s.sku === MANUAL_DISCOUNT_SKU)
                .reduce((sum, s) => sum - s.priceWithTax, 0),
            total: order.totalWithTax,
            address: [address?.streetLine1, address?.city, address?.province].filter(Boolean).join(', '),
        };
    }
}
