import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Allow, Permission } from '@vendure/core';
import { json, type NextFunction, type Request, type Response } from 'express';
import { EVENT_MAX_BYTES, EVENTS_ROUTE } from './constants';
import { MetaService } from './meta.service';

const parseSmallJson = json({ limit: EVENT_MAX_BYTES, type: () => true });

/**
 * The body parser of `/bd-events`, mounted before NestJS's own (Vendure's `beforeListen`
 * middleware): it stops reading at 8 KB, so a large body is refused before it's parsed, not after.
 * Too large or not JSON: answered 204 like every other event, nothing queued.
 */
export function metaEventsBodyParser(req: Request, res: Response, next: NextFunction) {
    parseSmallJson(req, res, error => {
        if (error) {
            res.status(204).end();
            return;
        }
        next();
    });
}

/**
 * The storefront's events (phase 20): `POST <STOREFRONT_URL>/bd-events`, sent with a beacon.
 * Same-site only, size-limited (`metaEventsBodyParser`), schema-checked and rate-limited; always
 * answers 204 so it can't be used to learn anything. The client IP comes from the trusted proxy
 * header (Vendure's trustProxy).
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
        await this.meta.browserEvent({ body, ip: req.ip ?? null, userAgent: userAgent ?? null });
    }
}
