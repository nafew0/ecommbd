import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `set:html` writes raw HTML into the page. It's allowed only on the sanitizer's output (in
 * RichText.astro) and the JSON-LD helper's (in Layout.astro). This stands in for a lint rule:
 * ESLint doesn't read .astro files here.
 */
const ALLOWED = [/set:html=\{html\}/, /set:html=\{jsonLd\(data\)\}/];

function astroFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return astroFiles(full);
        return entry.name.endsWith('.astro') ? [full] : [];
    });
}

describe('set:html', () => {
    it('is used only with sanitized HTML or JSON-LD', () => {
        const uses = astroFiles(path.join(__dirname, '../src')).flatMap(file =>
            [...fs.readFileSync(file, 'utf8').matchAll(/set:html=\{[^}]*\}\)?\}?/g)].map(match => ({
                file: path.basename(file),
                code: match[0],
            })),
        );
        expect(uses.map(use => use.file).sort()).toEqual(['Layout.astro', 'RichText.astro']);
        for (const use of uses) {
            expect(
                ALLOWED.some(pattern => pattern.test(use.code)),
                `${use.file}: ${use.code}`,
            ).toBe(true);
        }
        // And RichText sanitizes what it renders.
        expect(fs.readFileSync(path.join(__dirname, '../src/components/RichText.astro'), 'utf8')).toContain(
            'const html = richTextToHtml(',
        );
    });
});
