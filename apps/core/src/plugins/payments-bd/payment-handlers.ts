import {
    MFS_PROVIDERS,
    type MfsProvider,
    mfsReference,
    normalizeTransactionId,
    parseBdMobile,
} from '@ecommbd/shared';
import {
    type Injector,
    LanguageCode,
    type Order,
    Payment,
    PaymentMethodHandler,
    type RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { lockAndCheckStock } from '../bd-catalog';
import { CheckoutRateLimiter } from '../bd-checkout';
import { COD_HANDLER_CODE, EDIT_REFUND_REASON, MFS_HANDLER_CODE, STAFF_HANDLER_CODE } from './constants';
import type { ShopperPaymentMessage } from './i18n';
import { type CodUnavailableReason, PaymentRulesService } from './payment-rules.service';
import { PaymentSettingsService } from './payment-settings.service';
import type { MfsPaymentMetadata } from './types';

let rules: PaymentRulesService;
let settings: PaymentSettingsService;
let connection: TransactionalConnection;
let rateLimiter: CheckoutRateLimiter | undefined;
let injectorRef: Injector;

const init = (injector: Injector) => {
    injectorRef = injector;
    rules = injector.get(PaymentRulesService);
    settings = injector.get(PaymentSettingsService);
    connection = injector.get(TransactionalConnection);
    // From bd-checkout; Vendure's injector finds providers of other plugins.
    rateLimiter = injector.get(CheckoutRateLimiter);
};

const MINUTE = 60_000;
/** TrxID submissions: plenty for typos, too few to guess IDs. */
const TRX_RATE_LIMITS = {
    perSession: { limit: 10, windowMs: 10 * MINUTE },
    perPhone: { limit: 10, windowMs: 60 * MINUTE },
};

/**
 * A refused payment: Vendure returns `PaymentDeclinedError` with the sentence in the shopper's
 * language; the code is in the payment's public metadata.
 */
const decline = (ctx: RequestContext, code: ShopperPaymentMessage, amount: number) => ({
    amount,
    state: 'Declined' as const,
    errorMessage: ctx.translate(`message.payments-bd.${code}`),
    metadata: { public: { errorCode: code } },
});

/**
 * A payment that places the order first locks and re-checks stock (phase 05): the one who comes
 * second for the last unit is declined with "just sold out", before any payment exists.
 */
async function soldOut(ctx: RequestContext, order: Order, amount: number) {
    const short = await lockAndCheckStock(ctx, order, injectorRef);
    if (!short.length) return null;
    return {
        amount,
        state: 'Declined' as const,
        errorMessage: ctx.translate('message.bd-catalog.sold-out', { names: short.join(', ') }),
        metadata: { public: { errorCode: 'SOLD_OUT' } },
    };
}

/**
 * Refunds on our payments. Staff record money they already sent back (phase 08): Settled. A price
 * drop from an order edit (phase 05): Pending ("refund due") on money received; on money not
 * collected yet it only means less to collect (the edit removes that refund again).
 */
function refundOf(input: { reason?: string | null }, payment: Payment) {
    if (input.reason === EDIT_REFUND_REASON) {
        // Vendure creates every refund as Pending and keeps it so when the handler returns nothing.
        return payment.state === 'Settled'
            ? (undefined as never)
            : { state: 'Settled' as const, metadata: { notCollected: true } };
    }
    return { state: 'Settled' as const, metadata: { reason: input.reason } };
}

/** Shoppers never learn that their phone is blocked: that reads as "not available for this order". */
export function shopperCode(reason: CodUnavailableReason | null): ShopperPaymentMessage {
    return !reason || reason === 'COD_BLOCKED' ? 'COD_UNAVAILABLE' : reason;
}

/**
 * Cash on delivery: authorized at checkout for what's left to pay (all of it, or the rest after an
 * advance), settled when the order is delivered, cancelled with the order.
 */
export const codPaymentHandler = new PaymentMethodHandler({
    code: COD_HANDLER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Cash on delivery' },
        { languageCode: LanguageCode.bn, value: 'ক্যাশ অন ডেলিভারি' },
    ],
    args: {},
    init,
    createPayment: async (ctx, order, amount) => {
        const options = await rules.options(ctx, order);
        if (!options.codAvailable) {
            return decline(ctx, shopperCode(options.codUnavailableReason), amount);
        }
        const fee = (await rules.feeSurcharges(ctx, order)).reduce((sum, s) => sum + s.priceWithTax, 0);
        if (fee !== (await rules.expectedFee(ctx, order))) {
            return decline(ctx, 'COD_FEE_CHANGED', amount);
        }
        // Staff entering an order (phase 05) decide the advance themselves; the rule is for shoppers.
        if (
            ctx.apiType === 'shop' &&
            options.advanceAmount > 0 &&
            (await rules.mfsCovered(ctx, order)) < options.advanceAmount
        ) {
            return decline(ctx, 'ADVANCE_REQUIRED', amount);
        }
        return (
            (await soldOut(ctx, order, amount)) ?? {
                amount,
                state: 'Authorized' as const,
                metadata: { public: { kind: 'cod' } },
            }
        );
    },
    settlePayment: () => ({ success: true }),
    cancelPayment: () => ({ success: true }),
    // Money given back after delivery (returns): staff record how they paid it back.
    createRefund: (_ctx, input, _amount, _order, payment) => refundOf(input, payment),
});

/**
 * bKash, Nagad or Rocket "Send Money" to the merchant's own number. The shopper gives the sender
 * number and transaction ID; the payment then waits, Authorized, for staff to check their statement
 * (`metadata.verification`: pending, verified, rejected). Verifying settles it; rejecting declines it.
 * It stays Authorized while pending so the order is placed (Vendure counts only Authorized and
 * Settled payments); `paidAmount` counts only verified money.
 */
export const manualMfsPaymentHandler = new PaymentMethodHandler({
    code: MFS_HANDLER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Mobile banking (Send Money), checked by staff' },
        { languageCode: LanguageCode.bn, value: 'মোবাইল ব্যাংকিং (সেন্ড মানি), স্টাফ যাচাই করবেন' },
    ],
    args: {
        provider: {
            type: 'string',
            defaultValue: 'bkash',
            ui: { component: 'select-form-input', options: MFS_PROVIDERS.map(value => ({ value })) },
        },
    },
    init,
    createPayment: async (ctx, order, amount, args, metadata) => {
        const provider = args.provider as MfsProvider;
        const current = await settings.get(ctx);
        if (
            !MFS_PROVIDERS.includes(provider) ||
            !current.mfs[provider].enabled ||
            !current.mfs[provider].number
        ) {
            return decline(ctx, 'MFS_OFF', amount);
        }
        const limited = await rateLimited(ctx, order);
        if (limited) {
            return decline(ctx, 'RATE_LIMITED', amount);
        }
        const sender = parseBdMobile(String(metadata.senderNumber ?? ''));
        if (!sender.ok) {
            return decline(ctx, 'INVALID_SENDER', amount);
        }
        const transactionId = normalizeTransactionId(String(metadata.transactionId ?? ''));
        if (!transactionId) {
            return decline(ctx, 'INVALID_TRANSACTION_ID', amount);
        }
        const reference = mfsReference(provider, transactionId);
        const used = await connection
            .getRepository(ctx, Payment)
            .count({ where: { customFields: { mfsReference: reference } } });
        if (used > 0) {
            return decline(ctx, 'DUPLICATE_TRANSACTION_ID', amount);
        }
        const purpose = metadata.purpose === 'advance' ? 'advance' : 'full';
        let toPay = amount;
        if (purpose === 'advance') {
            const { advanceAmount } = await rules.options(ctx, order);
            if (advanceAmount <= 0) {
                return decline(ctx, 'NO_ADVANCE_NEEDED', amount);
            }
            toPay = Math.min(advanceAmount, amount);
        } else {
            const refused = await soldOut(ctx, order, amount);
            if (refused) return refused;
        }
        const data: MfsPaymentMetadata = {
            provider,
            senderNumber: sender.phone.e164,
            transactionId,
            purpose,
            verification: 'pending',
            expectedAmount: toPay,
            public: { provider, transactionId, verification: 'pending' },
        };
        return { amount: toPay, state: 'Authorized' as const, transactionId, metadata: data };
    },
    // Only our "Verify payments" screen settles these, after a person checked the statement.
    settlePayment: (_ctx, _order, payment) =>
        (payment.metadata as MfsPaymentMetadata).verification === 'verified'
            ? { success: true }
            : { success: false, errorMessage: 'Verify this payment in the Verify payments screen' },
    cancelPayment: () => ({ success: true }),
    createRefund: (_ctx, input, _amount, _order, payment) => refundOf(input, payment),
});

async function rateLimited(ctx: RequestContext, order: Order): Promise<boolean> {
    if (!rateLimiter || !ctx.apiType || ctx.apiType !== 'shop') {
        return false;
    }
    const session = ctx.session?.token;
    const phone = order.customer?.customFields?.phone ?? order.shippingAddress?.phoneNumber;
    const bySession = session
        ? await rateLimiter.hit(`trx:session:${session}`, TRX_RATE_LIMITS.perSession)
        : 0;
    const byPhone = phone ? await rateLimiter.hit(`trx:phone:${phone}`, TRX_RATE_LIMITS.perPhone) : 0;
    return bySession > 0 || byPhone > 0;
}

/**
 * Money staff received themselves and record on a manual order (cash, bank transfer), phase 05.
 * Staff payments are created as already settled (Vendure's manual payments), so this is never
 * asked to take money; it exists so such payments can be refunded like the others.
 */
export const staffPaymentHandler = new PaymentMethodHandler({
    code: STAFF_HANDLER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Recorded by staff (cash, bank)' },
        { languageCode: LanguageCode.bn, value: 'স্টাফের লেখা পেমেন্ট (নগদ, ব্যাংক)' },
    ],
    args: {},
    createPayment: (ctx, _order, amount) => decline(ctx, 'MFS_OFF', amount),
    settlePayment: () => ({ success: true }),
    createRefund: (_ctx, input, _amount, _order, payment) => refundOf(input, payment),
});
