import { describe, expect, it, vi } from 'vitest';
import { isMissingBuildFile, reloadForNewBuild } from './new-build';

function memory() {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
    };
}

describe('new build after a deploy', () => {
    it('recognises the missing-file error of Chrome, Firefox and Safari', () => {
        expect(
            isMissingBuildFile(
                new TypeError(
                    'Failed to fetch dynamically imported module: https://s.test/admin/assets/a-1.js',
                ),
            ),
        ).toBe(true);
        expect(isMissingBuildFile(new TypeError('error loading dynamically imported module: x.js'))).toBe(
            true,
        );
        expect(isMissingBuildFile(new TypeError('Importing a module script failed.'))).toBe(true);
        expect(isMissingBuildFile(new Error('Cannot read properties of undefined'))).toBe(false);
        expect(isMissingBuildFile(undefined)).toBe(false);
    });

    it('reloads once, then not again within a minute (no reload loop in an outage)', () => {
        const storage = memory();
        const reload = vi.fn();
        expect(reloadForNewBuild(storage, reload, 1_000_000)).toBe(true);
        expect(reloadForNewBuild(storage, reload, 1_030_000)).toBe(false);
        expect(reloadForNewBuild(storage, reload, 1_061_000)).toBe(true);
        expect(reload).toHaveBeenCalledTimes(2);
    });

    it('still reloads when storage is unavailable', () => {
        const reload = vi.fn();
        const broken = {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => undefined,
        };
        expect(reloadForNewBuild(broken, reload)).toBe(true);
        expect(reloadForNewBuild(undefined, reload)).toBe(true);
        expect(reload).toHaveBeenCalledTimes(2);
    });
});
