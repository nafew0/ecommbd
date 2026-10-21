import { Args, Mutation, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, isGraphQlErrorResult, RequestContext } from '@vendure/core';
import { createManualOrderPermission, editOrderPermission } from './constants';
import { type ManualOrderInput, ManualOrderService } from './manual-order.service';
import { type EditOrderInput, OrderEditService } from './order-edit.service';

@Resolver()
export class ManualOrdersAdminResolver {
    constructor(
        private manualOrders: ManualOrderService,
        private edits: OrderEditService,
    ) {}

    @Query()
    @Allow(createManualOrderPermission.Permission)
    bdManualOrderQuote(@Ctx() ctx: RequestContext, @Args() args: { input: ManualOrderInput }) {
        return this.manualOrders.quote(ctx, args.input);
    }

    @Mutation()
    @Allow(createManualOrderPermission.Permission)
    createBdManualOrder(@Ctx() ctx: RequestContext, @Args() args: { input: ManualOrderInput }) {
        return this.manualOrders.create(ctx, args.input);
    }

    @Mutation()
    @Allow(editOrderPermission.Permission)
    editBdOrder(@Ctx() ctx: RequestContext, @Args() args: { input: EditOrderInput }) {
        return this.edits.edit(ctx, args.input);
    }
}

const resolveType = (typename: string) => (value: unknown) =>
    isGraphQlErrorResult(value) ? (value as { __typename: string }).__typename : typename;

@Resolver('BdManualOrderResult')
export class BdManualOrderResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return resolveType('Order')(value);
    }
}

@Resolver('BdManualOrderQuoteResult')
export class BdManualOrderQuoteResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return resolveType('BdManualOrderQuote')(value);
    }
}
