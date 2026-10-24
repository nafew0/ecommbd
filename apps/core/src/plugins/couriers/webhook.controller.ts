import { Body, Controller, Headers, Param, Post, Res } from '@nestjs/common';
import { Allow, Logger, Permission } from '@vendure/core';
import { COURIER_ROUTE, loggerCtx } from './constants';
import { CourierService } from './courier.service';

interface WebhookResponse {
    status(code: number): WebhookResponse;
    setHeader(name: string, value: string): void;
    json(body: unknown): void;
}

/**
 * Courier status updates (phase 19): `POST <STOREFRONT_URL>/bd-courier/webhook/<courier>/<secret>`.
 * Public by nature; the unguessable secret in the path and the courier's own header (Steadfast's
 * Bearer token, Pathao's X-PATHAO-Signature) must both match the store's webhook secret.
 */
@Controller(COURIER_ROUTE)
export class CourierWebhookController {
    constructor(private couriers: CourierService) {}

    @Post('webhook/:courier/:secret')
    @Allow(Permission.Public)
    async webhook(
        @Param('courier') courier: string,
        @Param('secret') secret: string,
        @Headers() headers: Record<string, string | undefined>,
        @Body() body: unknown,
        @Res() res: WebhookResponse,
    ) {
        let answer: { status: number; headers?: Record<string, string> };
        try {
            answer = await this.couriers.webhook(courier, secret.slice(0, 100), headers, body);
        } catch (error) {
            Logger.error(`Courier webhook failed: ${String(error)}`, loggerCtx);
            answer = { status: 500 };
        }
        for (const [name, value] of Object.entries(answer.headers ?? {})) res.setHeader(name, value);
        res.status(answer.status).json({ status: answer.status === 202 ? 'success' : 'error' });
    }
}
