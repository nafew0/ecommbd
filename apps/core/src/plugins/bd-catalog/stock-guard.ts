import {
    type Injector,
    type Order,
    type OrderProcess,
    ProductVariant,
    ProductVariantService,
    type RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';

/** The moments an order takes stock: payment completes it. */
// AwaitingPayment: placed while an online payment is pending (phase 18).
const PLACING = new Set(['PaymentAuthorized', 'PaymentSettled', 'AwaitingPayment']);

/**
 * No overselling (roadmap phase 05). Vendure 3.8 checks stock when items are added to a cart, but
 * not again when the order is placed: 50 shoppers paying at once for 10 units all got their order
 * (stock.e2e-spec.ts). This locks each variant's stock rows (in ID order, so two orders can't
 * deadlock) and re-checks what's saleable. The lock lasts until the transaction commits, and
 * Vendure allocates the stock in that transaction, so the next buyer waits and sees the real number.
 * Backorders (a negative out-of-stock threshold) and untracked stock pass, as Vendure counts them.
 *
 * Returns the names of the items short of stock (empty when all is well).
 */
export async function lockAndCheckStock(
    ctx: RequestContext,
    order: Order,
    injector: Injector,
): Promise<string[]> {
    const wanted = new Map<string, number>();
    for (const line of order.lines ?? []) {
        const id = String(line.productVariantId);
        wanted.set(id, (wanted.get(id) ?? 0) + line.quantity);
    }
    if (!wanted.size) return [];
    const variants = injector.get(ProductVariantService);
    const rows = await injector
        .get(TransactionalConnection)
        .getRepository(ctx, ProductVariant)
        .find({
            where: { id: In([...wanted.keys()]) },
            relations: { translations: true },
            order: { id: 'ASC' },
        });
    const short: string[] = [];
    for (const variant of rows) {
        const saleable = await variants.getSaleableStockLevel(ctx, variant, { lockStockLevels: true });
        if ((wanted.get(String(variant.id)) ?? 0) > saleable) {
            short.push(
                variant.translations.find(t => t.languageCode === ctx.languageCode)?.name ??
                    variant.translations[0]?.name ??
                    variant.sku,
            );
        }
    }
    return short;
}

let injectorRef: Injector;

/**
 * The same check as a last line of defence when an order is placed by any payment method. Our COD
 * and mobile banking payments check first (and decline with "just sold out"), because a refusal
 * here leaves the shopper's payment on an unplaced order.
 */
export const stockGuardProcess: OrderProcess<never> = {
    init(injector) {
        injectorRef = injector;
    },

    async onTransitionStart(fromState, toState, { ctx, order }) {
        if (!PLACING.has(toState) || (fromState !== 'ArrangingPayment' && fromState !== 'Draft')) {
            return;
        }
        const short = await lockAndCheckStock(ctx, order, injectorRef);
        if (short.length) {
            return ctx.translate('message.bd-catalog.sold-out', { names: short.join(', ') });
        }
    },
};
