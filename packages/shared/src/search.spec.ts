import { describe, expect, it } from 'vitest';
import {
    cleanSearchQuery,
    defaultSearchSettings,
    editDistance,
    isPrivateSearchTerm,
    parseSearchSettings,
    queryWords,
    SEARCH_LIMITS,
    searchKey,
    searchWords,
    trigramSimilarity,
} from './search';

const ZWJ = String.fromCodePoint(0x200d);
const ZWNJ = String.fromCodePoint(0x200c);
const ZWSP = String.fromCodePoint(0x200b);

describe('searchKey', () => {
    it('compares both spellings of ড় as one (NFC)', () => {
        expect(searchKey('বড়ড়')).toBe(searchKey('বড়ড়'));
        expect(searchKey('ড়')).toBe('ড়');
    });

    it('ignores zero-width joiners and spaces when they vary', () => {
        const rafla = `র${ZWJ}্যাব`;
        expect(searchKey(rafla)).toBe('র্যাব');
        expect(searchKey(`ক${ZWNJ}্ষ`)).toBe(searchKey('ক্ষ'));
        expect(searchKey(`pan${ZWSP}jabi`)).toBe('panjabi');
    });

    it('turns Bangla digits into ASCII, lowercases and removes Latin accents', () => {
        expect(searchKey('৫০০ গ্রাম')).toBe('500 গ্রাম');
        expect(searchKey('Café  BLACK')).toBe('cafe black');
    });

    it('folds long vowels into short ones', () => {
        expect(searchKey('শাড়ী')).toBe(searchKey('শাড়ি'));
        expect(searchKey('পাঞ্জাবী')).toBe(searchKey('পাঞ্জাবি'));
        expect(searchKey('ঈদ')).toBe(searchKey('ইদ'));
    });
});

describe('searchWords', () => {
    it('keeps Bangla words whole, with their vowel signs, virama and nukta', () => {
        expect(searchWords('সুতির পাঞ্জাবি (কালো)')).toEqual(['সুতির', 'পাঞ্জাবি', 'কালো']);
    });

    it('gives a hyphenated word joined and as its parts', () => {
        expect(searchWords('T-Shirt')).toEqual(['tshirt', 't', 'shirt']);
        expect(searchWords('থ্রি-পিস')).toEqual(['থ্রিপিস', 'থ্রি', 'পিস']);
    });

    it('splits on punctuation, the Bangla full stop and symbols', () => {
        expect(searchWords('Ghee, 500ml। খাঁটি/pure')).toEqual(['ghee', '500ml', 'খাঁটি', 'pure']);
        expect(searchWords("Men's")).toEqual(['mens']);
    });
});

describe('memoized words and trigrams', () => {
    it('return the same words for the same text, and stay bounded', () => {
        const first = searchWords('Cotton Panjabi');
        expect(searchWords('Cotton Panjabi')).toBe(first);
        // More texts than the memo keeps: it starts over instead of growing.
        for (let index = 0; index < 50_005; index++) {
            searchWords(`w${index}`);
            trigramSimilarity(`w${index}`, 'w');
        }
        expect(searchWords('Cotton Panjabi')).toEqual(['cotton', 'panjabi']);
    });
});

describe('queryWords', () => {
    it('keeps order, drops repeats, joins hyphens', () => {
        expect(queryWords('black  পাঞ্জাবি black')).toEqual(['black', 'পাঞ্জাবি']);
        expect(queryWords('t-shirt')).toEqual(['tshirt']);
    });

    it('leaves out stop words unless nothing else is left', () => {
        expect(queryWords('watch for men')).toEqual(['watch', 'men']);
        expect(queryWords('ছেলেদের জন্য ঘড়ি')).toEqual(['ছেলেদের', 'ঘড়ি']);
        expect(queryWords('for')).toEqual(['for']);
    });

    it('caps long queries', () => {
        expect(cleanSearchQuery('a'.repeat(300))).toHaveLength(SEARCH_LIMITS.query);
        expect(queryWords('one two three four five six seven eight nine ten')).toHaveLength(
            SEARCH_LIMITS.words,
        );
    });

    it('treats SQL and regex characters as plain separators', () => {
        expect(queryWords(`'; DROP TABLE product; -- .*(`)).toEqual(['drop', 'table', 'product']);
        expect(queryWords('')).toEqual([]);
    });
});

describe('typo measures', () => {
    it('measures trigram similarity like pg_trgm', () => {
        expect(trigramSimilarity('panjabi', 'panjabi')).toBe(1);
        expect(trigramSimilarity('panjabi', 'punjabi')).toBeCloseTo(5 / 11, 5);
        expect(trigramSimilarity('panjabi', 'pajama')).toBeLessThan(0.3);
    });

    it('counts typos, including swapped letters, in Unicode characters', () => {
        expect(editDistance('panjabi', 'punjabi')).toBe(1);
        expect(editDistance('kurti', 'kruti')).toBe(1);
        expect(editDistance('জামদানি', 'জামদানী')).toBe(1);
        expect(editDistance('saree', 'sarees')).toBe(1);
        expect(editDistance('abc', 'xyz')).toBe(3);
        expect(editDistance('panjabi', 'kurta', 1)).toBe(2);
        // Stops as soon as a row is past the limit.
        expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2);
    });
});

describe('isPrivateSearchTerm', () => {
    it('spots phone numbers and emails', () => {
        expect(isPrivateSearchTerm('01712345678')).toBe(true);
        expect(isPrivateSearchTerm('০১৭১২৩৪৫৬৭৮')).toBe(true);
        expect(isPrivateSearchTerm('rahim@example.com')).toBe(true);
        expect(isPrivateSearchTerm('ghee 500')).toBe(false);
        expect(isPrivateSearchTerm('panjabi')).toBe(false);
    });
});

describe('search settings', () => {
    it('accepts the starter synonyms', () => {
        const parsed = parseSearchSettings(defaultSearchSettings());
        expect(parsed.ok).toBe(true);
    });

    it('cleans terms and drops empty and repeated ones', () => {
        const parsed = parseSearchSettings({ synonyms: [[' Panjabi ', 'panjabi', '', 'পাঞ্জাবী']] });
        expect(parsed).toEqual({ ok: true, value: { synonyms: [['Panjabi', 'পাঞ্জাবী']] } });
    });

    it('needs two words per group and keeps the limits', () => {
        expect(parseSearchSettings({ synonyms: [['only']] })).toEqual({
            ok: false,
            errors: [{ path: 'synonyms.0', code: 'required' }],
        });
        const long = parseSearchSettings({ synonyms: [['a', 'b'.repeat(41)]] });
        expect(long.ok ? [] : long.errors).toEqual([{ path: 'synonyms.0.1', code: 'tooLong' }]);
        const many = parseSearchSettings({ synonyms: Array.from({ length: 201 }, () => ['a', 'b']) });
        expect(many.ok ? [] : many.errors).toEqual([{ path: 'synonyms', code: 'tooMany' }]);
    });
});
