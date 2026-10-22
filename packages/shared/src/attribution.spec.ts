import { describe, expect, it } from 'vitest';
import {
    ATTRIBUTION_DAYS,
    ATTRIBUTION_LIMITS,
    isDirect,
    nextAttribution,
    readAttribution,
    visitAttribution,
} from './attribution';

const NOW = Date.UTC(2026, 9, 22, 6, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('attribution', () => {
    it('reads UTM values, click IDs, the referrer and the sales page from a visit', () => {
        const url = new URL(
            'https://shop.example.com/s/honey/?utm_source=facebook&utm_medium=paid&utm_campaign=eid%20offer&utm_content=reel-1&utm_term=honey&fbclid=IwAR1abc&gclid=Cj0&ttclid=E.C.P',
        );
        expect(
            visitAttribution(url, 'https://m.facebook.com/story.php?id=1', 'shop.example.com', '12', NOW),
        ).toEqual({
            source: 'facebook',
            medium: 'paid',
            campaign: 'eid offer',
            content: 'reel-1',
            term: 'honey',
            fbclid: 'IwAR1abc',
            gclid: 'Cj0',
            ttclid: 'E.C.P',
            referrer: 'm.facebook.com',
            salesPage: '12',
            at: NOW,
        });
    });

    it('treats typed addresses, bookmarks and links on the same site as direct', () => {
        const url = new URL('https://shop.example.com/s/honey/');
        expect(visitAttribution(url, '', 'shop.example.com', '12', NOW)).toBeNull();
        expect(visitAttribution(url, 'https://shop.example.com/', 'shop.example.com', '12', NOW)).toBeNull();
        expect(visitAttribution(url, 'not a url', 'shop.example.com', '', NOW)).toBeNull();
        // Another site linking here is a visit worth keeping.
        expect(visitAttribution(url, 'https://www.google.com/', 'shop.example.com', '', NOW)?.referrer).toBe(
            'www.google.com',
        );
        expect(isDirect(null)).toBe(true);
    });

    it('cuts long values to safe lengths and drops control characters and odd IDs', () => {
        const read = readAttribution({
            source: 'x'.repeat(500),
            fbclid: 'f'.repeat(900),
            campaign: 'eid\u0000<script>',
            salesPage: '12; drop',
            referrer: 'evil.example/<path>',
            at: 'yesterday',
            other: 'ignored',
        })!;
        expect(read.source).toHaveLength(ATTRIBUTION_LIMITS.text);
        expect(read.fbclid).toHaveLength(ATTRIBUTION_LIMITS.clickId);
        // Stored as plain text; the admin escapes it.
        expect(read.campaign).toBe('eid<script>');
        expect(read.salesPage).toBe('');
        expect(read.referrer).toBe('');
        expect(read.at).toBe(0);
        expect(read).not.toHaveProperty('other');
        expect(readAttribution({ source: '   ' })).toBeNull();
        expect(readAttribution('facebook')).toBeNull();
        expect(readAttribution([1])).toBeNull();
    });

    it('keeps the last visit that was not direct, for 30 days', () => {
        const ad = readAttribution({ source: 'facebook', campaign: 'eid', at: NOW - 3 * DAY })!;
        const google = readAttribution({ source: 'google', at: NOW })!;
        // Back directly days later: the ad still counts.
        expect(nextAttribution(ad, null, NOW)).toBe(ad);
        // A newer ad or link replaces it.
        expect(nextAttribution(ad, google, NOW)).toBe(google);
        // A sales page visited directly isn't a new touch.
        expect(nextAttribution(ad, readAttribution({ salesPage: '9', at: NOW }), NOW)).toBe(ad);
        // After 30 days it's gone.
        expect(nextAttribution(ad, null, ad.at + ATTRIBUTION_DAYS * DAY + 1)).toBeNull();
        expect(nextAttribution(null, null, NOW)).toBeNull();
    });
});
