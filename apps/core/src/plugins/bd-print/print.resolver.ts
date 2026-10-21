import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, type Order, Permission, RequestContext } from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { printOrdersPermission } from './constants';
import { PrintService } from './print.service';
import { PrintSettingsService } from './print-settings.service';

@Resolver()
export class PrintAdminResolver {
    constructor(
        private print: PrintService,
        private settings: PrintSettingsService,
    ) {}

    /** Customer names, phones and addresses: never kept in a browser or proxy cache. */
    @Query()
    @Allow(printOrdersPermission.Permission)
    bdPrintData(@Ctx() ctx: RequestContext, @Args() args: { orderIds: ID[]; document: string }) {
        ctx.req?.res?.setHeader('Cache-Control', 'no-store');
        return this.print.data(ctx, args.orderIds, args.document);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    bdPrintSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Allow(printOrdersPermission.Permission)
    markBdOrdersPrinted(@Ctx() ctx: RequestContext, @Args() args: { orderIds: ID[]; document: string }) {
        return this.print.markPrinted(ctx, args.orderIds, args.document);
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdPrintSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.settings.update(ctx, args.input);
    }
}

/** `Order.bdPrint`: when the invoice, packing slip and sticker were last printed. */
@Resolver('Order')
export class OrderPrintInfoResolver {
    @ResolveField()
    bdPrint(@Parent() order: Order) {
        return {
            invoicePrintedAt: order.customFields.invoicePrintedAt ?? null,
            slipPrintedAt: order.customFields.slipPrintedAt ?? null,
            stickerPrintedAt: order.customFields.stickerPrintedAt ?? null,
        };
    }
}
