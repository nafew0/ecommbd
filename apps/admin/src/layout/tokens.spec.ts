import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
/** Badge maps its tone names to colours (two have no token); print templates are black on paper. */
const ALLOWED = ['components/ui/misc.tsx', 'components/print/'];
const RAW =
    /(?<![\w-])(?:bg|text|border|outline|ring|accent|divide|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+/g;

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return files(full);
        return /\.tsx?$/.test(name) && !name.includes('.spec.') ? [full] : [];
    });
}

describe('design tokens', () => {
    it('no screen uses a raw Tailwind palette colour (docs/design/admin-design-guide.md, section 2)', () => {
        const found = files(SRC).flatMap(file => {
            const relative = path.relative(SRC, file).split(path.sep).join('/');
            if (ALLOWED.some(prefix => relative.startsWith(prefix))) return [];
            return (readFileSync(file, 'utf8').match(RAW) ?? []).map(match => `${relative}: ${match}`);
        });
        expect(found).toEqual([]);
    });
});
