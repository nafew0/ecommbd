/**
 * Code 128 barcodes for order numbers (MF-1001) and courier consignment IDs, drawn as SVG by the
 * print views (roadmap phase 06). Code set B covers printable ASCII; runs of 4 or more digits switch
 * to code set C (two digits per symbol), so long numbers stay short enough for small stickers.
 */

/** Bar and space widths (in modules) of the 107 Code 128 symbols; each adds up to 11, the stop to 13. */
// prettier-ignore
const PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Code set C pays off for runs of at least this many digits. */
const MIN_DIGIT_RUN = 4;

/** The symbol values (start, data, checksum, stop) for `text`. */
export function code128Values(text: string): number[] {
    if (text === '') {
        throw new RangeError('A barcode needs some text');
    }
    if (!/^[\x20-\x7E]+$/.test(text)) {
        throw new RangeError(
            'Code 128 barcodes here take printable ASCII only (letters, digits, - and so on)',
        );
    }
    const values: number[] = [];
    let set: 'B' | 'C' | undefined;
    let index = 0;
    while (index < text.length) {
        const run = /^\d*/.exec(text.slice(index))![0].length;
        // A run of digits: code set C for an even number of them (an odd first digit goes in B).
        if (run >= MIN_DIGIT_RUN) {
            const odd = run % 2;
            if (odd) {
                values.push(...switchTo('B'), text.charCodeAt(index) - 32);
                index++;
            }
            values.push(...switchTo('C'));
            for (const end = index + run - odd; index < end; index += 2) {
                values.push(Number(text.slice(index, index + 2)));
            }
            continue;
        }
        values.push(...switchTo('B'), text.charCodeAt(index) - 32);
        index++;
    }
    const checksum = values.reduce((sum, value, position) => sum + value * Math.max(position, 1), 0) % 103;
    return [...values, checksum, STOP];

    function switchTo(next: 'B' | 'C'): number[] {
        if (set === next) return [];
        const start = set === undefined;
        set = next;
        if (start) return [next === 'B' ? START_B : START_C];
        return [next === 'B' ? CODE_B : CODE_C];
    }
}

/** Alternating bar and space widths in modules, starting with a bar (no quiet zones). */
export function code128Widths(text: string): number[] {
    return code128Values(text).flatMap(value => [...PATTERNS[value]!].map(Number));
}

export interface Code128Bars {
    /** Each bar's left edge and width, in modules, quiet zones included. */
    bars: Array<{ x: number; width: number }>;
    /** The full width in modules, quiet zones included. */
    modules: number;
}

/** The bars to draw, with a quiet zone of `quietZone` modules (default 10) on each side. */
export function code128Bars(text: string, quietZone = 10): Code128Bars {
    const bars: Array<{ x: number; width: number }> = [];
    let x = quietZone;
    code128Widths(text).forEach((width, index) => {
        if (index % 2 === 0) bars.push({ x, width });
        x += width;
    });
    return { bars, modules: x + quietZone };
}

/** The pattern table, for tests. */
export const CODE128_PATTERNS: readonly string[] = PATTERNS;
