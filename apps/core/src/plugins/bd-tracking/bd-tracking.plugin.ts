import { type OnApplicationBootstrap } from '@nestjs/common';
import {
    EventBus,
    I18nService,
    Logger,
    OrderPlacedEvent,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';
import { BD_TRACKING_PLUGIN_OPTIONS, type BdTrackingPluginOptions, loggerCtx } from './constants';
import { trackingTranslations } from './i18n';
import { TrackingRateLimiter } from './rate-limiter';
import { trackingShopApiExtensions } from './tracking.api';
import { TrackingOrderResolver, TrackingShopResolver } from './tracking.resolver';
import { TrackingService } from './tracking.service';

/**
 * Order tracking for shoppers (roadmap phase 14): by order number and phone, or by the token in
 * the "shipped" SMS (`/t/<token>`). Every placed order gets its token at once, so the thank-you
 * page can link it too.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        TrackingService,
        TrackingRateLimiter,
        { provide: BD_TRACKING_PLUGIN_OPTIONS, useFactory: () => BdTrackingPlugin.options },
    ],
    shopApiExtensions: {
        schema: trackingShopApiExtensions,
        resolvers: [TrackingShopResolver, TrackingOrderResolver],
    },
    compatibility: '^3.8.0',
})
export class BdTrackingPlugin implements OnApplicationBootstrap {
    static options: BdTrackingPluginOptions;

    static init(options: BdTrackingPluginOptions) {
        this.options = options;
        return BdTrackingPlugin;
    }

    constructor(
        private i18n: I18nService,
        private eventBus: EventBus,
        private tracking: TrackingService,
    ) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', trackingTranslations.en);
        this.i18n.addTranslation('bn', trackingTranslations.bn);
        // Events arrive after the order has committed.
        this.eventBus.ofType(OrderPlacedEvent).subscribe(event => {
            this.tracking
                .tokenFor(event.ctx, event.order)
                .catch((error: unknown) =>
                    Logger.error(
                        `Could not give order ${event.order.id} a tracking token`,
                        loggerCtx,
                        String(error),
                    ),
                );
        });
    }
}
