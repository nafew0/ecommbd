import type { StoreDefaultsStep } from '../bd-core';
import { BrandService } from './brand.service';

/** Store defaults (phase 55): the public `brand` facet, so brands can be added and filtered. */
export const brandFacetStep: StoreDefaultsStep = {
    id: 'brand-facet',
    description: 'The public brand facet',
    async run({ ctx, injector }) {
        const facet = await injector.get(BrandService).facet(ctx);
        return [`brand facet ${String(facet.id)}`];
    },
};
