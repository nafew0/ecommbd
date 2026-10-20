import { type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { PluginCommonModule, type Type, VendurePlugin } from '@vendure/core';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';

export interface MerchantAdminPluginOptions {
    /** Built admin files (`apps/admin/dist`). */
    appDir: string;
    /** URL path, without slashes. Default `admin`. */
    route?: string;
    /** Extra origins images may load from, e.g. the asset server when it's on another domain. */
    imageOrigins?: string[];
}

/**
 * Serves our merchant admin (`apps/admin`, roadmap phase 02b) as static files at `/admin`, on the
 * same origin as the Admin API, so the HTTP-only session cookie works without CORS.
 *
 * Security: a strict Content Security Policy (scripts, styles, fonts and API calls only from this
 * origin), no framing, no MIME sniffing. Hashed build files are cached for a year; `index.html`
 * is always revalidated so a release shows up on the next load.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    compatibility: '^3.8.0',
})
export class MerchantAdminPlugin implements NestModule {
    static options: MerchantAdminPluginOptions;

    static init(options: MerchantAdminPluginOptions): Type<MerchantAdminPlugin> {
        this.options = options;
        return MerchantAdminPlugin;
    }

    configure(consumer: MiddlewareConsumer) {
        const { route = 'admin' } = MerchantAdminPlugin.options;
        consumer.apply(createAdminRouter(MerchantAdminPlugin.options)).forRoutes(route);
    }
}

export function contentSecurityPolicy(imageOrigins: string[] = []): string {
    return [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        `img-src 'self' data: blob: ${imageOrigins.join(' ')}`.trim(),
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ');
}

export function createAdminRouter(options: MerchantAdminPluginOptions) {
    const { appDir, route = 'admin' } = options;
    const indexFile = path.join(appDir, 'index.html');
    const csp = contentSecurityPolicy(options.imageOrigins);
    const router = express.Router();

    router.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Content-Security-Policy', csp);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        // `/admin` → `/admin/`, so relative asset URLs resolve.
        if (req.originalUrl === `/${route}`) {
            return res.redirect(301, `/${route}/`);
        }
        next();
    });
    router.use(
        '/assets',
        express.static(path.join(appDir, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }),
    );
    router.use(express.static(appDir, { index: false, maxAge: '1h' }));
    router.get(/.*/, (_req: Request, res: Response) => {
        if (!fs.existsSync(indexFile)) {
            res.status(503)
                .type('text/plain')
                .send('The merchant admin is not built yet. Run: npm run build -w @ecommbd/admin');
            return;
        }
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile);
    });
    return router;
}
