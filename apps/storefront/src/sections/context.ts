import { type Bilingual, type ImageValue, type LinkValue, pick, type SalesPageSettings } from '@ecommbd/sections';
import type { CheckoutSettings, District } from '../lib/checkout';
import type { AssetData } from '../lib/images';
import type { Formatter, Lang, Strings } from '../lib/i18n';
import type { SalesPageData } from '../lib/sales';
import { linkHref, type SectionPageData } from '../lib/sections';
import type { StoreSettings } from '../lib/store';

/** What every section component gets besides its own data (Sections.astro builds it). */
export interface SectionContext {
    lang: Lang;
    defaultLang: Lang;
    s: Strings;
    format: Formatter;
    settings: StoreSettings;
    /** A path in this page's language. */
    href(path: string): string;
    /** An absolute URL on the store (for WhatsApp messages). */
    absolute(path: string): string;
    assets: Map<string, AssetData>;
    data: SectionPageData;
    /** The page's first section: its image loads first (LCP). */
    first: boolean;
    /** h1 for the first section of the home page, else h2. */
    heading: 'h1' | 'h2';
    /** In the page editor's frame: empty sections show what to fill in instead of nothing. */
    editor: boolean;
    /** On a sales page (phase 16): its product, packs, add-on and settings, and what its order form needs. */
    sales?: SalesContext;
}

export interface SalesContext {
    page: SalesPageData;
    settings: SalesPageSettings;
    checkout: CheckoutSettings;
    districts: District[];
}

/** Text in the page's language (the other language's when empty). */
export const tr = (text: Bilingual, context: SectionContext) => pick(text, context.lang);

/** An image field's asset; undefined when there's none or it was deleted (a placeholder shows). */
export const assetOf = (image: ImageValue | null, context: SectionContext) =>
    image ? context.assets.get(image.assetId) : undefined;

/** A link field's address in this page's language; null when it goes nowhere. */
export const hrefOf = (link: LinkValue, context: SectionContext) => linkHref(link, context);

/** Off-site links open in the same tab but don't pass on who sent them. */
export const relOf = (href: string | null) => (href && /^https?:/.test(href) ? 'noopener' : undefined);
