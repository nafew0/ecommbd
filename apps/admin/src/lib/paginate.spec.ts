import { describe, expect, it } from 'vitest';
import { paginateRows } from './paginate';

const space = { first: 100, next: 150, totals: 30 };

describe('paginateRows', () => {
    it('keeps a short invoice on one page', () => {
        expect(paginateRows([20, 20, 20], space)).toEqual([[0, 1, 2]]);
        expect(paginateRows([], space)).toEqual([[]]);
    });

    it('moves lines that don’t fit to the next page, which has more room', () => {
        const rows = Array.from({ length: 10 }, () => 20);
        expect(paginateRows(rows, space)).toEqual([
            [0, 1, 2, 3, 4],
            [5, 6, 7, 8, 9],
        ]);
    });

    it('gives the totals a page of their own when they don’t fit under the last line', () => {
        expect(paginateRows([40, 40], space)).toEqual([[0, 1], []]);
        // 50 lines: page "2 of 3" style output.
        const pages = paginateRows(
            Array.from({ length: 50 }, () => 10),
            space,
        );
        expect(pages).toHaveLength(4);
        expect(pages.flat()).toEqual(Array.from({ length: 50 }, (_, index) => index));
    });

    it('puts a line taller than a page alone on a page instead of losing it', () => {
        expect(paginateRows([500, 10], space)).toEqual([[0], [1]]);
    });
});
