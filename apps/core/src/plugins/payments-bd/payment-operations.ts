import { MFS_PROVIDERS, type MfsProvider, mfsReference } from '@ecommbd/shared';
import {
    type Injector,
    LanguageCode,
    Payment,
    PaymentMethodEligibilityChecker,
    type PaymentProcess,
    TransactionalConnection,
} from '@vendure/core';
import { COD_CHECKER_CODE, MFS_CHECKER_CODE } from './constants';
import { shopperCode } from './payment-handlers';
import { isMfs, PaymentRulesService } from './payment-rules.service';
import { PaymentSettingsService } from './payment-settings.service';
import type { MfsPaymentMetadata } from './types';

let rules: PaymentRulesService;
let settings: PaymentSettingsService;
let connection: TransactionalConnection;

const init = (injector: Injector) => {
    rules = injector.get(PaymentRulesService);
    settings = injector.get(PaymentSettingsService);
    connection = injector.get(TransactionalConnection);
};

/**
 * COD is offered when it's on, under the order limit, in an allowed zone, and the phone isn't
 * blocked. Otherwise the reason, in the shopper's language (Vendure's `eligibilityMessage`).
 */
export const codEligibilityChecker = new PaymentMethodEligibilityChecker({
    code: COD_CHECKER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Cash on delivery rules' },
        { languageCode: LanguageCode.bn, value: 'ক্যাশ অন ডেলিভারির নিয়ম' },
    ],
    args: {},
    init,
    check: async (ctx, order) => {
        const options = await rules.options(ctx, order);
        return (
            options.codAvailable ||
            ctx.translate(`message.payments-bd.${shopperCode(options.codUnavailableReason)}`)
        );
    },
});

/** A mobile banking method is offered once the merchant has turned it on with their number. */
export const mfsEligibilityChecker = new PaymentMethodEligibilityChecker({
    code: MFS_CHECKER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Mobile banking number entered' },
        { languageCode: LanguageCode.bn, value: 'মোবাইল ব্যাংকিং নম্বর দেওয়া আছে' },
    ],
    args: {
        provider: {
            type: 'string',
            defaultValue: 'bkash',
            ui: { component: 'select-form-input', options: MFS_PROVIDERS.map(value => ({ value })) },
        },
    },
    init,
    check: async (ctx, _order, args) => {
        const account = (await settings.get(ctx)).mfs[args.provider as MfsProvider];
        return !!account?.enabled && !!account.number;
    },
});

/**
 * Additions to Vendure's payment process: staff may reject (decline) a mobile banking payment that
 * is waiting for them, and an accepted one records its unique `provider:TrxID` key, so the same
 * transaction can never pay a second order (unique column; a race fails one of the two).
 */
export const bdPaymentProcess: PaymentProcess<never> = {
    transitions: {
        Authorized: { to: ['Declined'] },
    },
    init,
    onTransitionStart(fromState, toState, { payment }) {
        if (fromState === 'Authorized' && toState === 'Declined' && !isMfs(payment.method)) {
            return 'Only mobile banking payments can be rejected';
        }
    },
    async onTransitionEnd(fromState, toState, { ctx, payment }) {
        if (fromState !== 'Created' || toState !== 'Authorized' || !isMfs(payment.method)) {
            return;
        }
        const metadata = payment.metadata as MfsPaymentMetadata;
        await connection.getRepository(ctx, Payment).update(payment.id, {
            customFields: {
                mfsReference: mfsReference(metadata.provider as MfsProvider, metadata.transactionId),
            },
        });
    },
};
