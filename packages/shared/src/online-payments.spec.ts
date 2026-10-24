import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    bkashFailure,
    defaultOnlinePaymentSettings,
    fromGatewayAmount,
    hasAllCredentials,
    mergeCredentials,
    nextReconcileDelayMs,
    parseOnlinePaymentSettings,
    toGatewayAmount,
} from './online-payments';
import { sslcommerzSignatureValid } from './sslcommerz-sign';

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

describe('gateway amounts', () => {
    it('writes poisha as decimal taka', () => {
        expect(toGatewayAmount(125000)).toBe('1250.00');
        expect(toGatewayAmount(125010)).toBe('1250.10');
        expect(toGatewayAmount(5)).toBe('0.05');
        expect(() => toGatewayAmount(-1)).toThrow();
        expect(() => toGatewayAmount(1.5)).toThrow();
    });

    it('reads gateway amounts as text, never as floats', () => {
        expect(fromGatewayAmount('1250')).toBe(125000);
        expect(fromGatewayAmount('1250.1')).toBe(125010);
        expect(fromGatewayAmount('1250.10')).toBe(125010);
        expect(fromGatewayAmount(' 1250.00 ')).toBe(125000);
        expect(fromGatewayAmount(1250)).toBe(125000);
        expect(fromGatewayAmount('1,250.00')).toBeNull();
        expect(fromGatewayAmount('1250.001')).toBeNull();
        expect(fromGatewayAmount('-5')).toBeNull();
        expect(fromGatewayAmount(undefined)).toBeNull();
    });
});

describe('SSLCommerz verify_sign', () => {
    const sign = (fields: Record<string, string>, password: string) => {
        const pairs: Record<string, string> = { ...fields, store_passwd: md5(password) };
        return md5(
            Object.keys(pairs)
                .sort()
                .map(key => `${key}=${pairs[key]}`)
                .join('&'),
        );
    };
    const signed = { tran_id: 'A1', val_id: 'V1', amount: '1250.00', status: 'VALID' };
    const post = {
        ...signed,
        risk_level: '0',
        verify_key: Object.keys(signed).join(','),
        verify_sign: sign(signed, 'secret'),
    };

    it('accepts a correctly signed post', () => {
        expect(sslcommerzSignatureValid(post, 'secret')).toBe(true);
    });

    it('refuses a changed field, a wrong password or a missing signature', () => {
        expect(sslcommerzSignatureValid({ ...post, amount: '1.00' }, 'secret')).toBe(false);
        expect(sslcommerzSignatureValid(post, 'other')).toBe(false);
        expect(sslcommerzSignatureValid({ ...post, verify_sign: '' }, 'secret')).toBe(false);
        expect(sslcommerzSignatureValid({ ...post, verify_key: undefined }, 'secret')).toBe(false);
    });
});

describe('settings and credentials', () => {
    it('accepts the defaults and refuses an expiry out of range', () => {
        expect(parseOnlinePaymentSettings(defaultOnlinePaymentSettings()).ok).toBe(true);
        const result = parseOnlinePaymentSettings({ ...defaultOnlinePaymentSettings(), expiryMinutes: 5 });
        expect(result).toMatchObject({ ok: false, errors: [{ path: 'expiryMinutes', code: 'invalid' }] });
    });

    it('keeps saved secrets when the form leaves them blank', () => {
        const saved = { storeId: 'shop1', storePassword: 'old' };
        expect(mergeCredentials('sslcommerz', saved, { storeId: ' shop2 ', storePassword: '' })).toEqual({
            ok: true,
            credentials: { storeId: 'shop2', storePassword: 'old' },
        });
        expect(mergeCredentials('sslcommerz', null, { storeId: 5 })).toMatchObject({ ok: false });
        expect(hasAllCredentials('bkash', { username: 'u', password: 'p', appKey: 'k', appSecret: '' })).toBe(
            false,
        );
    });
});

describe('reconciliation timetable', () => {
    const hour = 3_600_000;
    it('checks often for a day, hourly for a week, then stops', () => {
        expect(nextReconcileDelayMs(0)).toBe(300_000);
        expect(nextReconcileDelayMs(23 * hour)).toBe(300_000);
        expect(nextReconcileDelayMs(25 * hour)).toBe(hour);
        expect(nextReconcileDelayMs(8 * 24 * hour)).toBeNull();
    });
});

describe('bKash failures', () => {
    it('groups error codes into what the shopper can do', () => {
        expect(bkashFailure('2023')).toBe('insufficientBalance');
        expect(bkashFailure(2014)).toBe('verification');
        expect(bkashFailure('2062')).toBe('alreadyPaid');
        expect(bkashFailure('9999')).toBe('failed');
        expect(bkashFailure(undefined)).toBe('failed');
    });
});
