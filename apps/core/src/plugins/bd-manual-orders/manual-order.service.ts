import {
    cleanText,
    CHECKOUT_LIMITS,
    isWholeTaka,
    MANUAL_PAYMENT_METHODS,
    MANUAL_PAYMENT_TYPES,
    type ManualPaymentMethod,
    type ManualPaymentType,
    maxManualDiscount,
    mfsReference,
    normalizeTransactionId,
    ORDER_SOURCES,
    parseBdMobile,
    textLength,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    CustomerService,
    type ID,
    Injector,
    isGraphQlErrorResult,
    Order,
    OrderService,
    Payment,
    PaymentService,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { ModuleRef } from '@nestjs/core';
import { lockAndCheckStock } from '../bd-catalog';
import { channelPrice } from '../bd-catalog/product-form.service';
import { PhoneCustomerService } from '../bd-checkout';
import { BdAddressError, normalizeAddressInput } from '../bd-core';
import { OrderActionsService } from '../bd-orders';
import { MFS_METHOD_CODES, PaymentRulesService, STAFF_METHOD_CODE } from '../payments-bd';
import {
    applyManualDiscountPermission,
    MANUAL_DISCOUNT_SKU,
    overridePricePermission,
    unlimitedDiscountPermission,
} from './constants';
import { BdManualOrderError, Refusal, refuse } from './errors';

export interface ManualOrderLineInput {
    variantId: ID;
    quantity: number;
    /** A price staff set (OverridePrice); omitted: the product's price. */
    unitPrice?: number | null;
}

export interface ManualAddressInput {
    districtId: string;
    thanaId: string;
    area?: string | null;
    streetLine1: string;
    landmark?: string | null;
}

export interface ManualOrderInput {
    customer: { name: string; phone: string; alternatePhone?: string | null };
    address: ManualAddressInput;
    /** Also save this address on the customer. */
    saveAddress?: boolean | null;
    lines: ManualOrderLineInput[];
    /** A fixed discount on the order (ApplyManualDiscount). */
    discount?: number | null;
    /** A delivery charge staff set; omitted: the delivery rules. */
    deliveryCharge?: number | null;
    shippingMethodId?: ID | null;
    payment: { type: string; method?: string | null; transactionId?: string | null; amount?: number | null };
    source: string;
    note?: string | null;
    sendSms?: boolean | null;
    /** Staff already spoke to the customer: create it as Confirmed. */
    confirm?: boolean | null;
}

export interface ManualOrderQuote {
    subTotal: number;
    delivery: number;
    discount: number;
    codFee: number;
    total: number;
    /** Paid now (advance or full) and collected on delivery. */
    paidNow: number;
    codDue: number;
    deliveryOptions: Array<{ id: ID; name: string; price: number }>;
    shippingMethodId: ID | null;
}

/** Thrown to roll a quote's transaction back; carries the quote out. */
class QuoteDone extends Error {
    constructor(readonly quote: ManualOrderQuote) {
        super('quote');
    }
}

const MAX_LINES = 50;
const MAX_QUANTITY = 1000;

/**
 * Orders staff enter for shoppers who ordered by phone, Messenger, a Facebook comment or WhatsApp
 * (roadmap phase 05). Built on Vendure's draft orders, in one transaction: customer by phone,
 * lines (with an optional staff price), the district/thana address, delivery by phase 07's rules
 * (or a charge staff set), a discount, then COD, already paid, or an advance plus COD (phase 08).
 * Anything refused rolls the whole order back. `quote` runs the same steps and rolls back, so the
 * screen shows exactly what will be saved.
 */
@Injectable()
export class ManualOrderService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private paymentService: PaymentService,
        private customerService: CustomerService,
        private moduleRef: ModuleRef,
    ) {}

    // Services of our other plugins, found like Vendure's own injector does (any module).
    private get phoneCustomers() {
        return this.moduleRef.get(PhoneCustomerService, { strict: false });
    }

    private get actions() {
        return this.moduleRef.get(OrderActionsService, { strict: false });
    }

    private get rules() {
        return this.moduleRef.get(PaymentRulesService, { strict: false });
    }

    async create(ctx: RequestContext, input: ManualOrderInput): Promise<Order | BdManualOrderError> {
        const checked = this.check(ctx, input);
        if (checked) return checked;
        const customer = await this.findCustomer(ctx, input);
        if (customer instanceof BdManualOrderError) return customer;
        try {
            const orderId = await this.connection.withTransaction(ctx, async txCtx => {
                const order = await this.build(txCtx, input, customer.id);
                await this.pay(txCtx, order, input);
                if (input.saveAddress) {
                    await this.customerService.createAddress(txCtx, customer.id, this.addressInput(input));
                }
                return order.id;
            });
            if (input.confirm) {
                const confirmed = await this.actions.confirm(ctx, { orderId, ignoreStockWarning: true });
                if (isGraphQlErrorResult(confirmed)) {
                    // The order exists; confirming is a separate step staff can retry.
                    return (await this.orderService.findOne(ctx, orderId))!;
                }
            }
            return (await this.orderService.findOne(ctx, orderId))!;
        } catch (error) {
            if (error instanceof Refusal) return error.error;
            throw error;
        }
    }

    /** What the order will cost, without saving anything. */
    async quote(
        ctx: RequestContext,
        input: ManualOrderInput,
    ): Promise<ManualOrderQuote | BdManualOrderError> {
        const checked = this.check(ctx, input, { quote: true });
        if (checked) return checked;
        const phone = this.phone(input);
        const existing = phone ? await this.phoneCustomers.findByPhone(ctx, phone) : null;
        try {
            await this.connection.withTransaction(ctx, async txCtx => {
                const order = await this.build(txCtx, input, existing?.id ?? null);
                const options = await this.rules.options(txCtx, order);
                const paidNow =
                    input.payment.type === 'paid'
                        ? order.totalWithTax
                        : input.payment.type === 'advance'
                          ? Math.min(input.payment.amount ?? 0, order.totalWithTax)
                          : 0;
                const discount = (order.surcharges ?? [])
                    .filter(s => s.sku === MANUAL_DISCOUNT_SKU)
                    .reduce((sum, s) => sum - s.priceWithTax, 0);
                const eligible = await this.orderService.getEligibleShippingMethods(txCtx, order.id);
                throw new QuoteDone({
                    subTotal: order.subTotalWithTax,
                    delivery: order.shippingWithTax,
                    discount,
                    codFee: input.payment.type === 'paid' ? 0 : options.codFee,
                    total: order.totalWithTax,
                    paidNow,
                    codDue: order.totalWithTax - paidNow,
                    deliveryOptions: eligible.map(m => ({ id: m.id, name: m.name, price: m.priceWithTax })),
                    shippingMethodId: order.shippingLines[0]?.shippingMethodId ?? null,
                });
            });
        } catch (error) {
            if (error instanceof QuoteDone) return error.quote;
            if (error instanceof Refusal) return error.error;
            throw error;
        }
        throw new Error('Quote did not finish');
    }

    /** Input checks that need no database. */
    private check(ctx: RequestContext, input: ManualOrderInput, options: { quote?: boolean } = {}) {
        // A quote runs while staff are still typing: the phone may not be complete yet.
        if (!options.quote && !this.phone(input)) return new BdManualOrderError('INVALID_PHONE');
        const name = cleanText(input.customer.name ?? '');
        if (!options.quote && (!name || textLength(name) > CHECKOUT_LIMITS.name)) {
            return new BdManualOrderError('NAME_REQUIRED');
        }
        if (!input.lines.length || input.lines.length > MAX_LINES) return new BdManualOrderError('NO_ITEMS');
        for (const line of input.lines) {
            if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
                return new BdManualOrderError('INVALID_QUANTITY');
            }
            if (line.unitPrice != null) {
                if (!ctx.userHasPermissions([overridePricePermission.Permission as never])) {
                    return new BdManualOrderError('PRICE_OVERRIDE_NOT_ALLOWED');
                }
                if (
                    !Number.isSafeInteger(line.unitPrice) ||
                    line.unitPrice < 0 ||
                    !isWholeTaka(line.unitPrice)
                ) {
                    return new BdManualOrderError('INVALID_PRICE');
                }
            }
        }
        const money = (value: number | null | undefined) =>
            value == null || (Number.isSafeInteger(value) && value >= 0 && isWholeTaka(value));
        if (!money(input.discount) || !money(input.deliveryCharge))
            return new BdManualOrderError('INVALID_PRICE');
        if (input.discount && !ctx.userHasPermissions([applyManualDiscountPermission.Permission as never])) {
            return new BdManualOrderError('DISCOUNT_NOT_ALLOWED');
        }
        if (
            input.deliveryCharge != null &&
            !ctx.userHasPermissions([overridePricePermission.Permission as never])
        ) {
            return new BdManualOrderError('PRICE_OVERRIDE_NOT_ALLOWED');
        }
        if (!(ORDER_SOURCES as readonly string[]).includes(input.source))
            return new BdManualOrderError('INVALID_SOURCE');
        const { type, method, amount } = input.payment;
        if (!(MANUAL_PAYMENT_TYPES as readonly string[]).includes(type))
            return new BdManualOrderError('INVALID_PAYMENT');
        if (type !== 'cod' && !(MANUAL_PAYMENT_METHODS as readonly string[]).includes(method ?? '')) {
            return new BdManualOrderError('INVALID_PAYMENT');
        }
        if (
            type === 'advance' &&
            !(amount && amount > 0 && Number.isSafeInteger(amount) && isWholeTaka(amount))
        ) {
            return new BdManualOrderError('INVALID_PAYMENT');
        }
        if (textLength(cleanText(input.note ?? '', { multiline: true })) > CHECKOUT_LIMITS.note) {
            return new BdManualOrderError('INVALID_ADDRESS', ['note']);
        }
        return null;
    }

    private phone(input: ManualOrderInput): string | null {
        const parsed = parseBdMobile(input.customer.phone ?? '');
        return parsed.ok ? parsed.phone.e164 : null;
    }

    /** Outside the order's transaction (phase 03): a new phone creates its customer on its own. */
    private async findCustomer(ctx: RequestContext, input: ManualOrderInput) {
        const alternate = input.customer.alternatePhone?.trim();
        let alternatePhone: string | null = null;
        if (alternate) {
            const parsed = parseBdMobile(alternate);
            if (!parsed.ok) return new BdManualOrderError('INVALID_PHONE', ['alternatePhone']);
            alternatePhone = parsed.phone.e164;
        }
        const { customer } = await this.phoneCustomers.findOrCreate(ctx, {
            name: cleanText(input.customer.name),
            phone: this.phone(input)!,
            alternatePhone,
            source: 'manual',
        });
        return customer;
    }

    private addressInput(input: ManualOrderInput) {
        try {
            return normalizeAddressInput({
                fullName: cleanText(input.customer.name).slice(0, CHECKOUT_LIMITS.name) || undefined,
                phoneNumber: this.phone(input) ?? undefined,
                streetLine1: cleanText(input.address.streetLine1).slice(0, 255),
                countryCode: 'BD',
                customFields: {
                    districtId: input.address.districtId,
                    thanaId: input.address.thanaId,
                    area: input.address.area ?? null,
                    landmark: input.address.landmark ?? null,
                    alternatePhone: input.customer.alternatePhone ?? null,
                },
            });
        } catch (error) {
            if (error instanceof BdAddressError) throw refuse('INVALID_ADDRESS', [error.code]);
            throw error;
        }
    }

    /** Draft order with lines, customer, address, delivery and discount, ready for payment. */
    private async build(ctx: RequestContext, input: ManualOrderInput, customerId: ID | null): Promise<Order> {
        const address = this.addressInput(input);
        if (!cleanText(input.address.streetLine1)) throw refuse('INVALID_ADDRESS', ['streetLine1']);
        const draft = await this.orderService.createDraft(ctx);
        const variants = this.connection.getRepository(ctx, ProductVariant);
        for (const line of input.lines) {
            const variant = await variants.findOne({
                where: { id: line.variantId },
                relations: { productVariantPrices: true },
            });
            if (!variant || variant.deletedAt) throw refuse('UNKNOWN_PRODUCT');
            const customFields =
                line.unitPrice != null
                    ? { priceOverride: line.unitPrice, originalUnitPrice: channelPrice(ctx, variant) }
                    : {};
            const added = await this.orderService.addItemToOrder(
                ctx,
                draft.id,
                line.variantId,
                line.quantity,
                customFields,
            );
            if (isGraphQlErrorResult(added)) {
                throw refuse(
                    added.errorCode === 'INSUFFICIENT_STOCK_ERROR' ? 'INSUFFICIENT_STOCK' : 'UNKNOWN_PRODUCT',
                    [added.message],
                );
            }
        }
        if (customerId) {
            const customer = await this.customerService.findOne(ctx, customerId);
            await this.orderService.addCustomerToOrder(ctx, draft.id, customer!);
        }
        await this.connection.getRepository(ctx, Order).update(draft.id, {
            customFields: {
                source: input.source,
                sendSms: input.sendSms ?? true,
                deliveryChargeOverride: input.deliveryCharge ?? null,
                customerNote: cleanText(input.note ?? '', { multiline: true }) || null,
                locale: 'bn',
                paymentChoice: input.payment.type === 'paid' ? 'prepaid' : 'cod',
            },
        });
        await this.orderService.setShippingAddress(ctx, draft.id, address);
        const eligible = await this.orderService.getEligibleShippingMethods(ctx, draft.id);
        if (!eligible.length) throw refuse('NO_DELIVERY');
        const method = input.shippingMethodId
            ? eligible.find(m => String(m.id) === String(input.shippingMethodId))
            : eligible[0];
        if (!method) throw refuse('NO_DELIVERY');
        const shipped = await this.orderService.setShippingMethod(ctx, draft.id, [method.id]);
        if (isGraphQlErrorResult(shipped)) throw refuse('NO_DELIVERY', [shipped.message]);
        if (input.discount) {
            const cap = maxManualDiscount(
                shipped.subTotalWithTax,
                ctx.userHasPermissions([unlimitedDiscountPermission.Permission as never]),
            );
            if (input.discount > cap || input.discount > shipped.subTotalWithTax) {
                throw refuse('DISCOUNT_TOO_LARGE', [String(Math.min(cap, shipped.subTotalWithTax))]);
            }
            await this.orderService.addSurchargeToOrder(ctx, draft.id, {
                description: 'ছাড় / Discount',
                sku: MANUAL_DISCOUNT_SKU,
                listPrice: -input.discount,
                listPriceIncludesTax: true,
                taxLines: [],
            });
        }
        const order = (await this.orderService.findOne(ctx, draft.id))!;
        return this.rules.syncCodFee(ctx, order);
    }

    private async pay(ctx: RequestContext, order: Order, input: ManualOrderInput) {
        const ready = await this.orderService.transitionToState(ctx, order.id, 'ArrangingPayment');
        if (isGraphQlErrorResult(ready)) throw refuse('INVALID_ADDRESS', [ready.transitionError]);
        // No payment method checks stock for staff payments, so lock and check here (phase 05).
        const injector = new Injector(this.moduleRef);
        const short = await lockAndCheckStock(ctx, ready, injector);
        if (short.length) throw refuse('INSUFFICIENT_STOCK', short);
        const { type } = input.payment;
        if (type === 'paid' || type === 'advance') {
            const fresh = (await this.orderService.findOne(ctx, order.id))!;
            const amount =
                type === 'paid' ? fresh.totalWithTax : Math.min(input.payment.amount!, fresh.totalWithTax);
            await this.manualPayment(ctx, fresh, amount, input);
        }
        const now = (await this.orderService.findOne(ctx, order.id))!;
        if (now.state === 'ArrangingPayment') {
            const cod = await this.orderService.addPaymentToOrder(ctx, order.id, {
                method: 'bd-cod',
                metadata: {},
            });
            if (isGraphQlErrorResult(cod)) {
                throw refuse('PAYMENT_REFUSED', [
                    'paymentErrorMessage' in cod ? String(cod.paymentErrorMessage) : cod.message,
                ]);
            }
            if (cod.state === 'ArrangingPayment') throw refuse('PAYMENT_REFUSED');
        }
    }

    /** Money staff already received (they checked it): a settled payment, its TrxID unique like the shop's. */
    private async manualPayment(ctx: RequestContext, order: Order, amount: number, input: ManualOrderInput) {
        const method = input.payment.method as ManualPaymentMethod;
        const isMfs = method === 'bkash' || method === 'nagad' || method === 'rocket';
        let transactionId = cleanText(input.payment.transactionId ?? '').slice(0, 40) || undefined;
        let reference: string | null = null;
        if (isMfs) {
            const normalized = normalizeTransactionId(transactionId ?? '');
            if (!normalized) throw refuse('INVALID_TRANSACTION_ID');
            transactionId = normalized;
            reference = mfsReference(method, normalized);
            const used = await this.connection
                .getRepository(ctx, Payment)
                .count({ where: { customFields: { mfsReference: reference } } });
            if (used) throw refuse('DUPLICATE_TRANSACTION_ID');
        }
        const payment = await this.paymentService.createManualPayment(ctx, order, amount, {
            orderId: order.id,
            // Cash and bank go under "Recorded by staff", so they can be refunded like the others.
            method: isMfs ? MFS_METHOD_CODES[method] : STAFF_METHOD_CODE,
            transactionId,
            metadata: {
                manual: true,
                method,
                verification: 'verified',
                purpose: amount < order.totalWithTax ? 'advance' : 'full',
                public: { provider: method, verification: 'verified' },
            },
        });
        if (reference) {
            await this.connection
                .getRepository(ctx, Payment)
                .update(payment.id, { customFields: { mfsReference: reference } });
        }
    }
}

export type { ManualPaymentType };
