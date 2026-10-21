import { Args, Mutation, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, isGraphQlErrorResult, Permission, RequestContext, Transaction } from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { CheckoutSettingsService } from './checkout-settings.service';
import {
    CheckoutService,
    type SetCustomerForOrderByPhoneInput,
    type SetOrderShippingAddressBdInput,
} from './checkout.service';
import { CustomerSearchService, type CustomerSearchOptions } from './customer-search.service';

@Resolver()
export class CheckoutShopResolver {
    constructor(
        private checkout: CheckoutService,
        private settings: CheckoutSettingsService,
    ) {}

    // No @Transaction: a new customer is created in its own short transaction (PhoneCustomerService).
    @Mutation()
    @Allow(Permission.Owner)
    setCustomerForOrderByPhone(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: SetCustomerForOrderByPhoneInput },
    ) {
        return this.checkout.setCustomerForOrderByPhone(ctx, args.input);
    }

    @Mutation()
    @Allow(Permission.Owner)
    setOrderShippingAddressBD(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: SetOrderShippingAddressBdInput },
    ) {
        return this.checkout.setOrderShippingAddressBD(ctx, args.input);
    }

    @Query()
    @Allow(Permission.Public)
    bdCheckoutSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }
}

/** Both checkout mutations return the Order or a BdCheckoutError. */
@Resolver('SetCustomerForOrderByPhoneResult')
export class SetCustomerForOrderByPhoneResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return isGraphQlErrorResult(value) ? (value as { __typename: string }).__typename : 'Order';
    }
}

@Resolver('SetOrderShippingAddressBDResult')
export class SetOrderShippingAddressBdResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return isGraphQlErrorResult(value) ? (value as { __typename: string }).__typename : 'Order';
    }
}

@Resolver()
export class CheckoutAdminResolver {
    constructor(
        private customerSearch: CustomerSearchService,
        private settings: CheckoutSettingsService,
    ) {}

    @Query()
    @Allow(Permission.ReadCustomer)
    bdCustomers(@Ctx() ctx: RequestContext, @Args() args: CustomerSearchOptions) {
        return this.customerSearch.search(ctx, args);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    bdCheckoutSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdCheckoutSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.settings.update(ctx, args.input);
    }
}
