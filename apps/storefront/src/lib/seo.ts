import { richTextToPlain } from '@ecommbd/shared/rich-text';

/** SEO output (roadmap phase 12): JSON-LD for schema.org, and meta description fallbacks. */

/**
 * JSON for a `<script type="application/ld+json">`: `<`, `>`, `&` and the line separators are
 * escaped, so text like `</script>` in a product name can never end the script element.
 */
export function jsonLd(data: unknown): string {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** The meta description: the merchant's SEO text, else the start of the description. */
export function metaDescription(seo: string | null | undefined, fallback: string, maxLength = 160): string {
    return (seo ?? '').trim() || richTextToPlain(fallback, maxLength);
}

export interface Crumb {
    name: string;
    url: string;
}

export function breadcrumbList(crumbs: Crumb[]) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.name,
            item: crumb.url,
        })),
    };
}

export function organization(input: {
    name: string;
    url: string;
    logo?: string;
    phones: string[];
    email: string;
    sameAs: string[];
}) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: input.name,
        url: input.url,
        ...(input.logo ? { logo: input.logo } : {}),
        ...(input.phones[0] || input.email
            ? {
                  contactPoint: {
                      '@type': 'ContactPoint',
                      contactType: 'customer service',
                      ...(input.phones[0] ? { telephone: input.phones[0] } : {}),
                      ...(input.email ? { email: input.email } : {}),
                      areaServed: 'BD',
                  },
              }
            : {}),
        ...(input.sameAs.length ? { sameAs: input.sameAs } : {}),
    };
}

/** WebSite with a SearchAction, so search engines can show a search box for the store. */
export function website(input: { name: string; url: string; searchUrl: string; language: string }) {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: input.name,
        url: input.url,
        inLanguage: input.language,
        potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${input.searchUrl}?q={search_term_string}` },
            'query-input': 'required name=search_term_string',
        },
    };
}

export interface ProductLdInput {
    name: string;
    url: string;
    description: string;
    /** Absolute image URLs; none gives no `image` at all (not an empty value). */
    images: string[];
    variants: Array<{ sku: string; priceWithTax: number; stockLevel: string }>;
    brand: string;
}

const availability = (stockLevel: string) =>
    stockLevel === 'OUT_OF_STOCK' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';

/** Product with one Offer per variant: price in taka (BDT), availability and condition. */
export function product(input: ProductLdInput) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: input.name,
        url: input.url,
        ...(input.description ? { description: richTextToPlain(input.description, 5000) } : {}),
        ...(input.images.length ? { image: input.images } : {}),
        ...(input.variants[0]?.sku ? { sku: input.variants[0].sku } : {}),
        brand: { '@type': 'Brand', name: input.brand },
        offers: input.variants.map(variant => ({
            '@type': 'Offer',
            url: input.url,
            ...(variant.sku ? { sku: variant.sku } : {}),
            priceCurrency: 'BDT',
            price: (variant.priceWithTax / 100).toFixed(2),
            availability: availability(variant.stockLevel),
            itemCondition: 'https://schema.org/NewCondition',
        })),
    };
}
