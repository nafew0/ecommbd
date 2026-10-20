import { describe, expect, it } from 'vitest';
import { editDistance, normalizeForSearch, phoneticKey, search } from './search';

const firstId = (query: string, options?: Parameters<typeof search>[1]) => search(query, options)[0]?.unit.id;

describe('normalizeForSearch', () => {
    it('lowercases, applies NFC, converts Bangla digits and drops spaces and punctuation', () => {
        expect(normalizeForSearch("  Cox's  Bazar ")).toBe('coxsbazar');
        expect(normalizeForSearch('Sher-e-Bangla Nagar')).toBe('sherebanglanagar');
        expect(normalizeForSearch('মিরপুর ১০')).toBe('মিরপুর10');
        expect(normalizeForSearch('\u09AA\u09DC\u09BE')).toBe('\u09AA\u09A1\u09BC\u09BE');
    });
});

describe('phoneticKey', () => {
    it('folds common romanization differences', () => {
        expect(phoneticKey('monohargonj')).toBe(phoneticKey('manoharganj'));
        expect(phoneticKey('fultola')).toBe(phoneticKey('phultala'));
        expect(phoneticKey('botiaghata')).toBe(phoneticKey('batiaghata'));
        expect(phoneticKey('syedpur')).toBe('siadpur'.replace(/[aeiou]+/g, 'a'));
    });

    it('leaves Bangla script alone', () => {
        expect(phoneticKey('ঢাকা')).toBe('ঢাকা');
    });
});

describe('editDistance', () => {
    it('counts edits and stops early above the limit', () => {
        expect(editDistance('bogra', 'bogura', 2)).toBe(1);
        expect(editDistance('kitten', 'sitting', 3)).toBe(3);
        expect(editDistance('abc', 'abcdef', 1)).toBe(2);
        expect(editDistance('abcd', 'wxyz', 1)).toBe(2);
    });
});

describe('search', () => {
    it.each([
        ['Chittagong', 'BD2015'],
        ['Comilla', 'BD2019'],
        ['Jessore', 'BD4041'],
        ['Barisal', 'BD1006'],
        ['Bogra', 'BD5010'],
        ['Chapai Nawabganj', 'BD5070'],
        ['Chapainawabganj', 'BD5070'],
        ['Jhalakathi', 'BD1042'],
        ['Netrakona', 'BD4572'],
        ['coxs bazar', 'BD2022'],
    ])('finds the district for the old or alternate spelling %s', (query, id) => {
        expect(firstId(query)).toBe(id);
    });

    it('finds Bangla names and spelling variants', () => {
        expect(firstId('চট্টগ্রাম')).toBe('BD2015');
        expect(firstId('নেত্রকোনা')).toBe('BD4572');
        expect(firstId('বগুড়া')).toBe('BD5010');
    });

    it('finds places by prefix, sound-alike spelling and small typos', () => {
        expect(firstId('Dhanmo')).toBe('BD3026M12');
        expect(firstId('Monohargonj')).toBe('BD20190074');
        expect(firstId('Bashundhara', { kinds: ['thana'] })).toBe('BD3026M49');
        expect(firstId('Mohammadpru')).toBe('BD3026M27');
        expect(firstId('Sylhett')).toBe('BD6091');
        expect(firstId('ashulia')).toBe('BD30260072');
    });

    it('finds text inside longer names', () => {
        const results = search('bangla', { kinds: ['thana'] }).map(result => result.unit.en);
        expect(results).toContain('Sher-e-Bangla Nagar');
    });

    it('returns every place that shares a name, best match first', () => {
        const mirpurs = search('Mirpur', { kinds: ['thana'] }).filter(result => result.score === 100);
        expect(mirpurs.map(result => result.unit.id).sort()).toEqual(['BD3026M26', 'BD40500094']);
    });

    it('limits results to one district and to a number of results', () => {
        const results = search('Mirpur', { districtId: 'BD4050' });
        expect(results.map(result => result.unit.id)).toEqual(['BD40500094']);
        expect(search('sadar', { limit: 3 })).toHaveLength(3);
    });

    it('ranks districts above divisions and thanas on equal scores', () => {
        expect(search('Dhaka').map(result => result.unit.kind)).toEqual(
            expect.arrayContaining(['district', 'division']),
        );
        expect(search('Dhaka')[0]!.unit.kind).toBe('district');
        expect(search('Rajshahi')[1]!.unit.kind).toBe('division');
    });

    it('returns nothing for empty or unmatched queries', () => {
        expect(search('')).toEqual([]);
        expect(search(' - ')).toEqual([]);
        expect(search('xq')).toEqual([]);
        expect(search('zzzzzzzzzz')).toEqual([]);
    });
});
