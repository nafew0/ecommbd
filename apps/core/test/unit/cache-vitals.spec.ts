import { describe, it, expect } from 'vitest';
import { parseVitals } from '../../src/plugins/cache-purge/vitals';
describe('anonymous speed measurement validation', () => {
    const valid = { metricId: 'synthetic-vitals-17', name: 'LCP', value: 1234, route: 'product' };
    it('accepts only bounded metrics and route categories', () => {
        expect(parseVitals(valid)).toEqual(valid);
        for (const patch of [
            { name: 'TTFB' },
            { value: -1 },
            { value: NaN },
            { value: Infinity },
            { value: 60001 },
            { name: 'CLS', value: 11 },
            { route: '/private-url' },
            { metricId: 'tiny' },
            { name: { toString: 'invalid' } },
            { route: {} },
            { phone: 'private' },
            { url: 'https://private.test' },
        ]) {
            expect(parseVitals({ ...valid, ...patch })).toBeNull();
        }
        for (const input of [null, undefined, [], false, 'text']) expect(parseVitals(input)).toBeNull();
    });
});
