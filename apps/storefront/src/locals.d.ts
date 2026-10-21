/// <reference types="astro/client" />

declare namespace App {
    interface Locals {
        /** The page's language (from the `/en/` or `/bn/` prefix, or the store's default). */
        lang: import('./lib/i18n').Lang;
        defaultLang: import('./lib/i18n').Lang;
        settings: import('./lib/store').StoreSettings;
        /** The path exactly as requested (with the language prefix), to compare with the canonical one. */
        requestPath: string;
    }
}
