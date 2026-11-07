import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { Allow, Permission } from '@vendure/core';
import { WooHelperService } from './helper.service';
import { WooRecord } from './helpers';

@Controller('woo-migrate')
export class WooHelperController {
    constructor(private helper: WooHelperService) {}
    @Post('pair')
    @Allow(Permission.Public)
    pair(@Body() body: { code: string; sourceUrl: string }) {
        return this.helper.pair(body.code, body.sourceUrl);
    }
    @Post('upload/:id')
    @Allow(Permission.Public)
    upload(
        @Param('id') id: string,
        @Body() body: WooRecord,
        @Headers('x-woo-time') time: string,
        @Headers('x-woo-nonce') nonce: string,
        @Headers('x-woo-signature') signature: string,
    ) {
        return this.helper.accept(Number(id), body, time, nonce, signature);
    }
}
