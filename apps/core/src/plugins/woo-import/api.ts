import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, PermissionDefinition, RequestContext } from '@vendure/core';
import gql from 'graphql-tag';
import { WooImportService } from './woo-import.service';
import { WooOpenOrderService } from './open-order.service';
import { WooHelperService } from './helper.service';
import { WooRedirectService } from './redirect.service';
import { WooSource } from './entities';
import { Order, Permission as CorePermission, TransactionalConnection, UserInputError } from '@vendure/core';
import { isPlaceholderEmail } from '@ecommbd/shared';

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
        wooUrlReview(sourceId: ID!): JSON!
        wooRollbackOrders(since: DateTime!, skip: Int): JSON!
    }
    extend type Mutation {
        connectWooSource(input: JSON!): JSON!
        startWooImport(sourceId: ID!, mode: String!, acknowledge: Boolean): JSON!
        resumeWooImport(runId: ID!): JSON!
        completeWooMigration(sourceId: ID!): Boolean!
        convertWooOpenOrder(legacyId: ID!, input: JSON!): Order
        createWooPairing(input: JSON!): JSON!
        revokeWooHelper(sourceId: ID!): Boolean!
        saveWooRedirect(sourceId: ID!, path: String!, target: String, status: Int): JSON!
        "Removes one old-address rule; true when it existed."
        wooDeleteRedirect(id: ID!): Boolean!
        saveWooCutover(sourceId: ID!, checked: [String!]!): Boolean!
        crawlWooSitemap(sourceId: ID!, sitemap: String!, destination: String!): JSON!
    }
`;
@Resolver()
export class WooImportResolver {
    constructor(
        private migration: WooImportService,
        private openOrders: WooOpenOrderService,
        private helper: WooHelperService,
        private redirects: WooRedirectService,
        private connection: TransactionalConnection,
    ) {}
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    createWooPairing(
        @Ctx() ctx: RequestContext,
        @Args('input') input: { url: string; imageHosts?: string[] },
    ) {
        return this.helper.createPairing(ctx, input);
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    async revokeWooHelper(@Ctx() ctx: RequestContext, @Args('sourceId') id: ID) {
        await this.migration.source(ctx, Number(id));
        await this.helper.revoke(ctx, Number(id));
        return true;
    }
    @Query()
    @Allow(runMigrationPermission.Permission)
    async wooRollbackOrders(@Ctx() ctx: RequestContext, @Args('since') since: Date, @Args('skip') skip = 0) {
        if (
            !ctx.userHasPermissions([CorePermission.ReadOrder]) ||
            !Number.isFinite(new Date(since).getTime()) ||
            Date.now() - new Date(since).getTime() > 31 * 86400_000 ||
            new Date(since) > new Date() ||
            !Number.isInteger(skip) ||
            skip < 0 ||
            skip > 5000
        )
            throw new UserInputError('error.woo-import.input');
        const [orders, totalItems] = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('o')
            .innerJoin('o.channels', 'channel', 'channel.id=:channelId', { channelId: ctx.channelId })
            .leftJoinAndSelect('o.lines', 'line')
            .leftJoinAndSelect('line.productVariant', 'variant')
            .leftJoinAndSelect('variant.translations', 'variantTranslation')
            .leftJoinAndSelect('o.customer', 'customer')
            .leftJoinAndSelect('o.payments', 'payment')
            .where('o.orderPlacedAt >= :since', { since: new Date(since) })
            .orderBy('o.id', 'ASC')
            .skip(skip)
            .take(500)
            .getManyAndCount();
        return {
            totalItems,
            items: orders.map(order => ({
                number: order.customFields.orderNumber,
                state: order.state,
                placedAt: order.orderPlacedAt,
                total: order.totalWithTax,
                customer: order.customer
                    ? {
                          name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
                          email: isPlaceholderEmail(order.customer.emailAddress)
                              ? null
                              : order.customer.emailAddress,
                          phone: order.customer.customFields.phone,
                      }
                    : null,
                shippingAddress: order.shippingAddress,
                lines: order.lines.map(line => ({
                    variantId: line.productVariantId,
                    sku: line.productVariant?.sku,
                    name: line.productVariant?.translations?.[0]?.name,
                    quantity: line.quantity,
                    total: line.linePriceWithTax,
                })),
                payments: order.payments.map(payment => ({
                    method: payment.method,
                    state: payment.state,
                    amount: payment.amount,
                    transactionId: payment.transactionId,
                })),
            })),
        };
    }
    @Query()
    @Allow(runMigrationPermission.Permission)
    async wooUrlReview(@Ctx() ctx: RequestContext, @Args('sourceId') id: ID) {
        await this.migration.source(ctx, Number(id));
        return this.redirects.list(ctx, Number(id));
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    async saveWooRedirect(
        @Ctx() ctx: RequestContext,
        @Args() input: { sourceId: ID; path: string; target?: string; status?: number },
    ) {
        await this.migration.source(ctx, Number(input.sourceId));
        return this.redirects.save(
            ctx,
            Number(input.sourceId),
            input.path,
            input.target ?? null,
            input.status ?? 301,
        );
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    wooDeleteRedirect(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.redirects.remove(ctx, Number(id));
    }
    /**
     * Merges keys into a source's settings in one statement. Reading the settings, changing them
     * and writing them all back would undo anything an import saved in between (its reference
     * settings, the helper pairing).
     */
    private async mergeSettings(ctx: RequestContext, sourceId: ID, patch: Record<string, unknown>) {
        await this.connection
            .getRepository(ctx, WooSource)
            .query('UPDATE woo_source SET settings = settings || $1::jsonb WHERE id = $2', [
                JSON.stringify(patch),
                Number(sourceId),
            ]);
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    async saveWooCutover(@Ctx() ctx: RequestContext, @Args() input: { sourceId: ID; checked: string[] }) {
        const source = await this.migration.source(ctx, Number(input.sourceId));
        const allowed = [
            'backup',
            'rehearsal',
            'dnsTtl',
            'ssl',
            'freeze',
            'sync',
            'gateway',
            'courier',
            'meta',
            'searchConsole',
            'crawl',
            'rollback',
        ];
        if (!Array.isArray(input.checked) || input.checked.some(key => !allowed.includes(key)))
            throw new UserInputError('error.woo-import.input');
        await this.mergeSettings(ctx, source.id, {
            cutover: {
                checked: [...new Set(input.checked)],
                at: new Date().toISOString(),
                by: String(ctx.activeUserId),
            },
        });
        return true;
    }
    @Mutation()
    @Allow(runMigrationPermission.Permission)
    async crawlWooSitemap(
        @Ctx() ctx: RequestContext,
        @Args() input: { sourceId: ID; sitemap: string; destination: string },
    ) {
        const source = await this.migration.source(ctx, Number(input.sourceId));
        const crawl = await this.redirects.crawl(ctx, source, input.destination, input.sitemap);
        await this.mergeSettings(ctx, source.id, { crawl });
        return crawl;
    }
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
export const shopSchema = gql`
    extend type Query {
        wooResolvePath(path: String!, recordMiss: Boolean): JSON
    }
`;
@Resolver()
export class WooUrlResolver {
    constructor(private redirects: WooRedirectService) {}
    @Query()
    @Allow(Permission.Public)
    wooResolvePath(
        @Ctx() ctx: RequestContext,
        @Args('path') path: string,
        @Args('recordMiss') recordMiss?: boolean,
    ) {
        return this.redirects.resolve(ctx, path, recordMiss === true);
    }
}
