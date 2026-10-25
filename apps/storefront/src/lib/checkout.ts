import { isValidIdempotencyKey } from '@ecommbd/shared/idempotency';
import type { TadaDocumentNode } from 'gql.tada';
import { activeOrder, type CartOrder, type ShopperContext } from './cart';
import {
    ADD_PAYMENT,
    type CHECKOUT_SETTINGS,
    type DISTRICTS,
    PAYMENT_OPTIONS,
    REMOVE_LINE,
    SAVE_PROGRESS,
    SEND_OTP,
    SET_ADDRESS,
    SET_ATTRIBUTION,
    SET_CUSTOMER,
    SET_META_BROWSER,
    SET_PARTIAL_ADDRESS,
    SET_PAYMENT_CHOICE,
    SET_SHIPPING,
    SHIPPING_OPTIONS,
    SKIP_OTP,
    type THANAS,
    TO_STATE,
    VERIFY_OTP,
} from './checkout-queries';
import { CoreQueryError, type ResultOf, shopQuery } from './core';
import { secondsSinceStamp } from './csrf';
import type { Strings } from './i18n';
import { idempotencyStore } from './idempotency';

/**
 * The checkout (roadmap phase 14): reading the form, the live summary, and placing the order in
 * the shopper's session. One path for the plain form and the script (docs/decisions.md).
 */

export const MFS_PROVIDERS = ['bkash', 'nagad', 'rocket'] as const;
export type MfsProvider = (typeof MFS_PROVIDERS)[number];
/** An online gateway (phase 18) as a form value: `online-sslcommerz`, `online-bkash`. */
export type OnlineChoice = `online-${string}`;
export type PaymentValue = 'cod' | MfsProvider | OnlineChoice;

const isProvider = (value: string): value is MfsProvider =>
    (MFS_PROVIDERS as readonly string[]).includes(value);
const isOnlineChoice = (value: string): value is OnlineChoice => /^online-[a-z]{2,20}$/.test(value);
/** The form value for a gateway. */
export const onlineChoice = (gateway: string): OnlineChoice => `online-${gateway}`;

export const CHECKOUT_FIELDS = [
    'name',
    'phone',
    'alternatePhone',
    'email',
    'districtId',
    'thanaId',
    'area',
    'streetLine1',
    'landmark',
    'note',
    'shippingMethodId',
    'payment',
    'senderNumber',
    'transactionId',
    'advanceProvider',
    'advanceSender',
    'advanceTransactionId',
    'otp',
] as const;

export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];
export type CheckoutValues = Record<CheckoutField, string>;
/** Field → message; `form` for messages about the whole order. */
export type CheckoutErrors = Partial<Record<CheckoutField | 'form', string>>;

export type PaymentOptions = NonNullable<ResultOf<typeof PAYMENT_OPTIONS>['bdPaymentOptions']>;
export type ShippingOption = ResultOf<typeof SHIPPING_OPTIONS>['eligibleShippingMethods'][number];
export type CheckoutSettings = ResultOf<typeof CHECKOUT_SETTINGS>['bdCheckoutSettings'];
export type District = ResultOf<typeof DISTRICTS>['bdDistricts'][number];
export type Thana = ResultOf<typeof THANAS>['bdThanas'][number];

export type PlaceOutcome =
    | { kind: 'placed'; code: string }
    | { kind: 'invalid'; errors: CheckoutErrors }
    /** The total isn't what the shopper saw (a price changed, or the delivery charge is new): show it again. */
    | { kind: 'review'; message: string }
    /** Placed, waiting for an online payment: send the shopper to the pay page with this attempt key. */
    | { kind: 'pay'; code: string; token: string }
    /** COD needs the SMS code first; the code was sent (or is on its way). */
    | { kind: 'otp'; message: string; error?: string }
    | { kind: 'empty' }
    /** The same tap is being placed by another request. */
    | { kind: 'busy' };

/** The form's values as typed, cut to a sane length (the core checks each one properly). */
export function readValues(form: FormData): CheckoutValues {
    const values = {} as CheckoutValues;
    const text = (name: string, max = 300) => {
        const value = form.get(name);
        return typeof value === 'string' ? value.slice(0, max).trim() : '';
    };
    for (const field of CHECKOUT_FIELDS) values[field] = text(field, field === 'note' ? 1000 : 300);
    // Each mobile banking option has its own sender and TrxID fields; the chosen one counts.
    if (isProvider(values.payment)) {
        values.senderNumber = text(`senderNumber.${values.payment}`) || values.senderNumber;
        values.transactionId = text(`transactionId.${values.payment}`) || values.transactionId;
    }
    return values;
}

/** What the form starts with: whatever this session already gave (a failed attempt, a reload). */
export function initialValues(order: CartOrder | null): CheckoutValues {
    const values = Object.fromEntries(CHECKOUT_FIELDS.map(field => [field, ''])) as CheckoutValues;
    const address = order?.shippingAddress;
    const fields = address?.customFields;
    values.name = address?.fullName ?? order?.customer?.firstName ?? '';
    values.phone = address?.phoneNumber ?? order?.customer?.phoneNumber ?? '';
    values.districtId = fields?.districtId ?? '';
    values.thanaId = fields?.thanaId ?? '';
    values.area = fields?.area ?? '';
    values.streetLine1 = address?.streetLine1 ?? '';
    values.landmark = fields?.landmark ?? '';
    values.alternatePhone = fields?.alternatePhone ?? '';
    values.note = order?.customFields?.customerNote ?? '';
    values.shippingMethodId = order?.shippingLines[0]?.shippingMethod.id ?? '';
    values.payment = order?.customFields?.paymentChoice === 'prepaid' ? '' : 'cod';
    // A local number reads better than +880 in the form.
    if (values.phone.startsWith('+880')) values.phone = `0${values.phone.slice(4)}`;
    return values;
}

/** The core's checkout fields map to ours. */
const FIELD_OF: Record<string, CheckoutField> = { fullName: 'name' };

function fieldError(field: string | null | undefined, message: string): CheckoutErrors {
    const name = field ? (FIELD_OF[field] ?? field) : 'form';
    return { [(CHECKOUT_FIELDS as readonly string[]).includes(name) ? name : 'form']: message };
}

/**
 * The live summary: sets only the district and thana (Vendure's own address mutation; our
 * interceptor checks both), the chosen delivery and the payment choice, then reads delivery options,
 * COD amounts and the order. Never fails the page: a problem just leaves the summary as it was.
 */
export async function quote(
    shopper: ShopperContext,
    values: Pick<CheckoutValues, 'districtId' | 'thanaId' | 'shippingMethodId' | 'payment'>,
): Promise<{ order: CartOrder | null; shipping: ShippingOption[]; options: PaymentOptions | null }> {
    try {
        if (values.districtId && values.thanaId) {
            await shopQuery(
                SET_PARTIAL_ADDRESS,
                {
                    input: {
                        streetLine1: '',
                        countryCode: 'BD',
                        customFields: { districtId: values.districtId, thanaId: values.thanaId },
                    },
                },
                shopper.lang,
                shopper,
            );
        }
        // Delivery is only charged once the address says where it goes.
        const located = !!values.districtId && !!values.thanaId;
        const { eligibleShippingMethods: shipping } = located
            ? await shopQuery(SHIPPING_OPTIONS, {}, shopper.lang, shopper)
            : { eligibleShippingMethods: [] };
        const chosen = shipping.find(option => option.id === values.shippingMethodId) ?? shipping[0];
        if (chosen) await shopQuery(SET_SHIPPING, { ids: [chosen.id] }, shopper.lang, shopper);
        await shopQuery(
            SET_PAYMENT_CHOICE,
            { choice: isProvider(values.payment) || isOnlineChoice(values.payment) ? 'prepaid' : 'cod' },
            shopper.lang,
            shopper,
        );
        const { bdPaymentOptions } = await shopQuery(PAYMENT_OPTIONS, {}, shopper.lang, shopper);
        return { order: await activeOrder(shopper), shipping, options: bdPaymentOptions ?? null };
    } catch (error) {
        if (!(error instanceof CoreQueryError)) throw error;
        return { order: await activeOrder(shopper), shipping: [], options: null };
    }
}

/** Saves the checkout as the shopper types, for staff to follow up (phase 11). Never fails. */
export async function saveProgress(shopper: ShopperContext, form: FormData, source: Record<string, string>) {
    const values = readValues(form);
    const website = form.get('website');
    await shopQuery(
        SAVE_PROGRESS,
        {
            input: {
                phone: values.phone,
                name: values.name || null,
                districtId: values.districtId || null,
                thanaId: values.thanaId || null,
                source: Object.keys(source).length ? source : null,
                website: typeof website === 'string' ? website : null,
            },
        },
        shopper.lang,
        shopper,
    ).catch(() => undefined);
}

/** A Shop API call in the shopper's session. */
type Ask = <R, V extends Record<string, unknown>>(
    document: TadaDocumentNode<R, V>,
    variables: V,
) => Promise<R>;

class NotPlaced extends Error {
    constructor(readonly outcome: PlaceOutcome) {
        super('Not placed');
    }
}

/** At most one order per idempotency key: a retry (double tap, a timeout on 2G) gets the same order. */
export async function placeOnce(shopper: ShopperContext, form: FormData, s: Strings): Promise<PlaceOutcome> {
    const key = form.get('idempotencyKey');
    if (!isValidIdempotencyKey(key)) return placeOrder(shopper, form, s);
    const store = idempotencyStore();
    const storeKey = `place:${key}`;
    // The claim lasts 2 minutes, so a crash mid-way can't block the shopper's next try for long.
    const claimed = await store.setIfAbsent(
        storeKey,
        { fingerprint: 'place', status: 'in_progress' },
        2 * 60_000,
    );
    if (!claimed) {
        for (let wait = 0; wait < 20; wait++) {
            const record = await store.get(storeKey);
            if (record?.status === 'completed') return record.result as PlaceOutcome;
            if (!record) return placeOnce(shopper, form, s);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return { kind: 'busy' };
    }
    try {
        const outcome = await placeOrder(shopper, form, s);
        if (outcome.kind !== 'placed' && outcome.kind !== 'pay') throw new NotPlaced(outcome);
        await store.set(
            storeKey,
            { fingerprint: 'place', status: 'completed', result: outcome },
            24 * 60 * 60_000,
        );
        return outcome;
    } catch (error) {
        await store.delete(storeKey);
        if (error instanceof NotPlaced) return error.outcome;
        throw error;
    }
}

/** The total the form was showing, in poisha. */
function expectedTotal(form: FormData): number | null {
    const value = form.get('expectedTotal');
    return typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : null;
}

/** Runs every step of placing the order. Each refusal returns what to tell the shopper. */
async function placeOrder(shopper: ShopperContext, form: FormData, s: Strings): Promise<PlaceOutcome> {
    const v = readValues(form);
    const ask: Ask = (document, variables) => shopQuery(document, variables, shopper.lang, shopper);
    let order = await activeOrder(shopper);
    if (!order || !order.lines.length || !order.active) return { kind: 'empty' };

    // Where the shopper came from (phase 16). Never stops the order.
    if (shopper.attribution) {
        await ask(SET_ATTRIBUTION, { input: { ...shopper.attribution } }).catch(() => undefined);
    }
    // Meta (phase 20). Never stops the order either.
    if (shopper.meta?.fbp || shopper.meta?.fbc) {
        await ask(SET_META_BROWSER, {
            input: {
                fbp: shopper.meta.fbp,
                fbc: shopper.meta.fbc,
                userAgent: shopper.meta.userAgent?.slice(0, 400) ?? null,
            },
        }).catch(() => undefined);
    }

    const website = form.get('website');
    const customer = (
        await ask(SET_CUSTOMER, {
            input: {
                name: v.name,
                phone: v.phone,
                alternatePhone: v.alternatePhone || null,
                email: v.email || null,
                website: typeof website === 'string' ? website : '',
                secondsOnForm: secondsSinceStamp(form.get('stamp')),
            },
        })
    ).setCustomerForOrderByPhone;
    if (customer.__typename === 'BdCheckoutError') {
        return { kind: 'invalid', errors: fieldError(customer.field, customer.message) };
    }

    if (!v.districtId) return { kind: 'invalid', errors: { districtId: s.chooseDistrict } };
    if (!v.thanaId) return { kind: 'invalid', errors: { thanaId: s.chooseThana } };
    const address = (
        await ask(SET_ADDRESS, {
            input: {
                fullName: v.name,
                districtId: v.districtId,
                thanaId: v.thanaId,
                area: v.area || null,
                streetLine1: v.streetLine1,
                landmark: v.landmark || null,
                note: v.note || null,
            },
        })
    ).setOrderShippingAddressBD;
    if (address.__typename === 'BdCheckoutError') {
        return { kind: 'invalid', errors: fieldError(address.field, address.message) };
    }

    const { eligibleShippingMethods: shipping } = await ask(SHIPPING_OPTIONS, {});
    const method = shipping.find(option => option.id === v.shippingMethodId) ?? shipping[0];
    if (!method) return { kind: 'invalid', errors: { districtId: s.noDeliveryHere } };
    await ask(SET_SHIPPING, { ids: [method.id] });

    const payment: PaymentValue | null =
        v.payment === 'cod' || isProvider(v.payment) || isOnlineChoice(v.payment) ? v.payment : null;
    if (!payment) return { kind: 'invalid', errors: { payment: s.choosePayment } };
    await ask(SET_PAYMENT_CHOICE, { choice: payment === 'cod' ? 'cod' : 'prepaid' });
    const { bdPaymentOptions: options } = await ask(PAYMENT_OPTIONS, {});
    order = await activeOrder(shopper);
    if (!order || !options) return { kind: 'empty' };
    // The shopper must have seen this exact total.
    if (expectedTotal(form) !== order.totalWithTax) return { kind: 'review', message: s.checkTotal };

    const account = (provider: string) => options.mfs.find(item => item.provider === provider);
    const gateway = (value: string) => options.online.find(item => onlineChoice(item.gateway) === value);
    const onlineAdvance = gateway(v.advanceProvider);
    const advanceDone = order.payments?.some(
        item =>
            item.state === 'Authorized' &&
            (item.metadata as { purpose?: string } | null)?.purpose === 'advance',
    );
    if (payment === 'cod') {
        if (!options.codAvailable) {
            return {
                kind: 'invalid',
                errors: { payment: options.codUnavailableMessage ?? s.codUnavailable },
            };
        }
        if (options.advanceAmount > 0 && !advanceDone && !onlineAdvance) {
            const errors: CheckoutErrors = {};
            if (!account(v.advanceProvider)) errors.advanceProvider = s.chooseAdvanceProvider;
            if (!v.advanceSender) errors.advanceSender = s.enterSender;
            if (!v.advanceTransactionId) errors.advanceTransactionId = s.enterTransactionId;
            if (Object.keys(errors).length) return { kind: 'invalid', errors };
        }
        if (options.codOtpRequired) {
            const otp = await checkOtp(v, form, ask, s);
            if (otp) return otp;
        }
    } else if (isOnlineChoice(payment)) {
        if (!gateway(payment)) return { kind: 'invalid', errors: { payment: s.choosePayment } };
    } else {
        const errors: CheckoutErrors = {};
        if (!account(payment)) errors.payment = s.choosePayment;
        if (!v.senderNumber) errors.senderNumber = s.enterSender;
        if (!v.transactionId) errors.transactionId = s.enterTransactionId;
        if (Object.keys(errors).length) return { kind: 'invalid', errors };
    }

    const moved = (await ask(TO_STATE, { state: 'ArrangingPayment' })).transitionOrderToState;
    if (moved?.__typename === 'OrderStateTransitionError') {
        // Vendure refuses to take payment while an item is short of stock: take it out and say so.
        const removed = await removeSoldOut(shopper);
        return {
            kind: 'invalid',
            errors: { form: removed.length ? s.soldOutRemoved(removed.join(', ')) : s.checkoutFailed },
        };
    }

    const pay = async (
        method: string,
        metadata: Record<string, unknown>,
        fields: [CheckoutField, CheckoutField],
    ) => {
        const result = (await ask(ADD_PAYMENT, { input: { method, metadata } })).addPaymentToOrder;
        if (result.__typename === 'Order')
            return { placed: result.state !== 'ArrangingPayment' ? result : null };
        return { refused: await refused(shopper, result, fields, s) };
    };
    let outcome: Awaited<ReturnType<typeof pay>>;
    if (payment === 'cod') {
        if (options.advanceAmount > 0 && !advanceDone) {
            // An online advance is paid on the gateway's page after the order is placed.
            outcome = onlineAdvance
                ? await pay(onlineAdvance.methodCode, { purpose: 'advance' }, [
                      'advanceProvider',
                      'advanceProvider',
                  ])
                : await pay(
                      account(v.advanceProvider)!.methodCode,
                      {
                          purpose: 'advance',
                          senderNumber: v.advanceSender,
                          transactionId: v.advanceTransactionId,
                      },
                      ['advanceSender', 'advanceTransactionId'],
                  );
            if (outcome.refused) return outcome.refused;
        }
        outcome = await pay('bd-cod', {}, ['payment', 'payment']);
    } else if (isOnlineChoice(payment)) {
        outcome = await pay(gateway(payment)!.methodCode, { purpose: 'full' }, ['payment', 'payment']);
    } else {
        outcome = await pay(
            account(payment)!.methodCode,
            { purpose: 'full', senderNumber: v.senderNumber, transactionId: v.transactionId },
            ['senderNumber', 'transactionId'],
        );
    }
    if (outcome.refused) return outcome.refused;
    if (!outcome.placed) return { kind: 'invalid', errors: { form: s.checkoutFailed } };
    if (outcome.placed.state === 'AwaitingPayment') {
        const token = payToken(outcome.placed.payments ?? []);
        if (token) return { kind: 'pay', code: outcome.placed.code, token };
    }
    return { kind: 'placed', code: outcome.placed.code };
}

/** The attempt key in the pending online payment's pay link (`…/bd-pay/start/<token>`). */
export function payToken(payments: ReadonlyArray<{ state: string; metadata?: unknown }>): string | null {
    const pending = payments.find(payment => payment.state === 'Pending');
    // The Shop API shows only a payment's public metadata.
    const metadata = pending?.metadata as { payUrl?: string; public?: { payUrl?: string } } | null;
    const url = metadata?.payUrl ?? metadata?.public?.payUrl ?? '';
    return /\/bd-pay\/start\/([a-f0-9]{30}(?:[a-f0-9]{2})?)$/.exec(url)?.[1] ?? null;
}

/** COD with an SMS code: checks a typed code, skips when asked (and allowed), else sends one. */
async function checkOtp(
    v: CheckoutValues,
    form: FormData,
    ask: Ask,
    s: Strings,
): Promise<PlaceOutcome | null> {
    if (v.otp) {
        const result = (await ask(VERIFY_OTP, { code: v.otp })).verifyBdOtp;
        return result.success
            ? null
            : { kind: 'otp', message: s.otpSent, error: result.message ?? s.otpWrong };
    }
    if (form.get('otpAction') === 'skip') {
        const result = (await ask(SKIP_OTP, {})).skipBdOtp;
        return result.success
            ? null
            : { kind: 'otp', message: s.otpSent, error: result.message ?? undefined };
    }
    const sent = (await ask(SEND_OTP, {})).sendBdOtp;
    // Already sent a moment ago (COOLDOWN): the code on its way still works.
    if (sent.success || sent.errorCode === 'COOLDOWN') return { kind: 'otp', message: s.otpSent };
    return { kind: 'otp', message: s.otpSent, error: sent.message ?? undefined };
}

/**
 * A refused payment: the order goes back to the cart state so the shopper can fix it. The reason
 * comes from the declined payment's public code (phase 08); a sold-out item leaves the cart.
 */
async function refused(
    shopper: ShopperContext,
    result: { __typename: string; message?: string; paymentErrorMessage?: string },
    [sender, transaction]: [CheckoutField, CheckoutField],
    s: Strings,
): Promise<PlaceOutcome> {
    await shopQuery(TO_STATE, { state: 'AddingItems' }, shopper.lang, shopper).catch(() => undefined);
    const order = await activeOrder(shopper);
    const declined = [...(order?.payments ?? [])].reverse().find(item => item.state === 'Declined');
    const code = (declined?.metadata as { errorCode?: string } | null)?.errorCode;
    const message = result.paymentErrorMessage || result.message || s.checkoutFailed;
    switch (code) {
        case 'SOLD_OUT': {
            const removed = await removeSoldOut(shopper);
            return {
                kind: 'invalid',
                errors: { form: removed.length ? s.soldOutRemoved(removed.join(', ')) : message },
            };
        }
        case 'CODE_REQUIRED':
            return { kind: 'otp', message: s.otpSent };
        case 'COD_FEE_CHANGED':
            return { kind: 'review', message: s.checkTotal };
        case 'INVALID_TRANSACTION_ID':
        case 'DUPLICATE_TRANSACTION_ID':
            return { kind: 'invalid', errors: { [transaction]: message } };
        case 'INVALID_SENDER':
            return { kind: 'invalid', errors: { [sender]: message } };
        default:
            return { kind: 'invalid', errors: { payment: message } };
    }
}

/** Takes sold-out lines out of the cart; returns their product names. */
async function removeSoldOut(shopper: ShopperContext): Promise<string[]> {
    const order = await activeOrder(shopper);
    const names: string[] = [];
    for (const line of order?.lines ?? []) {
        if (line.productVariant.stockLevel !== 'OUT_OF_STOCK') continue;
        await shopQuery(REMOVE_LINE, { lineId: line.id }, shopper.lang, shopper);
        names.push(line.productVariant.product.name);
    }
    return names;
}
