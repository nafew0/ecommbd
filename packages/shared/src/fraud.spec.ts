import { describe, expect, it } from 'vitest';
import { assessRisk, defaultFraudSettings, looksLikeGibberish, parseFraudSettings, type RiskInputs } from './fraud';

const clean: RiskInputs = {
    delivered: 0,
    returned: 0,
    fake: 0,
    ordersLast24h: 0,
    duplicateCart: false,
    street: 'House 12, Road 5, Mirpur 10',
    otherThana: false,
    name: 'Rahim Uddin',
};

describe('assessRisk', () => {
    it('gives a new shopper with a real address no risk', () => {
        expect(assessRisk(clean)).toEqual({ score: 0, level: 'low', reasons: [] });
    });

    it('adds up the reasons, with counts', () => {
        expect(assessRisk({ ...clean, returned: 2, fake: 1 })).toEqual({
            score: 70,
            level: 'high',
            reasons: [
                { code: 'fakeBefore', count: 1 },
                { code: 'returnsBefore', count: 2 },
            ],
        });
        expect(
            assessRisk({ ...clean, ordersLast24h: 2, duplicateCart: true, street: 'Mirpur', otherThana: true }),
        ).toEqual({
            score: 55,
            level: 'medium',
            reasons: [
                { code: 'manyOrders', count: 3 },
                { code: 'duplicateCart' },
                { code: 'shortAddress' },
                { code: 'unlistedThana' },
            ],
        });
    });

    it('caps each reason and the total at 100', () => {
        const worst = assessRisk({ ...clean, fake: 5, returned: 9, ordersLast24h: 9, duplicateCart: true, name: 'x' });
        expect(worst.score).toBe(100);
        expect(worst.reasons.map(r => r.code)).toContain('oddName');
    });

    it('lets delivered orders earn trust back, never below 0', () => {
        expect(assessRisk({ ...clean, returned: 1, delivered: 1 })).toMatchObject({ score: 5, level: 'low' });
        expect(assessRisk({ ...clean, delivered: 8 })).toEqual({
            score: 0,
            level: 'low',
            reasons: [{ code: 'deliveredBefore', count: 8 }],
        });
    });
});

describe('looksLikeGibberish', () => {
    it.each(['Rahim Uddin', 'রহিম উদ্দিন', 'Md. Karim', 'Nusrat Jahan', 'Shyamol'])('accepts %s', name => {
        expect(looksLikeGibberish(name)).toBe(false);
    });

    it.each(['a', 'asdfgh', 'Rahim 123', 'রহিম ১২', 'aaaa', 'Bcdfgh', 'qwerty'])('flags %s', name => {
        expect(looksLikeGibberish(name)).toBe(true);
    });
});

describe('fraud settings', () => {
    it('accepts the defaults and refuses bad values with field paths', () => {
        expect(parseFraudSettings(defaultFraudSettings())).toEqual({ ok: true, settings: defaultFraudSettings() });
        const settings = defaultFraudSettings();
        const result = parseFraudSettings({
            ...settings,
            velocity: { ...settings.velocity, duplicateOrderMinutes: 5000, duplicateOrderMessage: { bn: ' ', en: 'x' } },
        });
        expect(result).toEqual({
            ok: false,
            errors: [
                { path: 'velocity.duplicateOrderMinutes', code: 'invalid' },
                { path: 'velocity.duplicateOrderMessage.bn', code: 'required' },
            ],
        });
    });
});
