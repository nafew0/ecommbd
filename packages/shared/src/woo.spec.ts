import { describe, expect, it } from 'vitest';
import { WOO_BD_DISTRICTS, wooDistrictName } from './woo';

describe("WooCommerce's district codes", () => {
    it('has all 64 districts, in WooCommerce order', () => {
        expect(WOO_BD_DISTRICTS).toHaveLength(64);
        expect(new Set(WOO_BD_DISTRICTS).size).toBe(64);
        expect(WOO_BD_DISTRICTS[0]).toBe('Bandarban');
        expect(WOO_BD_DISTRICTS[63]).toBe('Thakurgaon');
    });

    it('names addresses and shipping-zone regions, and nothing else', () => {
        expect(wooDistrictName('BD-13')).toBe('Dhaka');
        expect(wooDistrictName(' BD-30 ')).toBe('Kushtia');
        expect(wooDistrictName('BD:BD-13')).toBe('Dhaka');
        expect(wooDistrictName('BD-65')).toBeNull();
        expect(wooDistrictName('BD-00')).toBeNull();
        expect(wooDistrictName('Dhaka')).toBeNull();
        expect(wooDistrictName('')).toBeNull();
    });
});
