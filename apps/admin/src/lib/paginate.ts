/**
 * Splits an invoice's item lines into printed pages, from the measured height of each line
 * (roadmap phase 06). Page 1 has the full header; later pages a short one. The totals block must
 * fit under the last line, or it gets a page of its own.
 */
export interface PageSpace {
    /** Height available for lines on page 1. */
    first: number;
    /** Height available for lines on each later page. */
    next: number;
    /** Height the totals need under the last line. */
    totals: number;
}

/** Line indexes per page. A last page may be empty: it holds only the totals. */
export function paginateRows(rowHeights: readonly number[], space: PageSpace): number[][] {
    const pages: number[][] = [[]];
    let used = 0;
    let capacity = space.first;
    rowHeights.forEach((height, index) => {
        const page = pages[pages.length - 1]!;
        // A line taller than a whole page still goes somewhere: alone on its page.
        if (page.length > 0 && used + height > capacity) {
            pages.push([index]);
            used = height;
            capacity = space.next;
            return;
        }
        page.push(index);
        used += height;
    });
    if (used + space.totals > capacity) {
        pages.push([]);
    }
    return pages;
}

/** CSS pixels per millimetre (96 dpi). */
export const PX_PER_MM = 96 / 25.4;
