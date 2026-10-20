import { allUnits, type GeoUnit } from './geo';

/**
 * Search by name in Bangla or English, including old and alternate spellings ("Bogra" finds
 * Bogura, "Chittagong" finds Chattogram) and small typos. It helps people find a place; an address
 * always stores the IDs picked from the district → thana lists, never a name match. Many names
 * repeat across districts ("Sadar", "Kotwali", "Bandar"), so a name alone can't identify a place.
 */

export interface GeoSearchOptions {
    /** Only these kinds of unit. Default: all. */
    kinds?: ReadonlyArray<GeoUnit['kind']>;
    /** Only thanas of this district. */
    districtId?: string;
    /** Default 10. */
    limit?: number;
}

export interface GeoSearchResult {
    unit: GeoUnit;
    /** Higher is better: exact 100, starts with 80, phonetic 70, contains 60, typo 30–40. */
    score: number;
}

const BANGLA_DIGITS = /[০-৯]/g;

/** Lowercase, NFC, Bangla digits as ASCII, and only letters, marks and digits (no spaces or dots). */
export function normalizeForSearch(input: string): string {
    return input
        .normalize('NFC')
        .toLowerCase()
        .replace(BANGLA_DIGITS, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)))
        .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

/**
 * A rough sound-alike key for romanized Bangla names, so "Monohargonj" matches "Manoharganj" and
 * "Fultola" matches "Phultala": aspirates are folded, vowels collapse, doubled letters merge.
 * Bangla script is returned unchanged.
 */
export function phoneticKey(normalized: string): string {
    if (!/^[a-z0-9]+$/.test(normalized)) {
        return normalized;
    }
    return normalized
        .replace(/ph/g, 'f')
        .replace(/chh/g, 'ch')
        .replace(/([ksgtdbj])h/g, '$1')
        .replace(/w/g, 'u')
        .replace(/y/g, 'i')
        .replace(/z/g, 'j')
        .replace(/[aeiou]+/g, 'a')
        .replace(/(.)\1+/g, '$1');
}

interface IndexedUnit {
    unit: GeoUnit;
    keys: string[];
    phonetic: string[];
}

let index: IndexedUnit[] | undefined;

function getIndex(): IndexedUnit[] {
    index ??= allUnits().map(unit => {
        const keys = [...new Set([unit.en, unit.bn, ...unit.aliases].map(normalizeForSearch))];
        return { unit, keys, phonetic: keys.map(phoneticKey) };
    });
    return index;
}

/** Edit distance, stopping early once it's above `max`. */
export function editDistance(a: string, b: string, max: number): number {
    if (Math.abs(a.length - b.length) > max) {
        return max + 1;
    }
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
            current.push(value);
            rowMin = Math.min(rowMin, value);
        }
        if (rowMin > max) {
            return max + 1;
        }
        previous = current;
    }
    return previous[b.length]!;
}

function scoreKey(query: string, queryPhonetic: string, key: string, phonetic: string): number {
    if (key === query) {
        return 100;
    }
    if (key.startsWith(query)) {
        return 80;
    }
    if (phonetic === queryPhonetic) {
        return 70;
    }
    if (query.length >= 3 && key.includes(query)) {
        return 60;
    }
    const allowed = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
    const distance = allowed ? editDistance(query, key, allowed) : allowed + 1;
    return distance <= allowed ? 40 - distance * 5 : 0;
}

const KIND_ORDER: Record<GeoUnit['kind'], number> = { district: 0, division: 1, thana: 2 };

export function search(query: string, options: GeoSearchOptions = {}): GeoSearchResult[] {
    const normalized = normalizeForSearch(query);
    if (!normalized) {
        return [];
    }
    const queryPhonetic = phoneticKey(normalized);
    const results: GeoSearchResult[] = [];
    for (const { unit, keys, phonetic } of getIndex()) {
        if (options.kinds && !options.kinds.includes(unit.kind)) {
            continue;
        }
        if (options.districtId && (unit.kind !== 'thana' || unit.districtId !== options.districtId)) {
            continue;
        }
        const score = Math.max(
            ...keys.map((key, i) => scoreKey(normalized, queryPhonetic, key, phonetic[i]!)),
        );
        if (score > 0) {
            results.push({ unit, score });
        }
    }
    return results
        .sort(
            (a, b) =>
                b.score - a.score ||
                KIND_ORDER[a.unit.kind] - KIND_ORDER[b.unit.kind] ||
                a.unit.en.localeCompare(b.unit.en),
        )
        .slice(0, options.limit ?? 10);
}
