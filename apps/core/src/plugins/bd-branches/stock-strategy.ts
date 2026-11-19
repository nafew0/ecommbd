import {
    MultiChannelStockLocationStrategy,
    type Injector,
    type OrderLine,
    type RequestContext,
    type StockLocation,
} from '@vendure/core';
import { BranchService } from './branch.service';

/**
 * Vendure's channel-aware allocation, with the branch that should ship the order tried first.
 * Stock that only another branch holds is still saleable (the channel total). The shortfall is
 * reserved where the goods actually are, so it cannot be sold twice.
 */
export class BranchStockLocationStrategy extends MultiChannelStockLocationStrategy {
    private branches!: BranchService;

    override async init(injector: Injector): Promise<void> {
        await super.init(injector);
        this.branches = injector.get(BranchService);
    }

    override async forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ) {
        const preferred = await this.branches.shippingBranchIdForLine(ctx, orderLine);
        const ordered = [...stockLocations].sort((a, b) => {
            const rank = (id: StockLocation['id']) => (String(id) === String(preferred) ? 0 : 1);
            return rank(a.id) - rank(b.id);
        });
        return super.forAllocation(ctx, ordered, orderLine, quantity);
    }
}
