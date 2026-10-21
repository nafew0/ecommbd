import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImageVariant } from './pipeline';

/** `/<sha256>/<width>.webp`: the only paths `/img` serves. */
const VARIANT_PATH = /^\/[0-9a-f]{64}\/\d{1,4}\.webp$/;

/** Where an image's WebP sizes live on disk: `<dir>/<hash>/<size>.webp`. */
export class ImageFiles {
    constructor(readonly dir: string) {}

    private folder(hash: string): string {
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid image hash');
        return path.join(this.dir, hash);
    }

    /**
     * Writes the sizes, each to a temporary name then renamed, so a reader or a restart never sees
     * half a file. Sizes no longer made (after a regenerate) are removed.
     */
    async write(hash: string, variants: ImageVariant[]): Promise<void> {
        const folder = this.folder(hash);
        await fs.mkdir(folder, { recursive: true });
        for (const variant of variants) {
            const target = path.join(folder, `${variant.size}.webp`);
            const temporary = `${target}.${randomUUID()}.tmp`;
            await fs.writeFile(temporary, variant.data);
            await fs.rename(temporary, target);
        }
        const keep = new Set(variants.map(variant => `${variant.size}.webp`));
        for (const name of await fs.readdir(folder)) {
            if (!keep.has(name) && !name.endsWith('.tmp'))
                await fs.rm(path.join(folder, name), { force: true });
        }
    }

    async exist(hash: string, sizes: number[]): Promise<boolean> {
        const folder = this.folder(hash);
        try {
            await Promise.all(sizes.map(size => fs.access(path.join(folder, `${size}.webp`))));
            return sizes.length > 0;
        } catch {
            return false;
        }
    }

    async remove(hash: string): Promise<void> {
        await fs.rm(this.folder(hash), { recursive: true, force: true });
    }
}

/**
 * Serves the WebP sizes at `/img/<hash>/<width>.webp`: cached for a year as immutable (the hash
 * changes when the picture does), `nosniff`, no directory listing, and a 404 for any other path.
 */
export function createImageRouter(dir: string) {
    const router = express.Router();
    const serve = express.static(dir, {
        immutable: true,
        maxAge: '365d',
        index: false,
        redirect: false,
        dotfiles: 'deny',
        setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff'),
    });
    const notFound = (res: Response) => res.status(404).setHeader('X-Content-Type-Options', 'nosniff').end();
    router.use((req: Request, res: Response) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !VARIANT_PATH.test(req.path)) {
            notFound(res);
            return;
        }
        serve(req, res, () => notFound(res));
    });
    return router;
}
