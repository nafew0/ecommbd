import type { SalesPageSettings } from '@ecommbd/sections';
import type { ApiSession } from './store-api';

/**
 * Sales pages for browser tests (phase 16), through the Admin API: two products of their own
 * (kept in the dev database, like the other fixtures), and pages made, changed, published and
 * deleted.
 */

export interface SalesProducts {
    honey: { productId: string; variantId: string; price: number };
    spoon: { productId: string; variantId: string; price: number };
}

async function ensureProduct(admin: ApiSession, slug: string, name: string, bn: string, price: number) {
    const { products } = await admin.query(
        'query ($slug: String!) { products(options: { filter: { slug: { eq: $slug } } }) { items { id variants { id } } } }',
        { slug },
    );
    const found = products.items[0];
    if (found?.variants[0])
        return { productId: found.id as string, variantId: found.variants[0].id as string, price };
    const { createProduct } = await admin.query(
        `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
        {
            input: {
                translations: [
                    { languageCode: 'en', name, slug, description: '' },
                    { languageCode: 'bn', name: bn, slug, description: '' },
                ],
            },
        },
    );
    const { createProductVariants } = await admin.query(
        `mutation ($input: [CreateProductVariantInput!]!) { createProductVariants(input: $input) { id } }`,
        {
            input: [
                {
                    productId: createProduct.id,
                    sku: slug.toUpperCase(),
                    price,
                    stockOnHand: 1000,
                    trackInventory: 'TRUE',
                    translations: [
                        { languageCode: 'en', name },
                        { languageCode: 'bn', name: bn },
                    ],
                },
            ],
        },
    );
    return { productId: createProduct.id as string, variantId: createProductVariants[0].id as string, price };
}

export async function ensureSalesProducts(admin: ApiSession): Promise<SalesProducts> {
    return {
        honey: await ensureProduct(admin, 'sales-test-honey', 'Sales test honey', 'সেলস টেস্ট মধু', 55_000),
        spoon: await ensureProduct(admin, 'sales-test-spoon', 'Sales test spoon', 'সেলস টেস্ট চামচ', 20_000),
    };
}

export interface TestSalesPage {
    id: string;
    slug: string;
    layoutId: string;
    settings: SalesPageSettings;
}

const PAGE = 'id slug layoutId settings';

export async function createSalesPage(
    admin: ApiSession,
    input: { title: string; template: string; productId: string; slug?: string },
): Promise<TestSalesPage> {
    const { createBdSalesPage } = await admin.query(
        `mutation ($input: BdSalesPageInput!) { createBdSalesPage(input: $input) { page { ${PAGE} } errors { field code } } }`,
        { input },
    );
    if (!createBdSalesPage.page) throw new Error(`Not created: ${JSON.stringify(createBdSalesPage.errors)}`);
    return createBdSalesPage.page;
}

export async function updateSalesSettings(
    admin: ApiSession,
    page: TestSalesPage,
    change: (settings: SalesPageSettings) => SalesPageSettings,
) {
    const { updateBdSalesPage } = await admin.query(
        `mutation ($id: ID!, $input: BdSalesPageInput!) { updateBdSalesPage(id: $id, input: $input) { page { ${PAGE} } errors { field code } } }`,
        { id: page.id, input: { settings: change(structuredClone(page.settings)) } },
    );
    if (!updateBdSalesPage.page) throw new Error(`Not saved: ${JSON.stringify(updateBdSalesPage.errors)}`);
    return updateBdSalesPage.page as TestSalesPage;
}

/** Publishes the page's sections as they are in its draft (or `document`, when given). */
export async function publishSalesPage(admin: ApiSession, page: TestSalesPage, document?: unknown) {
    const { bdPageLayout } = await admin.query(
        'query ($id: ID) { bdPageLayout(type: "landing", pageId: $id) { id draft draftRevision publishedVersion } }',
        { id: page.id },
    );
    if (document) {
        await admin.query(
            `mutation ($id: ID!, $document: JSON!, $base: Int!) {
                saveBdLayoutDraft(layoutId: $id, document: $document, baseRevision: $base, force: true) { errors { code } }
            }`,
            { id: bdPageLayout.id, document, base: bdPageLayout.draftRevision },
        );
    }
    const { publishBdLayout } = await admin.query(
        `mutation ($id: ID!, $base: Int!) { publishBdLayout(layoutId: $id, baseVersion: $base, force: true) {
            layout { publishedVersion } errors { code sectionId }
        } }`,
        { id: bdPageLayout.id, base: bdPageLayout.publishedVersion },
    );
    if (!publishBdLayout.layout) throw new Error(`Not published: ${JSON.stringify(publishBdLayout.errors)}`);
    return bdPageLayout.draft as { sections: unknown[] };
}

export async function deleteSalesPage(admin: ApiSession, id: string) {
    await admin.query('mutation ($id: ID!) { deleteBdSalesPage(id: $id) }', { id });
}

/** Sets how many more of a variant can be sold (whatever earlier orders hold). */
export async function setSaleableStock(admin: ApiSession, variantId: string, saleable: number) {
    const { productVariant } = await admin.query(
        'query ($id: ID!) { productVariant(id: $id) { stockAllocated } }',
        { id: variantId },
    );
    await admin.query(
        'mutation ($input: [UpdateProductVariantInput!]!) { updateProductVariants(input: $input) { id } }',
        { input: [{ id: variantId, stockOnHand: productVariant.stockAllocated + saleable }] },
    );
}

/** A placed order by its code, with where it came from. */
export async function orderByCode(admin: ApiSession, code: string) {
    const { orders } = await admin.query(
        `query ($code: String!) { orders(options: { filter: { code: { eq: $code } } }) { items {
            id totalWithTax subTotalWithTax shippingWithTax
            lines { quantity productVariant { id } }
            bdAttribution { salesPage { id } source medium campaign fbclid gclid referrer }
        } } }`,
        { code },
    );
    return orders.items[0];
}
