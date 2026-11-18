import { dhakaDateKey, type AccountSettings } from '@ecommbd/shared';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, Logger, PaymentStateTransitionEvent, TransactionalConnection } from '@vendure/core';
import { COD_METHOD_CODE, MFS_METHOD_CODES, STAFF_METHOD_CODE } from '../payments-bd/constants';
import { ONLINE_HANDLER_CODE } from '../payments-online/constants';
import { AccountSettingsService } from './account-settings.service';
import { AccountService } from './account.service';
import { loggerCtx } from './constants';
import { insertTransaction } from './ledger';

/**
 * Settled order payments land in the account the shop chose.
 * This does not run inside the payment transaction: a ledger problem must not undo a settlement.
 * Staff cash (`bd-staff`) is skipped so it is not counted twice when someone also writes it by hand.
 */
@Injectable()
export class PostingService implements OnApplicationBootstrap {
    constructor(
        private events: EventBus,
        private settings: AccountSettingsService,
        private accounts: AccountService,
        private connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap() {
        this.events.ofType(PaymentStateTransitionEvent).subscribe(event => {
            if (event.toState !== 'Settled' || event.fromState === 'Settled') return;
            this.onSettled(event).catch(error => {
                Logger.error(
                    `Could not record settled payment ${event.payment.id}: ${error instanceof Error ? error.message : 'failed'}`,
                    loggerCtx,
                );
            });
        });
    }

    private async onSettled(event: PaymentStateTransitionEvent) {
        if (event.payment.method === STAFF_METHOD_CODE || event.payment.amount <= 0) return;
        const settings = await this.settings.get(event.ctx);
        const accountKey = accountForMethod(event.payment.method, settings);
        if (!accountKey) return;
        const accountId = this.accounts.raw(accountKey);
        await insertTransaction(event.ctx, this.connection, {
            accountId,
            direction: 'in',
            amount: event.payment.amount,
            day: dhakaDateKey(new Date()),
            source: 'order',
            sourceId: String(event.order.id),
            note: event.order.code,
            idempotencyKey: `payment:${event.payment.id}`,
        });
    }
}

export function accountForMethod(method: string, settings: AccountSettings): string | null {
    if (method === COD_METHOD_CODE) return settings.codAccountId;
    if (method === ONLINE_HANDLER_CODE) return settings.gatewayAccountId;
    if (method === MFS_METHOD_CODES.bkash) return settings.bkashAccountId;
    if (method === MFS_METHOD_CODES.nagad) return settings.nagadAccountId;
    if (method === MFS_METHOD_CODES.rocket) return settings.rocketAccountId;
    return null;
}
