import { describe, expect, it } from 'vitest';
import {
    cleanTags,
    deliveryTags,
    MAX_NAMED_PRODUCTS,
    MAX_PURGE_HEADER,
    productTags,
} from '../../src/plugins/cache-purge/tags';

describe('cache purge tags', () => {
    it('keeps well-formed tags once each', () => {
        expect(cleanTags(['listing', 'listing', 'product:1', 'bad tag', 'x'.repeat(81), 'menus'])).toEqual([
            'listing',
            'product:1',
            'menus',
        ]);
        expect(cleanTags(Array.from({ length: 150 }, (_, i) => `product:${i}`))).toHaveLength(100);
    });

    it('names each product, or every page showing a product when there are too many', () => {
        expect(productTags([1, '2', 1])).toEqual(['product:1', 'product:2']);
        const many = Array.from({ length: MAX_NAMED_PRODUCTS + 1 }, (_, i) => i);
        expect(productTags(many)).toEqual(['products']);
    });

    it('prefixes each tag with the store, so stores sharing a Varnish never purge each other', () => {
        expect(deliveryTags('s1', ['product:4', 'listing'], false)).toEqual({
            header: 's1:product:4 s1:listing',
            dataTags: ['product:4', 'listing'],
            everything: false,
        });
    });

    it('turns a purge-all, a store tag or an overlong list into one purge of the store', () => {
        const everything = { header: 's1:store', dataTags: ['*'], everything: true };
        expect(deliveryTags('s1', ['menus'], true)).toEqual(everything);
        expect(deliveryTags('s1', ['store'], false)).toEqual(everything);
        const long = Array.from({ length: 400 }, (_, i) => `product:${i}`);
        expect(long.map(tag => `s1:${tag}`).join(' ').length).toBeGreaterThan(MAX_PURGE_HEADER);
        expect(deliveryTags('s1', long, false)).toEqual(everything);
    });
});
