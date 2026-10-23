import { describe, expect, it } from 'vitest';
import { parseVitals } from '../../src/plugins/cache-purge/vitals';

describe('the speed beacon’s payload', () => {
    // web-vitals' ID: version, page load time (ms), 13 random digits.
    const valid = { metricId: 'v6-1792742906660-1234567890123', name: 'LCP', value: 1234, route: 'product' };

    it('accepts exactly one bounded metric for a known kind of page', () => {
        expect(parseVitals(valid)).toEqual(valid);
        expect(parseVitals({ ...valid, name: 'CLS', value: 0.123456 })).toEqual({
            ...valid,
            name: 'CLS',
            value: 0.1235,
        });
        expect(parseVitals({ ...valid, value: 1234.6 })).toMatchObject({ value: 1235 });
    });

    it('refuses anything else', () => {
        for (const patch of [
            { name: 'TTFB' },
            { value: -1 },
            { value: NaN },
            { value: Infinity },
            { value: 60_001 },
            { name: 'CLS', value: 11 },
            { route: '/private-url' },
            { metricId: 'tiny' },
            { metricId: 'synthetic-vitals-17' },
            { metricId: 'v6-1792742906660-1234567890123x' },
            { name: { toString: 'invalid' } },
            { route: {} },
            { value: '100' },
        ]) {
            expect(parseVitals({ ...valid, ...patch })).toBeNull();
        }
        for (const extra of [{ phone: 'private' }, { url: 'https://private.test' }, { referrer: 'x' }])
            expect(parseVitals({ ...valid, ...extra })).toBeNull();
        const { route: _route, ...missing } = valid;
        expect(parseVitals(missing)).toBeNull();
        for (const input of [null, undefined, [], false, 'text', 42]) expect(parseVitals(input)).toBeNull();
    });
});
