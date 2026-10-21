import { OTP_RULES, startOfDhakaDay } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    ActiveOrderService,
    type ID,
    Order,
    type RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { MoreThanOrEqual } from 'typeorm';
import { StoreSettingsService } from '../bd-core';
import { SmsService } from '../notifications';
import { BdOtpCode } from './entities';
import { FraudSettingsService } from './fraud-settings.service';
import { RiskService } from './risk.service';

export type OtpErrorCode =
    | 'NO_ACTIVE_ORDER'
    | 'NOT_NEEDED'
    | 'COOLDOWN'
    | 'DAILY_LIMIT'
    | 'NO_CODE'
    | 'EXPIRED'
    | 'WRONG_CODE'
    | 'TOO_MANY_ATTEMPTS'
    | 'NOT_ALLOWED';

export interface OtpResult {
    success: boolean;
    errorCode: OtpErrorCode | null;
    message: string | null;
    retryAfterSeconds: number | null;
    attemptsLeft: number | null;
}

const hashOf = (orderId: ID, code: string) => createHash('sha256').update(`${orderId}:${code}`).digest('hex');

/**
 * Verification codes for COD (roadmap phase 11), when the store asks for them: for every COD
 * order, first-time phones, or risky orders. 6 digits, 5 minutes, 3 tries per code, a minute
 * between sends and 5 a phone a day, sent through phase 10's SMS (never delayed by quiet hours).
 * Only a hash is kept; codes are never logged and are hidden in the SMS list once sent.
 */
@Injectable()
export class OtpService {
    constructor(
        private connection: TransactionalConnection,
        private activeOrders: ActiveOrderService,
        private settings: FraudSettingsService,
        private risk: RiskService,
        private moduleRef: ModuleRef,
    ) {}

    /** Does this order's COD wait for a code? */
    async needed(ctx: RequestContext, given: Order): Promise<boolean> {
        const { otp } = await this.settings.get(ctx);
        if (otp.mode === 'off') return false;
        const order = await this.risk.withRelations(ctx, given);
        if (order.customFields.otpStatus) return false;
        if (!this.phoneOf(order)) return false;
        if (otp.mode === 'all') return true;
        if (otp.mode === 'risky') return this.risk.isRisky(ctx, order);
        // First-time phones: no earlier placed order from this customer.
        const customerId = order.customerId ?? order.customer?.id;
        if (!customerId) return true;
        const earlier = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('o')
            .where('o.customerId = :customerId AND o.id <> :id AND o.orderPlacedAt IS NOT NULL', {
                customerId,
                id: order.id,
            })
            .getCount();
        return earlier === 0;
    }

    async send(ctx: RequestContext): Promise<OtpResult> {
        const order = await this.activeOrder(ctx);
        if (!order) return this.fail(ctx, 'NO_ACTIVE_ORDER');
        if (!(await this.needed(ctx, order))) return this.fail(ctx, 'NOT_NEEDED');
        const phone = this.phoneOf(order)!;
        const repository = this.connection.getRepository(ctx, BdOtpCode);
        const now = Date.now();
        const last = await repository.findOne({ where: { phone }, order: { createdAt: 'DESC' } });
        const wait = last ? Math.ceil((last.createdAt.getTime() + OTP_RULES.cooldownMs - now) / 1000) : 0;
        if (wait > 0) return this.fail(ctx, 'COOLDOWN', { retryAfterSeconds: wait });
        const today = await repository.count({ where: { phone, createdAt: MoreThanOrEqual(startOfDhakaDay(new Date(now))) } });
        if (today >= OTP_RULES.perPhonePerDay) return this.fail(ctx, 'DAILY_LIMIT');

        const code = String(randomInt(0, 10 ** OTP_RULES.length)).padStart(OTP_RULES.length, '0');
        const saved = await repository.save(
            new BdOtpCode({
                phone,
                orderId: order.id,
                codeHash: hashOf(order.id, code),
                expiresAt: new Date(now + OTP_RULES.ttlMs),
                attempts: 0,
                verifiedAt: null,
            }),
        );
        const language = order.customFields.locale === 'en' ? 'en' : 'bn';
        const { profile } = await this.moduleRef.get(StoreSettingsService, { strict: false }).get(ctx);
        await this.moduleRef.get(SmsService, { strict: false }).queueSms(ctx, {
            event: 'otp',
            to: phone,
            language,
            key: `otp:${saved.id}`,
            urgent: true,
            values: { code, storeName: profile.storeName[language] || profile.storeName.bn || profile.storeName.en },
        });
        return { ...this.ok(), retryAfterSeconds: OTP_RULES.cooldownMs / 1000 };
    }

    async verify(ctx: RequestContext, code: string): Promise<OtpResult> {
        const order = await this.activeOrder(ctx);
        if (!order) return this.fail(ctx, 'NO_ACTIVE_ORDER');
        const repository = this.connection.getRepository(ctx, BdOtpCode);
        const latest = await repository.findOne({ where: { orderId: order.id }, order: { createdAt: 'DESC' } });
        if (!latest || latest.verifiedAt) return this.fail(ctx, 'NO_CODE');
        if (latest.expiresAt.getTime() <= Date.now()) return this.fail(ctx, 'EXPIRED');
        if (latest.attempts >= OTP_RULES.attempts) return this.fail(ctx, 'TOO_MANY_ATTEMPTS');
        latest.attempts += 1;
        await repository.save(latest);
        const typed = Buffer.from(hashOf(order.id, code.replace(/\D/g, '')), 'hex');
        if (!timingSafeEqual(typed, Buffer.from(latest.codeHash, 'hex'))) {
            const attemptsLeft = OTP_RULES.attempts - latest.attempts;
            return this.fail(ctx, attemptsLeft ? 'WRONG_CODE' : 'TOO_MANY_ATTEMPTS', { attemptsLeft });
        }
        latest.verifiedAt = new Date();
        await repository.save(latest);
        await this.mark(ctx, order.id, 'verified');
        return this.ok();
    }

    /** No SMS reached the shopper: order anyway, marked "not verified", if the store allows it. */
    async skip(ctx: RequestContext): Promise<OtpResult> {
        const order = await this.activeOrder(ctx);
        if (!order) return this.fail(ctx, 'NO_ACTIVE_ORDER');
        const { otp } = await this.settings.get(ctx);
        if (!otp.allowUnverified) return this.fail(ctx, 'NOT_ALLOWED');
        const first = await this.connection
            .getRepository(ctx, BdOtpCode)
            .findOne({ where: { orderId: order.id }, order: { createdAt: 'ASC' } });
        // Only after a code was sent and the shopper waited for it.
        const wait = first ? Math.ceil((first.createdAt.getTime() + OTP_RULES.cooldownMs - Date.now()) / 1000) : null;
        if (wait === null) return this.fail(ctx, 'NO_CODE');
        if (wait > 0) return this.fail(ctx, 'COOLDOWN', { retryAfterSeconds: wait });
        await this.mark(ctx, order.id, 'unverified');
        return this.ok();
    }

    private async mark(ctx: RequestContext, orderId: ID, otpStatus: 'verified' | 'unverified') {
        await this.connection.getRepository(ctx, Order).update(orderId, { customFields: { otpStatus } });
    }

    private phoneOf(order: Order): string | null {
        return order.customer?.customFields?.phone ?? null;
    }

    private async activeOrder(ctx: RequestContext): Promise<Order | undefined> {
        const active = ctx.authorizedAsOwnerOnly ? await this.activeOrders.getActiveOrder(ctx, undefined) : undefined;
        return active ? this.risk.withRelations(ctx, active) : undefined;
    }

    private ok(): OtpResult {
        return { success: true, errorCode: null, message: null, retryAfterSeconds: null, attemptsLeft: null };
    }

    private fail(
        ctx: RequestContext,
        errorCode: OtpErrorCode,
        extra: { retryAfterSeconds?: number; attemptsLeft?: number } = {},
    ): OtpResult {
        return {
            success: false,
            errorCode,
            message: ctx.translate(`message.fraud-guard.otp.${errorCode}`),
            retryAfterSeconds: extra.retryAfterSeconds ?? null,
            attemptsLeft: extra.attemptsLeft ?? null,
        };
    }
}
