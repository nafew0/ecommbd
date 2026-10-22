/// <reference types="astro/client" />

declare namespace App {
    interface Locals {
        /** The page's language (from the `/en/` or `/bn/` prefix, or the store's default). */
        lang: import('./lib/i18n').Lang;
        defaultLang: import('./lib/i18n').Lang;
        settings: import('./lib/store').StoreSettings;
        /** The path exactly as requested (with the language prefix), to compare with the canonical one. */
        requestPath: string;
        /** The store's theme (phase 15), read by the middleware for every page. */
        theme: import('@ecommbd/sections').ThemeSettings;
        /** Set when the page shows a draft for a valid preview token (phase 15). */
        preview?: import('./lib/sections').Preview;
        /** The URL had a preview token that is wrong or expired: the live page shows, with a notice. */
        previewExpired?: boolean;
        /** SHA-256 hashes of the page's generated <style> (phase 16's Design options), for the CSP. */
        styleHashes?: string[];
    }
}
