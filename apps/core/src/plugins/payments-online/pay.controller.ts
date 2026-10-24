import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Allow, Logger, Permission } from '@vendure/core';
import { loggerCtx, PAY_ROUTE } from './constants';
import { OnlinePaymentService } from './online-payment.service';

interface RedirectResponse {
    setHeader(name: string, value: string): void;
    redirect(status: number, url: string): void;
}

/** Only the fields SSLCommerz sends, as plain strings; anything else is dropped. */
const SSLCOMMERZ_FIELDS = [
    'status',
    'tran_id',
    'val_id',
    'amount',
    'store_amount',
    'currency',
    'bank_tran_id',
    'card_type',
    'tran_date',
    'risk_level',
    'risk_title',
    'value_a',
    'value_b',
    'currency_type',
    'currency_amount',
    'verify_sign',
    'verify_key',
    'error',
];

function sslcommerzFields(body: unknown): Record<string, string> {
    const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const fields: Record<string, string> = {};
    for (const name of SSLCOMMERZ_FIELDS) {
        const value = input[name];
        if (typeof value === 'string') fields[name] = value.slice(0, 1000);
    }
    // verify_key may name fields we don't keep: signed with whatever was sent.
    for (const name of (fields.verify_key ?? '').split(',')) {
        const value = input[name];
        if (name && !(name in fields) && typeof value === 'string') fields[name] = value.slice(0, 1000);
    }
    return fields;
}

function go(res: RedirectResponse, url: string) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(303, url);
}

/**
 * The online payment routes (phase 18), at `<STOREFRONT_URL>/bd-pay/…` (the storefront passes them to
 * the core). Public by nature: the shopper's browser and the gateways call them. None of them trusts
 * what it's given: everything is checked with the gateway, server to server.
 *
 *   GET  /bd-pay/start/<attempt>                       → the gateway's payment page
 *   POST /bd-pay/again/<tracking token>                → "Pay now" on the tracking page
 *   POST /bd-pay/sslcommerz/ipn                        SSLCommerz → us (server to server)
 *   POST /bd-pay/sslcommerz/return/<attempt>/<result>  the shopper back from SSLCommerz
 *   GET  /bd-pay/bkash/callback/<attempt>              the shopper back from bKash
 */
@Controller(PAY_ROUTE)
export class PayController {
    constructor(private payments: OnlinePaymentService) {}

    @Get('start/:token')
    @Allow(Permission.Public)
    async start(@Param('token') token: string, @Res() res: RedirectResponse) {
        go(res, await this.payments.start(token));
    }

    @Post('again/:trackingToken')
    @Allow(Permission.Public)
    async again(@Param('trackingToken') trackingToken: string, @Res() res: RedirectResponse) {
        go(res, await this.payments.payAgain(trackingToken));
    }

    @Post('sslcommerz/ipn')
    @HttpCode(200)
    @Allow(Permission.Public)
    async sslcommerzIpn(@Body() body: unknown) {
        try {
            await this.payments.sslcommerzNotification(sslcommerzFields(body), 'ipn');
        } catch (error) {
            // A 200 either way: SSLCommerz only retries on errors, and reconciliation catches up.
            Logger.error(`SSLCommerz IPN failed: ${String(error)}`, loggerCtx);
        }
        return 'OK';
    }

    @Post('sslcommerz/return/:token/:result')
    @Allow(Permission.Public)
    async sslcommerzReturn(
        @Param('token') token: string,
        @Body() body: unknown,
        @Res() res: RedirectResponse,
    ) {
        go(res, await this.payments.sslcommerzNotification(sslcommerzFields(body), 'return', token));
    }

    @Get('bkash/callback/:token')
    @Allow(Permission.Public)
    async bkashCallback(
        @Param('token') token: string,
        @Query('paymentID') paymentId: string | undefined,
        @Query('status') status: string | undefined,
        @Res() res: RedirectResponse,
    ) {
        const cleanStatus = ['success', 'failure', 'cancel'].includes(status ?? '') ? status : undefined;
        go(
            res,
            await this.payments.bkashCallback(
                token,
                typeof paymentId === 'string' ? paymentId.slice(0, 100) : undefined,
                cleanStatus,
            ),
        );
    }
}
