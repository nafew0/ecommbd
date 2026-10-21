import { z } from 'zod';
import type { ParseResult } from './content';
import { toSettingsFieldErrors } from './store-settings';
import { banglaToAsciiDigits, cleanText } from './text';

/**
 * Product search text rules (roadmap phase 13), shared by the core's search, the storefront and
 * the merchant admin. Text is compared in a "search key" form; the stored text never changes.
 */

export const SEARCH_LIMITS = {
    /** Characters of a query; longer queries are cut. */
    query: 100,
    /** Words of a query that count. */
    words: 8,
    synonymGroups: 200,
    synonymTerms: 10,
    synonymTerm: 40,
} as const;

/** Zero-width space, ZWNJ, ZWJ, word joiner and BOM: kept in stored text, ignored when comparing. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Long and short vowels that shoppers swap all the time (শাড়ী / শাড়ি) compare equal. */
const VOWEL_FOLD: Record<string, string> = { 'ী': 'ি', 'ূ': 'ু', ঈ: 'ই', ঊ: 'উ' };

/** Letters, combining marks (Bangla vowel signs, virama, nukta) and digits make up words. */
const NOT_WORD = /[^\p{L}\p{M}\p{N}-]+/u;

/**
 * The form search compares text in: NFC, lowercase, Latin accents removed, Bangla digits as ASCII,
 * long vowels folded to short ones, zero-width characters and apostrophes removed, single spaces.
 */
export function searchKey(input: string): string {
    return banglaToAsciiDigits(
        input
            .normalize('NFD')
            // Latin accents only: Bangla signs are outside this range.
            .replace(/[̀-ͯ]/g, '')
            .normalize('NFC')
            .replace(ZERO_WIDTH, '')
            .toLowerCase(),
    )
        .replace(/[ীূঈঊ]/g, vowel => VOWEL_FOLD[vowel]!)
        .replace(/['’`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const wordCache = new Map<string, string[]>();

/**
 * The words of a product text, in search form. A hyphenated word counts joined and as its parts:
 * `T-shirt` → `tshirt`, `t`, `shirt`. Results are memoized (product names repeat on every search).
 */
export function searchWords(input: string): string[] {
    const cached = wordCache.get(input);
    if (cached) return cached;
    const words = new Set<string>();
    for (const raw of searchKey(input).split(NOT_WORD)) {
        const parts = raw.split('-').filter(Boolean);
        if (!parts.length) continue;
        words.add(parts.join(''));
        if (parts.length > 1) for (const part of parts) words.add(part);
    }
    const result = [...words];
    if (wordCache.size > 50_000) wordCache.clear();
    wordCache.set(input, result);
    return result;
}

/** A shopper's query as typed, made safe to show and store: cleaned and cut to the limit. */
export function cleanSearchQuery(input: string): string {
    return cleanText(input).slice(0, SEARCH_LIMITS.query).trim();
}

/** Little words shoppers add that say nothing about the product ("watch for men"). */
const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'the',
    'for',
    'of',
    'with',
    'in',
    'to',
    'জন্য',
    'এর',
    'ও',
    'এবং',
    'সহ',
]);

/**
 * The words of a query, in order, without repeats, at most `SEARCH_LIMITS.words`. Hyphens join.
 * Stop words are left out unless nothing else is left.
 */
export function queryWords(input: string): string[] {
    const words: string[] = [];
    for (const raw of searchKey(cleanSearchQuery(input)).split(NOT_WORD)) {
        const word = raw.replace(/-/g, '');
        if (word && !words.includes(word)) words.push(word);
    }
    const meaningful = words.filter(word => !STOP_WORDS.has(word));
    return (meaningful.length ? meaningful : words).slice(0, SEARCH_LIMITS.words);
}

const trigramCache = new Map<string, Set<string>>();

function trigrams(word: string): Set<string> {
    const cached = trigramCache.get(word);
    if (cached) return cached;
    const chars = [...`  ${word} `];
    const set = new Set<string>();
    for (let index = 0; index + 2 < chars.length; index++) {
        set.add(`${chars[index]}${chars[index + 1]}${chars[index + 2]}`);
    }
    if (trigramCache.size > 50_000) trigramCache.clear();
    trigramCache.set(word, set);
    return set;
}

/** Shared trigrams over all trigrams (as PostgreSQL's pg_trgm): 1 for the same word, 0 for nothing alike. */
export function trigramSimilarity(a: string, b: string): number {
    const first = trigrams(a);
    const second = trigrams(b);
    let shared = 0;
    for (const gram of first) if (second.has(gram)) shared++;
    return shared / (first.size + second.size - shared);
}

/**
 * Typos between two words (insertions, deletions, substitutions and swapped neighbours), counted
 * in Unicode characters. Stops early: anything above `max` returns `max + 1`.
 */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
    const s = [...a];
    const t = [...b];
    if (Math.abs(s.length - t.length) > max) return max + 1;
    let before = new Array<number>(t.length + 1).fill(0);
    let previous = Array.from({ length: t.length + 1 }, (_, index) => index);
    for (let i = 1; i <= s.length; i++) {
        const current = [i];
        let rowMin = i;
        for (let j = 1; j <= t.length; j++) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1;
            let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
            if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
                value = Math.min(value, before[j - 2]! + 1);
            }
            current[j] = value;
            rowMin = Math.min(rowMin, value);
        }
        if (rowMin > max) return max + 1;
        before = previous;
        previous = current;
    }
    return previous[t.length]!;
}

/** Search terms that look like a phone number or an email: never stored (no personal data). */
export function isPrivateSearchTerm(term: string): boolean {
    return term.includes('@') || (banglaToAsciiDigits(term).match(/\d/g)?.length ?? 0) >= 6;
}

const synonymGroup = z
    .array(z.string().max(SEARCH_LIMITS.synonymTerm * 2, 'tooLong'))
    .max(SEARCH_LIMITS.synonymTerms, 'tooMany')
    .transform(terms => {
        // Cleaned, empty ones dropped, and the same word (in search form) only once.
        const seen = new Set<string>();
        return terms
            .map(term => cleanText(term))
            .filter(term => {
                const key = searchKey(term);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    })
    .superRefine((terms, context) => {
        if (terms.length < 2) context.addIssue({ code: 'custom', message: 'required' });
        terms.forEach((term, index) => {
            if (term.length > SEARCH_LIMITS.synonymTerm) {
                context.addIssue({ code: 'custom', path: [index], message: 'tooLong' });
            }
        });
    });

/**
 * Search settings per store (`bdSearch.settings` in the settings store). Synonyms are groups of
 * words or short phrases that find each other, in both directions: `panjabi, পাঞ্জাবি, punjabi`.
 */
export const searchSettingsSchema = z.object({
    synonyms: z.array(synonymGroup).max(SEARCH_LIMITS.synonymGroups, 'tooMany'),
});

export type SearchSettings = z.output<typeof searchSettingsSchema>;

/** A new store's starter synonyms: common Bangladeshi spellings the merchant can change. */
export function defaultSearchSettings(): SearchSettings {
    return {
        synonyms: [
            ['panjabi', 'punjabi', 'পাঞ্জাবি'],
            ['tshirt', 't-shirt', 'tee', 'টি-শার্ট', 'টিশার্ট'],
            ['saree', 'sari', 'শাড়ি'],
            ['three piece', 'threepiece', 'থ্রি পিস', 'থ্রিপিস'],
            ['borka', 'burqa', 'borkha', 'বোরকা'],
            ['hijab', 'হিজাব'],
            ['lungi', 'লুঙ্গি'],
            ['kurti', 'কুর্তি'],
            ['shoe', 'shoes', 'জুতা'],
            ['bag', 'ব্যাগ'],
            ['watch', 'ঘড়ি'],
            ['honey', 'মধু'],
            ['ghee', 'ঘি'],
        ],
    };
}

export function parseSearchSettings(input: unknown): ParseResult<SearchSettings> {
    const result = searchSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, value: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}
