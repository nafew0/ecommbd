import { describe, expect, it } from 'vitest';
import { bn } from './bn';
import { en } from './en';

type Tree = { [key: string]: string | ((...args: never[]) => string) | Tree };

function leaves(tree: Tree, prefix = ''): Array<[string, unknown]> {
    return Object.entries(tree).flatMap(([key, value]) =>
        typeof value === 'object' ? leaves(value as Tree, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
    );
}

describe('messages', () => {
    it('has the same keys in Bangla and English, none empty', () => {
        const english = leaves(en as unknown as Tree);
        const bangla = new Map(leaves(bn as unknown as Tree));
        expect([...bangla.keys()].sort()).toEqual(english.map(([key]) => key).sort());
        for (const [key, value] of bangla) {
            if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
        }
    });

    it('formats numbers in Bangla digits in the Bangla admin', () => {
        expect(bn.list.selected(12)).toBe('১২টি বাছাই করা');
        expect(bn.common.number(2026)).toBe('২০২৬');
        expect(en.list.showing(1, 10, 64)).toBe('1–10 of 64');
        expect(bn.list.showing(1, 10, 64)).toBe('৬৪টির মধ্যে ১–১০');
    });

    it('is Bangla where it should be', () => {
        expect(bn.settings.title).toBe('স্টোর সেটিংস');
        expect(bn.nav.orders).toBe('অর্ডার');
    });
});
