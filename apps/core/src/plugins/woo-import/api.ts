import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, PermissionDefinition, RequestContext } from '@vendure/core';
import gql from 'graphql-tag';
import { WooImportService } from './woo-import.service';
import { WooOpenOrderService } from './open-order.service';

export const runMigrationPermission = new PermissionDefinition({
    name: 'RunMigration',
    description: 'Import and review a WooCommerce store and its credentials',
});
export const schema = gql`
    extend type Query {
        wooSources: JSON!
        wooRuns(sourceId: ID!): JSON!
        wooRun(id: ID!): JSON!
        wooMigrationReport(runId: ID!): JSON!
        wooLegacyOrders(sourceId: ID, customerId: ID, search: String, skip: Int, take: Int): JSON!
        wooLegacyOrder(id: ID!): JSON
    }
    extend type Mutation {
        connectWooSource(input: JSON!): JSON!
        startWooImport(sourceId: ID!, mode: String!, acknowledge: Boolean): JSON!
        resumeWooImport(runId: ID!): JSON!
        completeWooMigration(sourceId: ID!): Boolean!
        convertWooOpenOrder(legacyId: ID!, input: JSON!): Order
    }
`;
@Resolver()
export class WooImportResolver {
    constructor(
        private migration: WooImportService,
        private openOrders: WooOpenOrderService,
    ) {}
    @Query()
    @Allow(runMigrationPermission.Permission)
    wooSources(@Ctx() ctx: RequestContext) {
        return this.migration.sources(ctx);
    }
    @Query()
    @Allow(runMigrationPermission.Permission)
    wooRuns(@Ctx() ctx: RequestContext, @Args('sourceId') id: ID) {
        return this.migration.runs(ctx, Number(id));
    }
    @Query()
    @Allow(runMigrationPermission.Permission)
    wooRun(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.migration.run(ctx, Number(id));
    }
    @Query()
    @Allow(runMigrationPermission.Permission)
    wooMigrationReport(@Ctx() ctx: RequestContext, @Args('runId') id: ID) {
        return this.migration.report(ctx, Number(id));
    }
    @Query()
    @Allow(Permission.ReadOrder)
    wooLegacyOrders(
        @Ctx() ctx: RequestContext,
        @Args() args: { sourceId?: ID; customerId?: ID; search?: string; skip?: number; take?: number },
    ) {
        return this.migration.legacyOrders(ctx, {
            ...args,
            sourceId: args.sourceId == null ? undefined : Number(args.sourceId),
            customerId: args.customerId == null ? undefined : Number(args.customerId),
        });
    }
    @Query()
    @Allow(Permission.ReadOrder)
    wooLegacyOrder(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.migration.legacyOrder(ctx, Number(id));
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    connectWooSource(@Ctx() ctx: RequestContext, @Args('input') input: unknown) {
        return this.migration.connect(ctx, input);
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    startWooImport(
        @Ctx() ctx: RequestContext,
        @Args() args: { sourceId: ID; mode: string; acknowledge?: boolean },
    ) {
        return this.migration.start(ctx, Number(args.sourceId), args.mode, args.acknowledge);
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    resumeWooImport(@Ctx() ctx: RequestContext, @Args('runId') id: ID) {
        return this.migration.resume(ctx, Number(id));
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    completeWooMigration(@Ctx() ctx: RequestContext, @Args('sourceId') id: ID) {
        return this.migration.complete(ctx, Number(id));
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    convertWooOpenOrder(
        @Ctx() ctx: RequestContext,
        @Args('legacyId') id: ID,
        @Args('input') input: { sourceFrozen?: boolean; inventoryAlreadyReduced?: boolean },
    ) {
        return this.openOrders.convert(ctx, Number(id), input);
    }
}
