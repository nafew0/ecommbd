import {
    CHECKOUT_LIMITS,
    cleanText,
    parseBdPhone,
    parseCheckoutEmail,
    parseCheckoutName,
    parseCheckoutPhone,
    type RateLimitRule,
    textLength,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    ActiveOrderService,
    type ID,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { BdAddressError, type BdAddressErrorCode, normalizeAddressInput } from '../bd-core';
import { CheckoutRateLimiter } from './checkout-rate-limiter';
import { CheckoutSettingsService } from './checkout-settings.service';
import { BdCheckoutError, type CheckoutErrorCode } from './errors';
import { PhoneCustomerService } from './phone-customer.service';

export interface SetCustomerForOrderByPhoneInput {
    name: string;
    phone: string;
    alternatePhone?: string | null;
    email?: string | null;
}

export interface SetOrderShippingAddressBdInput {
    /** Defaults to the name given with the phone. */
    fullName?: string | null;
    districtId: string;
    thanaId: string;
    area?: string | null;
    /** House, road, village. */
    streetLine1: string;
    landmark?: string | null;
    postalCode?: string | null;
    alternatePhone?: string | null;
    /** The shopper's note for the order. */
    note?: string | null;
}

type CheckoutResult = Promise<Order | BdCheckoutError>;
type CreateAddressInput = Parameters<OrderService['setShippingAddress']>[2];

const ADDRESS_ERRORS: Record<BdAddressErrorCode, CheckoutErrorCode> = {
    'district-and-thana-together': 'UNKNOWN_DISTRICT',
    'unknown-district': 'UNKNOWN_DISTRICT',
    'thana-not-in-district': 'THANA_NOT_IN_DISTRICT',
    'other-needs-area': 'AREA_REQUIRED',
    'not-bangladesh': 'UNKNOWN_DISTRICT',
    'invalid-alternate-phone': 'INVALID_ALTERNATE_PHONE',
};

const ADDRESS_ERROR_FIELDS: Partial<Record<CheckoutErrorCode, string>> = {
    UNKNOWN_DISTRICT: 'districtId',
    THANA_NOT_IN_DISTRICT: 'thanaId',
    AREA_REQUIRED: 'area',
    INVALID_ALTERNATE_PHONE: 'alternatePhone',
};

/**
 * Phone-first checkout for the Shop API (roadmap phase 03): name and phone, then a district/thana
 * address. Every field is cleaned (NFC, control characters, spaces) and length-checked here.
 */
@Injectable()
export class CheckoutService {
    constructor(
        private connection: TransactionalConnection,
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
        private phoneCustomers: PhoneCustomerService,
        private settings: CheckoutSettingsService,
        private rateLimiter: CheckoutRateLimiter,
    ) {}

    /**
     * Finds the customer by phone (or creates one with a placeholder email) and attaches them to the
     * active order. The name and phone typed here go on the order's shipping address, so each order
     * keeps what was typed for it. Runs outside a request transaction (see PhoneCustomerService).
     */
    async setCustomerForOrderByPhone(
        ctx: RequestContext,
        input: SetCustomerForOrderByPhoneInput,
    ): CheckoutResult {
        if (ctx.activeUserId) {
            return new BdCheckoutError('ALREADY_LOGGED_IN');
        }
        const order = await this.activeOrder(ctx);
        if (!order) {
            return new BdCheckoutError('NO_ACTIVE_ORDER');
        }
        const { rules } = this.rateLimiter;
        const sessionLimited = await this.limit(
            `customer:session:${this.sessionKey(ctx)}`,
            rules.customerPerSession,
        );
        if (sessionLimited) {
            return sessionLimited;
        }
        const settings = await this.settings.get(ctx);
        const name = parseCheckoutName(input.name);
        if (!name.ok) {
            return new BdCheckoutError(name.code, 'name');
        }
        const phone = parseCheckoutPhone(input.phone, {
            allowInternational: settings.allowInternationalPhones,
        });
        if (!phone.ok) {
            return new BdCheckoutError(phone.code, 'phone');
        }
        const alternatePhone = parseAlternatePhone(input.alternatePhone, phone.e164);
        if (alternatePhone === false) {
            return new BdCheckoutError('INVALID_ALTERNATE_PHONE', 'alternatePhone');
        }
        const email = parseCheckoutEmail(input.email);
        if (!email.ok) {
            return new BdCheckoutError(email.code, 'email');
        }
        const phoneLimited = await this.limit(`customer:phone:${phone.e164}`, rules.customerPerPhone);
        if (phoneLimited) {
            return phoneLimited;
        }

        const { customer, contactEmail } = await this.phoneCustomers.findOrCreate(ctx, {
            name: name.name,
            phone: phone.e164,
            alternatePhone,
            email: email.email,
            source: 'web',
        });
        await this.connection.withTransaction(ctx, async txCtx => {
            await this.orderService.addCustomerToOrder(txCtx, order.id, customer);
            const current = order.shippingAddress ?? {};
            const customFields = (current.customFields ?? {}) as Record<string, unknown>;
            await this.updateOrder(txCtx, order.id, {
                shippingAddress: {
                    ...current,
                    fullName: name.name,
                    phoneNumber: phone.e164,
                    customFields: alternatePhone ? { ...customFields, alternatePhone } : customFields,
                },
                customFields: {
                    contactEmail,
                    locale: ctx.languageCode === 'en' ? 'en' : 'bn',
                },
            });
        });
        return this.reload(ctx, order.id);
    }

    /** Sets the delivery address from a district and thana (checked against bd-geo) and the note. */
    async setOrderShippingAddressBD(
        ctx: RequestContext,
        input: SetOrderShippingAddressBdInput,
    ): CheckoutResult {
        const order = await this.activeOrder(ctx);
        if (!order) {
            return new BdCheckoutError('NO_ACTIVE_ORDER');
        }
        const limited = await this.limit(
            `address:session:${this.sessionKey(ctx)}`,
            this.rateLimiter.rules.addressPerSession,
        );
        if (limited) {
            return limited;
        }
        const settings = await this.settings.get(ctx);
        const current = order.shippingAddress ?? {};
        const currentFields = (current.customFields ?? {}) as Record<string, string | null | undefined>;

        let fullName = current.fullName ?? '';
        if (input.fullName && cleanText(input.fullName) !== '') {
            const name = parseCheckoutName(input.fullName);
            if (!name.ok) {
                return new BdCheckoutError(name.code, 'fullName');
            }
            fullName = name.name;
        }
        const streetLine1 = cleanText(input.streetLine1);
        if (textLength(streetLine1) < settings.minAddressLength) {
            return new BdCheckoutError('ADDRESS_TOO_SHORT', 'streetLine1');
        }
        if (textLength(streetLine1) > CHECKOUT_LIMITS.streetLine) {
            return new BdCheckoutError('ADDRESS_TOO_LONG', 'streetLine1');
        }
        const optional = { area: input.area, landmark: input.landmark, postalCode: input.postalCode };
        const limits = {
            area: CHECKOUT_LIMITS.area,
            landmark: CHECKOUT_LIMITS.landmark,
            postalCode: CHECKOUT_LIMITS.postalCode,
        };
        const cleaned: Record<keyof typeof optional, string | null> = {
            area: null,
            landmark: null,
            postalCode: null,
        };
        for (const key of Object.keys(optional) as Array<keyof typeof optional>) {
            const value = cleanText(optional[key] ?? '');
            if (textLength(value) > limits[key]) {
                return new BdCheckoutError('FIELD_TOO_LONG', key);
            }
            cleaned[key] = value || null;
        }
        const note = cleanText(input.note ?? '', { multiline: true });
        if (textLength(note) > CHECKOUT_LIMITS.note) {
            return new BdCheckoutError('NOTE_TOO_LONG', 'note');
        }
        const phoneNumber = current.phoneNumber ?? order.customer?.customFields.phone ?? undefined;
        const alternatePhone =
            input.alternatePhone === undefined || input.alternatePhone === null
                ? (currentFields.alternatePhone ?? null)
                : parseAlternatePhone(input.alternatePhone, phoneNumber);
        if (alternatePhone === false) {
            return new BdCheckoutError('INVALID_ALTERNATE_PHONE', 'alternatePhone');
        }

        let address: CreateAddressInput;
        try {
            address = normalizeAddressInput<CreateAddressInput>({
                fullName,
                streetLine1,
                streetLine2: '',
                countryCode: 'BD',
                postalCode: cleaned.postalCode ?? undefined,
                phoneNumber,
                customFields: {
                    districtId: input.districtId,
                    thanaId: input.thanaId,
                    area: cleaned.area,
                    landmark: cleaned.landmark,
                    alternatePhone,
                },
            });
        } catch (error) {
            if (error instanceof BdAddressError) {
                const code = ADDRESS_ERRORS[error.code];
                return new BdCheckoutError(code, ADDRESS_ERROR_FIELDS[code] ?? null);
            }
            throw error;
        }
        await this.connection.withTransaction(ctx, async txCtx => {
            await this.orderService.setShippingAddress(txCtx, order.id, address);
            await this.updateOrder(txCtx, order.id, { customFields: { customerNote: note || null } });
        });
        return this.reload(ctx, order.id);
    }

    private async activeOrder(ctx: RequestContext): Promise<Order | undefined> {
        return ctx.authorizedAsOwnerOnly ? this.activeOrderService.getActiveOrder(ctx, undefined) : undefined;
    }

    private sessionKey(ctx: RequestContext): string {
        return String(ctx.session?.id ?? 'none');
    }

    private async limit(key: string, rule: RateLimitRule): Promise<BdCheckoutError | undefined> {
        const retryAfter = await this.rateLimiter.hit(`checkout:${key}`, rule);
        return retryAfter ? new BdCheckoutError('RATE_LIMITED', null, retryAfter) : undefined;
    }

    /** A partial update of the order row (Vendure's own setShippingAddress works the same way). */
    private async updateOrder(
        ctx: RequestContext,
        orderId: ID,
        values: { shippingAddress?: Order['shippingAddress']; customFields?: Partial<Order['customFields']> },
    ) {
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .update(Order)
            .set(values as never)
            .where('id = :id', { id: orderId })
            .execute();
    }

    private async reload(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) {
            throw new Error(`Order ${orderId} disappeared during checkout`);
        }
        return order;
    }
}

/**
 * An optional alternate number (a landline is fine): E.164, `null` when empty or the same as the
 * main phone, `false` when invalid.
 */
function parseAlternatePhone(
    input: string | null | undefined,
    mainPhone: string | undefined,
): string | null | false {
    if (!input || cleanText(input) === '') {
        return null;
    }
    const parsed = parseBdPhone(input);
    if (!parsed.ok) {
        return false;
    }
    return parsed.phone.e164 === mainPhone ? null : parsed.phone.e164;
}
