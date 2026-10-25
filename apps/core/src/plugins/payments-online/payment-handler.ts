import { gatewayAcceptsAmount, isOnlineGateway, ONLINE_GATEWAYS, type OnlineGateway } from '@ecommbd/shared';
import {
    type Injector,
    LanguageCode,
    type Order,
    PaymentMethodEligibilityChecker,
    PaymentMethodHandler,
    type RequestContext,
} from '@vendure/core';
import { lockAndCheckStock } from '../bd-catalog';
import { EDIT_REFUND_REASON, PaymentRulesService } from '../payments-bd';
import { ONLINE_CHECKER_CODE, ONLINE_HANDLER_CODE } from './constants';
import { GatewayService } from './gateway.service';
import { newAttemptToken, OnlinePaymentService } from './online-payment.service';
import type { OnlinePaymentMetadata } from './types';

let gateways: GatewayService;
let payments: OnlinePaymentService;
let rules: PaymentRulesService;
let injectorRef: Injector;

const init = (injector: Injector) => {
    injectorRef = injector;
    gateways = injector.get(GatewayService);
    payments = injector.get(OnlinePaymentService);
    rules = injector.get(PaymentRulesService);
};

const gatewayArg = {
    type: 'string' as const,
    defaultValue: 'sslcommerz',
    ui: { component: 'select-form-input', options: ONLINE_GATEWAYS.map(value => ({ value })) },
};

const decline = (ctx: RequestContext, code: string, amount: number) => ({
    amount,
    state: 'Declined' as const,
    errorMessage: ctx.translate(`message.payments-online.${code}`),
    metadata: { public: { errorCode: code } },
});

/**
 * SSLCommerz or bKash (roadmap phase 18). Adding the payment takes no money yet: it's `Pending`
 * with a pay link, and the order waits in AwaitingPayment while the shopper pays on the gateway's
 * page. Only our service settles it, after the gateway confirmed the payment server to server.
 * `purpose: advance` pays only the advance (phase 08's rules), with COD for the rest.
 */
export const onlinePaymentHandler = new PaymentMethodHandler({
    code: ONLINE_HANDLER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Online payment (SSLCommerz or bKash)' },
        { languageCode: LanguageCode.bn, value: 'অনলাইন পেমেন্ট (SSLCommerz বা বিকাশ)' },
    ],
    args: { gateway: gatewayArg },
    init,
    createPayment: async (ctx, order: Order, amount, args, metadata) => {
        const gateway = args.gateway as OnlineGateway;
        if (!isOnlineGateway(gateway) || !payments.publicUrl || !(await gateways.available(ctx, gateway))) {
            return decline(ctx, 'ONLINE_UNAVAILABLE', amount);
        }
        const purpose = metadata.purpose === 'advance' ? 'advance' : 'full';
        let toPay = amount;
        if (purpose === 'advance') {
            const { advanceAmount } = await rules.options(ctx, order);
            if (advanceAmount <= 0) return decline(ctx, 'NO_ADVANCE_NEEDED', amount);
            toPay = Math.min(advanceAmount, amount);
            if (!gatewayAcceptsAmount(gateway, toPay)) return decline(ctx, 'AMOUNT_OUT_OF_RANGE', amount);
        } else {
            // SSLCommerz takes ৳10 to ৳5,00,000 (checkout hides it outside that).
            if (!gatewayAcceptsAmount(gateway, toPay)) return decline(ctx, 'AMOUNT_OUT_OF_RANGE', amount);
            // The full payment places the order: lock and check stock first (phase 05), like COD.
            const short = await lockAndCheckStock(ctx, order, injectorRef);
            if (short.length) {
                return {
                    amount,
                    state: 'Declined' as const,
                    errorMessage: ctx.translate('message.bd-catalog.sold-out', { names: short.join(', ') }),
                    metadata: { public: { errorCode: 'SOLD_OUT' } },
                };
            }
        }
        const token = newAttemptToken();
        const data: OnlinePaymentMetadata = {
            kind: 'gateway',
            gateway,
            purpose,
            firstAttemptToken: token,
            public: { kind: 'gateway', gateway, purpose, payUrl: payments.payUrl(token) },
        };
        return { amount: toPay, state: 'Pending' as const, metadata: data };
    },
    // Only OnlinePaymentService settles, after the gateway confirmed an attempt.
    settlePayment: (_ctx, _order, payment) =>
        (payment.metadata as OnlinePaymentMetadata).paidAttemptId
            ? { success: true }
            : { success: false, errorMessage: 'Online payments are settled when the gateway confirms them' },
    cancelPayment: () => ({ success: true }),
    // Refunds are recorded (staff refunded in the gateway's panel); refunds through the API come in phase 45.
    // A price drop from an order edit on money received stays Pending: a refund due (phase 05).
    createRefund: (_ctx, input) =>
        input.reason === EDIT_REFUND_REASON
            ? (undefined as never)
            : { state: 'Settled' as const, metadata: { reason: input.reason } },
});

/** Offered when the gateway is on, its credentials are saved, and it isn't paused after failures. */
export const onlineEligibilityChecker = new PaymentMethodEligibilityChecker({
    code: ONLINE_CHECKER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Gateway set up and working' },
        { languageCode: LanguageCode.bn, value: 'গেটওয়ে চালু ও কাজ করছে' },
    ],
    args: { gateway: gatewayArg },
    init,
    check: async (ctx, _order, args) => {
        const gateway = args.gateway as OnlineGateway;
        if (!isOnlineGateway(gateway) || !payments.publicUrl) return false;
        const handle = await gateways.handle(ctx, gateway);
        if (!handle) return false;
        return gateways.paused(gateway, handle.mode)
            ? ctx.translate('message.payments-online.TEMPORARILY_UNAVAILABLE')
            : true;
    },
});
