import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Allow, Permission } from '@vendure/core';
import { EVENTS_ROUTE } from './constants';
import { MetaService } from './meta.service';

/** At most this many bytes of JSON per event: product data for a big cart fits easily. */
const MAX_BYTES = 8_192;

/**
 * The storefront's events (phase 20): `POST <STOREFRONT_URL>/bd-events`, sent with a beacon.
 * Same-site only, size-limited, schema-checked and rate-limited; always answers 204 so it can't be
 * used to learn anything. The client IP comes from the trusted proxy header (Vendure's trustProxy).
 */
@Controller(EVENTS_ROUTE)
export class MetaEventsController {
    constructor(private meta: MetaService) {}

    @Post()
    @HttpCode(204)
    @Allow(Permission.Public)
    async event(
        @Body() body: unknown,
        @Headers('user-agent') userAgent: string | undefined,
        @Headers('sec-fetch-site') fetchSite: string | undefined,
        @Req() req: { ip?: string },
    ) {
        // Browsers say where a request came from: only the store's own pages count.
        if (fetchSite && fetchSite !== 'same-origin') return;
        if (JSON.stringify(body ?? null).length > MAX_BYTES) return;
        await this.meta.browserEvent({ body, ip: req.ip ?? null, userAgent: userAgent ?? null });
    }
}
