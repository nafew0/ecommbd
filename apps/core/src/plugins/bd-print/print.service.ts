import {
    bdPaymentType,
    PRINT_BATCH_SIZE,
    PRINT_DOCUMENTS,
    type PrintDocument,
    type PrintSettings,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    AssetService,
    type ID,
    Order,
    PaymentMethodService,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
    UserInputError,
} from '@vendure/core';
import { In, IsNull, Not } from 'typeorm';
import { StoreSettingsService } from '../bd-core';
import { shipmentInfo } from '../bd-orders/shipment-info';
import { PRINTED_FIELD } from './custom-fields';
import { PrintSettingsService } from './print-settings.service';

export interface PrintLine {
    name: string;
    sku: string;
    quantity: number;
    /** Null on packing slips: they never carry prices. */
    unitPrice: number | null;
    linePrice: number | null;
}

/** One order, exactly as the print views show it. */
export interface PrintOrder {
    id: ID;
    code: string;
    orderNumber: string;
    placedAt: Date | null;
    customerName: string;
    phone: string | null;
    alternatePhone: string | null;
    streetLine1: string;
    area: string | null;
    districtId: string | null;
    thanaId: string | null;
    landmark: string | null;
    note: string | null;
    lines: PrintLine[];
    /** Money is null on packing slips. */
    subtotal: number | null;
    discount: number | null;
    delivery: number | null;
    total: number | null;
    paid: number | null;
    codDue: number | null;
    paymentType: string;
    paymentMethods: string[];
    /** When this document was last printed for the order; null the first time. */
    printedAt: Date | null;
    /** The courier's consignment ID, once phase 19 books one. */
    courierConsignment: string | null;
}

export interface PrintData {
    document: PrintDocument;
    orders: PrintOrder[];
    store: {
        name: { bn: string; en: string };
        phones: string[];
        addressLine: string;
        area: string;
        districtId: string;
        thanaId: string;
        logo: unknown;
        returnPolicy: { bn: string; en: string };
    };
    settings: PrintSettings;
}

/** The first paragraph of a policy, short enough for an invoice footer. */
function summary(text: string, max = 240): string {
    const first = text.split(/\n\s*\n/)[0]!.trim();
    return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/**
 * What the print views need (roadmap phase 06): placed orders in the order asked for, the store's
 * name, contacts and logo, and the print settings. Packing slips get no money at all from here, so
 * a role that prints them never receives prices through this query.
 */
@Injectable()
export class PrintService {
    constructor(
        private connection: TransactionalConnection,
        private translator: TranslatorService,
        private paymentMethods: PaymentMethodService,
        private storeSettings: StoreSettingsService,
        private assets: AssetService,
        private settings: PrintSettingsService,
    ) {}

    async data(ctx: RequestContext, orderIds: ID[], document: string): Promise<PrintData> {
        const doc = this.checkInput(orderIds, document);
        const orders = await this.connection.getRepository(ctx, Order).find({
            where: { id: In(orderIds), orderPlacedAt: Not(IsNull()), channels: { id: ctx.channelId } },
            relations: { lines: { productVariant: { translations: true } }, payments: true },
        });
        const byId = new Map(orders.map(order => [String(order.id), order]));
        const methodNames = await this.methodNames(ctx);
        const store = await this.storeSettings.get(ctx);
        const { profile, policies } = store;
        const printed = orderIds
            .map(id => byId.get(String(id)))
            .filter((order): order is Order => !!order)
            .map(order => this.toPrintOrder(ctx, order, doc, methodNames));
        // The courier's consignment ID once booked (phase 19), for the sticker's barcode.
        for (const order of printed) {
            order.courierConsignment = (await shipmentInfo(ctx, order.id))?.consignmentId ?? null;
        }
        return {
            document: doc,
            orders: printed,
            store: {
                name: profile.storeName,
                phones: profile.phones,
                addressLine: profile.address.line,
                area: profile.address.area,
                districtId: profile.address.districtId,
                thanaId: profile.address.thanaId,
                logo: profile.logoAssetId
                    ? ((await this.assets.findOne(ctx, profile.logoAssetId)) ?? null)
                    : null,
                returnPolicy: {
                    bn: summary(policies.returnPolicy.bn),
                    en: summary(policies.returnPolicy.en),
                },
            },
            settings: await this.settings.get(ctx),
        };
    }

    /** Records that a document was printed, so the next print says "Reprint". Returns how many orders. */
    async markPrinted(ctx: RequestContext, orderIds: ID[], document: string): Promise<number> {
        const doc = this.checkInput(orderIds, document);
        const result = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .update(Order)
            .set({ customFields: { [PRINTED_FIELD[doc]]: new Date() } } as never)
            .where('id IN (:...ids)', { ids: orderIds })
            .andWhere('"orderPlacedAt" IS NOT NULL')
            .execute();
        return result.affected ?? 0;
    }

    private checkInput(orderIds: ID[], document: string): PrintDocument {
        if (!(PRINT_DOCUMENTS as readonly string[]).includes(document)) {
            throw new UserInputError('error.bd-print.unknown-document');
        }
        if (orderIds.length === 0 || orderIds.length > PRINT_BATCH_SIZE) {
            throw new UserInputError('error.bd-print.batch-size', { max: PRINT_BATCH_SIZE });
        }
        return document as PrintDocument;
    }

    private toPrintOrder(
        ctx: RequestContext,
        order: Order,
        document: PrintDocument,
        methodNames: Map<string, string>,
    ): PrintOrder {
        const money = document !== 'slip';
        const address = order.shippingAddress ?? {};
        const fields = (address.customFields ?? {}) as Record<string, string | null | undefined>;
        const settled = (order.payments ?? []).filter(payment => payment.state === 'Settled');
        const paid = settled.reduce((sum, payment) => sum + payment.amount, 0);
        const lines = order.lines.filter(line => line.quantity > 0);
        const subtotal = lines.reduce((sum, line) => sum + line.linePriceWithTax, 0);
        return {
            id: order.id,
            code: order.code,
            orderNumber: order.customFields.orderNumber ?? order.code,
            placedAt: order.orderPlacedAt ?? null,
            customerName: address.fullName ?? '',
            phone: address.phoneNumber ?? null,
            alternatePhone: fields.alternatePhone ?? null,
            streetLine1: address.streetLine1 ?? '',
            area: fields.area ?? null,
            districtId: fields.districtId ?? null,
            thanaId: fields.thanaId ?? null,
            landmark: fields.landmark ?? null,
            note: order.customFields.customerNote ?? null,
            lines: lines.map(line => ({
                name: this.translator.translate(line.productVariant, ctx).name,
                sku: line.productVariant.sku,
                quantity: line.quantity,
                unitPrice: money ? line.unitPriceWithTax : null,
                linePrice: money ? line.linePriceWithTax : null,
            })),
            subtotal: money ? subtotal : null,
            discount: money ? Math.max(0, subtotal - order.subTotalWithTax) : null,
            delivery: money ? order.shippingWithTax : null,
            total: money ? order.totalWithTax : null,
            paid: money ? paid : null,
            codDue: money ? Math.max(0, order.totalWithTax - paid) : null,
            paymentType: bdPaymentType(order.totalWithTax, paid),
            paymentMethods: [
                ...new Set(settled.map(payment => methodNames.get(payment.method) ?? payment.method)),
            ],
            printedAt: order.customFields[PRINTED_FIELD[document]] ?? null,
            courierConsignment: null,
        };
    }

    private async methodNames(ctx: RequestContext): Promise<Map<string, string>> {
        const { items } = await this.paymentMethods.findAll(ctx, { take: 100 });
        return new Map(items.map(method => [method.code, method.name]));
    }
}
