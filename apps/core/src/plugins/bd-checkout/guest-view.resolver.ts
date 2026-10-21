import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Ctx, type Customer, CustomerService, type Order, RequestContext } from '@vendure/core';

/**
 * Shop API privacy for guests (roadmap phase 03). A guest who types a registered customer's phone
 * is linked to that customer, so `Order.customer` would show the account's name, email and user.
 * Instead a guest sees a stand-in made only from what was typed for this order: nothing reveals
 * whether the phone has an account or past orders. Signed-in shoppers see their own record.
 */
@Resolver('Order')
export class GuestOrderCustomerResolver {
    constructor(private customerService: CustomerService) {}

    @ResolveField()
    async customer(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const customer =
            order.customer ??
            (order.customerId ? await this.customerService.findOne(ctx, order.customerId) : undefined);
        if (!customer) {
            return null;
        }
        return ctx.activeUserId ? customer : guestView(order);
    }
}

@Resolver('Customer')
export class GuestCustomerUserResolver {
    constructor(private customerService: CustomerService) {}

    /** A guest never sees a user account, theirs or anyone's. */
    @ResolveField()
    async user(@Ctx() ctx: RequestContext, @Parent() customer: Customer) {
        if (!ctx.activeUserId) {
            return null;
        }
        if (customer.user) {
            return customer.user;
        }
        return (await this.customerService.findOne(ctx, customer.id, ['user']))?.user ?? null;
    }
}

function guestView(order: Order): Partial<Customer> {
    const address = order.shippingAddress ?? {};
    return {
        id: `guest-${order.code}`,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        title: undefined,
        firstName: address.fullName ?? '',
        lastName: '',
        emailAddress: '',
        phoneNumber: address.phoneNumber ?? undefined,
    };
}
