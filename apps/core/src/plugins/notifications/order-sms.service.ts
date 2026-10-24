import {
    formatBdPhone,
    formatTaka,
    newTrackingToken,
    type SmsEvent,
    type SmsLanguage,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    EventBus,
    type ID,
    Logger,
    Order,
    OrderPlacedEvent,
    OrderService,
    OrderStateTransitionEvent,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { webcrypto } from 'node:crypto';
import { StoreSettingsService } from '../bd-core';
import { BdOrderCancelledWithReasonEvent, BdOrderConfirmedEvent, settledAmount } from '../bd-orders';
import { BdPaymentCheckedEvent } from '../payments-bd';
import { loggerCtx, NOTIFICATIONS_PLUGIN_OPTIONS } from './constants';
import { SmsService } from './sms.service';
import type { NotificationsPluginOptions } from './types';

/**
 * Which order changes send an SMS (phase 10): placed, confirmed, shipped (with the tracking link),
 * delivered, cancelled, and a mobile banking payment verified or rejected. Each is sent once per
 * order and recipient (the idempotency key), in the order's language. Imported orders and manual
 * orders with "Send SMS" off send nothing.
 */
@Injectable()
export class OrderSmsService implements OnApplicationBootstrap {
    constructor(
        @Inject(NOTIFICATIONS_PLUGIN_OPTIONS) private options: NotificationsPluginOptions,
        private eventBus: EventBus,
        private sms: SmsService,
        private orderService: OrderService,
        private connection: TransactionalConnection,
        private moduleRef: ModuleRef,
    ) {}

    /** From bd-core, found like Vendure's own injector does (any module). */
    private get storeSettings() {
        return this.moduleRef.get(StoreSettingsService, { strict: false });
    }

    onApplicationBootstrap() {
        const on = (event: SmsEvent) => (ctx: RequestContext, order: Order, extraKey?: string) =>
            this.send(ctx, order.id, event, extraKey).catch(error =>
                Logger.error(`Order SMS (${event}) failed: ${String(error)}`, loggerCtx),
            );
        // An online order is placed unpaid (phase 18): its "order placed" SMS goes once it's paid.
        this.eventBus.ofType(OrderPlacedEvent).subscribe(e => {
            if (e.order.state !== 'AwaitingPayment') void on('placed')(e.ctx, e.order);
        });
        this.eventBus.ofType(BdOrderConfirmedEvent).subscribe(e => on('confirmed')(e.ctx, e.order));
        this.eventBus.ofType(BdOrderCancelledWithReasonEvent).subscribe(e => on('cancelled')(e.ctx, e.order));
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(e => {
            if (e.fromState === 'AwaitingPayment' && e.toState !== 'Cancelled')
                void on('placed')(e.ctx, e.order);
            if (e.toState === 'Shipped') void on('shipped')(e.ctx, e.order);
            if (e.toState === 'Delivered') void on('delivered')(e.ctx, e.order);
        });
        // One SMS per payment checked (an order can have an advance and a full payment).
        this.eventBus
            .ofType(BdPaymentCheckedEvent)
            .subscribe(e =>
                on(e.outcome === 'verified' ? 'paymentVerified' : 'paymentRejected')(
                    e.ctx,
                    e.order,
                    `payment:${e.payment.id}`,
                ),
            );
    }

    async send(ctx: RequestContext, orderId: ID, event: SmsEvent, extraKey?: string) {
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'payments',
            'payments.refunds',
        ]);
        if (!order || order.customFields.imported || order.customFields.sendSms === false) return;
        const to = order.shippingAddress?.phoneNumber || order.customer?.customFields.phone;
        if (!to) return;
        const language: SmsLanguage = order.customFields.locale === 'en' ? 'en' : 'bn';
        const { profile } = await this.storeSettings.get(ctx);
        const money = (minor: number) => formatTaka(minor, { symbol: false });
        await this.sms.queueSms(ctx, {
            event,
            to,
            language,
            orderId: order.id,
            // The same event never sends twice, even when the event is repeated or retried.
            key: [`order:${order.id}`, event, to, extraKey].filter(Boolean).join(':'),
            values: {
                name: order.shippingAddress?.fullName ?? order.customer?.firstName,
                orderNumber: order.customFields.orderNumber ?? order.code,
                total: money(order.totalWithTax),
                codDue: money(Math.max(0, order.totalWithTax - settledAmount(order))),
                trackingUrl: event === 'shipped' ? await this.trackingUrl(ctx, order) : null,
                storeName: profile.storeName[language] || profile.storeName.bn || profile.storeName.en,
                storePhone: profile.phones[0] ? formatBdPhone(profile.phones[0]) : null,
            },
        });
    }

    /**
     * `<storefront>/t/<token>`: our own short link, no third-party shortener. The token is random
     * (128 bits) and scoped to one order; the page (phase 14) shows only its status, the first name
     * and the district.
     */
    async trackingUrl(ctx: RequestContext, order: Order): Promise<string | null> {
        if (!this.options.storefrontUrl) return null;
        let token = order.customFields.trackingToken;
        if (!token) {
            token = newTrackingToken(bytes => webcrypto.getRandomValues(bytes));
            await this.connection
                .getRepository(ctx, Order)
                .update(order.id, { customFields: { trackingToken: token } });
        }
        return `${this.options.storefrontUrl.replace(/\/$/, '')}/t/${token}`;
    }
}
