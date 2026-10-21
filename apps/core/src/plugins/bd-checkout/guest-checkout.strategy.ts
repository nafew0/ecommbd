import { cleanText, parseCheckoutEmail, parseCheckoutPhone } from '@ecommbd/shared';
import {
    Customer,
    CustomerService,
    type GuestCheckoutStrategy,
    type Injector,
    Order,
    type RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import {
    AlreadyLoggedInError,
    GuestCheckoutError,
} from '@vendure/core/dist/common/error/generated-graphql-shop-errors';
import { IsNull } from 'typeorm';
import { CheckoutSettingsService } from './checkout-settings.service';
import { PhoneCustomerService } from './phone-customer.service';

type CreateCustomerInput = Parameters<GuestCheckoutStrategy['setCustomerForOrder']>[2];
type SetCustomerResult = Awaited<ReturnType<GuestCheckoutStrategy['setCustomerForOrder']>>;

/**
 * Vendure's own `setCustomerForOrder` (older API clients), made phone-first: the customer is found
 * by phone, then by email, and an existing customer is never updated (Vendure's default would
 * overwrite a registered customer's name). Without a valid phone the order can't go to payment
 * (checkout-guard.ts).
 *
 * Vendure runs this inside the request's transaction, so the "same new phone at the same moment"
 * race ends in an error here and the client's retry finds the customer; `setCustomerForOrderByPhone`
 * handles it without an error.
 */
export class BdGuestCheckoutStrategy implements GuestCheckoutStrategy {
    private phoneCustomers: PhoneCustomerService;
    private customerService: CustomerService;
    private settings: CheckoutSettingsService;
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.phoneCustomers = injector.get(PhoneCustomerService);
        this.customerService = injector.get(CustomerService);
        this.settings = injector.get(CheckoutSettingsService);
        this.connection = injector.get(TransactionalConnection);
    }

    async setCustomerForOrder(
        ctx: RequestContext,
        order: Order,
        input: CreateCustomerInput,
    ): Promise<SetCustomerResult> {
        if (ctx.activeUserId) {
            return new AlreadyLoggedInError();
        }
        const { allowInternationalPhones } = await this.settings.get(ctx);
        const phone = parseCheckoutPhone(input.phoneNumber ?? '', {
            allowInternational: allowInternationalPhones,
        });
        const parsedEmail = parseCheckoutEmail(input.emailAddress);
        const email = parsedEmail.ok ? parsedEmail.email : null;
        const name = cleanText(`${input.firstName ?? ''} ${input.lastName ?? ''}`);

        if (phone.ok) {
            const { customer, contactEmail } = await this.phoneCustomers.findOrCreate(ctx, {
                name,
                phone: phone.e164,
                email,
                source: 'web',
            });
            if (contactEmail) {
                await this.connection
                    .getRepository(ctx, Order)
                    .update(order.id, { customFields: { contactEmail } } as never);
            }
            return customer;
        }
        if (!email) {
            return new GuestCheckoutError({ errorDetail: 'A mobile number or an email address is needed' });
        }
        const existing = await this.connection
            .getRepository(ctx, Customer)
            .findOne({ where: { emailAddress: email, deletedAt: IsNull() } });
        if (existing) {
            return existing;
        }
        return this.customerService.createOrUpdate(ctx, {
            firstName: name,
            lastName: '',
            emailAddress: email,
        });
    }
}
