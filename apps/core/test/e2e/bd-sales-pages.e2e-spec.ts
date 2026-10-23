import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADD_ITEM, chooseDelivery, payAndPlace, SET_ADDRESS, SET_CUSTOMER } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3070;
const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(PORT));

const PAGE_FIELDS = `
    id
    title
    slug
    template
    active
    productId
    settings
    layoutId
    status
    orderCount
    url
`;
const RESULT = `page { ${PAGE_FIELDS} } errors { field code suggestion }`;

const CREATE = gql`
    mutation ($input: BdSalesPageInput!) {
        createBdSalesPage(input: $input) { ${RESULT} }
    }
`;
const UPDATE = gql`
    mutation ($id: ID!, $input: BdSalesPageInput!) {
        updateBdSalesPage(id: $id, input: $input) { ${RESULT} }
    }
`;
const DUPLICATE = gql`
    mutation ($id: ID!) {
        duplicateBdSalesPage(id: $id) { ${RESULT} }
    }
`;
const DELETE = gql`
    mutation ($id: ID!) {
        deleteBdSalesPage(id: $id)
    }
`;
const LIST = gql`
    query ($search: String) {
        bdSalesPages(search: $search) {
            totalItems
            items { ${PAGE_FIELDS} }
        }
    }
`;
const LAYOUT = gql`
    query ($pageId: ID) {
        bdPageLayout(type: "landing", pageId: $pageId) {
            id
            type
            title
            draft
            publishedVersion
        }
    }
`;
const PUBLISH = gql`
    mutation ($layoutId: ID!) {
        publishBdLayout(layoutId: $layoutId, baseVersion: 0) {
            layout {
                publishedVersion
            }
            errors {
                code
            }
        }
    }
`;
const PREVIEW_LINK = gql`
    mutation ($layoutId: ID!) {
        createBdPreviewLink(layoutId: $layoutId, language: "bn") {
            url
            token
        }
    }
`;
const SHOP_PAGE = gql`
    query ($slug: String!, $preview: String) {
        bdSalesPage(slug: $slug, preview: $preview) {
            id
            slug
            title
            settings
            available
            maxQuantity
            preview
            product {
                id
                name
                variants {
                    id
                }
            }
            packs {
                quantity
                price
                normalPrice
                popular
                available
            }
            bump {
                variant {
                    id
                }
                price
                normalPrice
                title
            }
            layout {
                type
                version
                document
            }
        }
    }
`;
const SET_ORDER = gql`
    mutation ($input: BdSalesOrderInput!) {
        setBdSalesPageOrder(input: $input) {
            errorCode
            quantityAvailable
            order {
                id
                code
                subTotalWithTax
                totalWithTax
                discounts {
                    description
                    amountWithTax
                }
                lines {
                    id
                    quantity
                    productVariant {
                        id
                    }
                }
            }
        }
    }
`;
const ACTIVE_ORDER = gql`
    query {
        activeOrder {
            id
            subTotalWithTax
            totalWithTax
            discounts {
                description
                amountWithTax
            }
        }
    }
`;
const REMOVE_LINE = gql`
    mutation ($lineId: ID!) {
        removeOrderLine(orderLineId: $lineId) {
            ... on Order {
                id
            }
        }
    }
`;
const ATTRIBUTION = gql`
    mutation ($input: BdAttributionInput!) {
        setBdOrderAttribution(input: $input)
    }
`;
const ORDER_ATTRIBUTION = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            subTotalWithTax
            totalWithTax
            discounts {
                amountWithTax
            }
            bdAttribution {
                salesPage {
                    id
                    title
                }
                source
                medium
                campaign
                fbclid
                referrer
                at
            }
        }
    }
`;
const ORDERS = gql`
    query ($campaign: String, $salesPageId: ID) {
        bdOrders(campaign: $campaign, salesPageId: $salesPageId) {
            totalItems
        }
    }
`;
const BY_CAMPAIGN = gql`
    query {
        bdOrdersByCampaign {
            source
            medium
            campaign
            salesPage {
                id
                title
            }
            orders
            value
        }
    }
`;
const PROMOTIONS = gql`
    query {
        promotions {
            items {
                name
                enabled
                conditions {
                    code
                }
                actions {
                    code
                }
            }
        }
    }
`;
const SET_STOCK = gql`
    mutation ($id: ID!, $stock: Int!) {
        updateProductVariants(input: [{ id: $id, stockOnHand: $stock }]) {
            id
            stockOnHand
        }
    }
`;
const DELETE_PRODUCT = gql`
    mutation ($id: ID!) {
        deleteProduct(id: $id) {
            result
        }
    }
`;

describe('sales pages', () => {
    let pageId: string;
    let layoutId: string;
    let orderId: string;

    beforeAll(async () => {
        await server.init({
            initialData: testInitialData,
            productsCsvPath: testProductsCsvPath,
            customerCount: 0,
        });
        await addMigrationOnlyObjects(server);
        await adminClient.asSuperAdmin();
    }, 120_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('sets up the automatic "Sales page offer" promotion', async () => {
        const { promotions } = await adminClient.query(PROMOTIONS);
        const offer = promotions.items.find(
            (item: { conditions: Array<{ code: string }> }) =>
                item.conditions[0]?.code === 'bd_sales_page_offer',
        );
        // Named in the store's language.
        expect(offer).toMatchObject({
            name: 'সেলস পেজের অফার',
            enabled: true,
            conditions: [{ code: 'bd_sales_page_offer' }],
            actions: [{ code: 'bd_sales_page_offer_discount' }],
        });
    });

    it('makes a page from a template and a product, with suggested packs', async () => {
        const { createBdSalesPage } = await adminClient.query(CREATE, {
            input: { title: 'Panjabi Eid offer', template: 'fashion-single', productId: 'T_1' },
        });
        expect(createBdSalesPage.errors).toEqual([]);
        const page = createBdSalesPage.page;
        pageId = page.id;
        layoutId = page.layoutId;
        expect(page).toMatchObject({
            slug: 'panjabi-eid-offer',
            template: 'fashion-single',
            active: true,
            productId: 'T_1',
            status: 'notPublished',
            orderCount: 0,
            url: 'https://shop.example.com/s/panjabi-eid-offer/',
        });
        // ৳1,250: one at the normal price, two at 5% off and three at 10% off, in whole tens of taka.
        expect(
            page.settings.packs.map((pack: { quantity: number; price: number }) => [
                pack.quantity,
                pack.price,
            ]),
        ).toEqual([
            [1, 125_000],
            [2, 237_000],
            [3, 337_000],
        ]);
        expect(page.settings.hideFromGoogle).toBe(true);

        const { bdPageLayout } = await adminClient.query(LAYOUT, { pageId });
        expect(bdPageLayout).toMatchObject({
            id: layoutId,
            type: 'landing',
            title: 'Panjabi Eid offer',
            publishedVersion: 0,
        });
        const hero = bdPageLayout.draft.sections[0];
        expect(hero.type).toBe('sales-hero');
        // The product has only an English name: both languages show it.
        expect(hero.settings.headline).toEqual({ bn: 'Cotton Panjabi', en: 'Cotton Panjabi' });
        expect(
            bdPageLayout.draft.sections.filter((section: { type: string }) => section.type === 'order-form'),
        ).toHaveLength(1);
    });

    it('refuses a taken address with a free one, and needs a template and product', async () => {
        const { createBdSalesPage } = await adminClient.query(CREATE, {
            input: { title: 'Another', slug: 'Panjabi Eid Offer', template: 'general', productId: 'T_1' },
        });
        expect(createBdSalesPage.page).toBeNull();
        expect(createBdSalesPage.errors).toEqual([
            { field: 'slug', code: 'taken', suggestion: 'panjabi-eid-offer-2' },
        ]);
        const missing = await adminClient.query(CREATE, { input: { title: '', template: 'nope' } });
        // No title, so no address either.
        expect(
            missing.createBdSalesPage.errors.map((error: { field: string }) => error.field).sort(),
        ).toEqual(['productId', 'slug', 'template', 'title']);
    });

    it('finds a taken address at the full 80 characters (a long Bangla title) and suggests a free one', async () => {
        const title =
            'খাঁটি সুন্দরবনের চাকের মধু আর কালোজিরা তেলের ঈদ অফার: দুই বোতল নিলে সারা বাংলাদেশে ডেলিভারি ফ্রি';
        const input = { title, template: 'ghee-honey', productId: 'T_1' };
        const first = (await adminClient.query(CREATE, { input })).createBdSalesPage;
        expect(first.errors).toEqual([]);
        const slug: string = first.page.slug;
        expect(slug).toHaveLength(80);
        // The numbered address is cut to leave room for its number, and still fits.
        const free = `${slug.slice(0, 76).replace(/-+$/, '')}-2`;
        // The same title again: refused with a free address (it was saved again and crashed).
        const again = (await adminClient.query(CREATE, { input })).createBdSalesPage;
        expect(again).toEqual({ page: null, errors: [{ field: 'slug', code: 'taken', suggestion: free }] });
        const second = (await adminClient.query(CREATE, { input: { ...input, slug: free } }))
            .createBdSalesPage;
        expect(second.errors).toEqual([]);
        expect(second.page.slug).toBe(free);
        // Renaming a page to the long address is refused the same way.
        const renamed = await adminClient.query(UPDATE, { id: second.page.id, input: { slug } });
        expect(renamed.updateBdSalesPage.errors).toEqual([
            { field: 'slug', code: 'taken', suggestion: free },
        ]);
        // Tidy up: the tests below read the newest page in the list.
        await adminClient.query(DELETE, { id: first.page.id });
        await adminClient.query(DELETE, { id: second.page.id });
    });

    it('stays off the storefront until published, but shows its draft with a preview link', async () => {
        expect((await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' })).bdSalesPage).toBeNull();
        const { createBdPreviewLink } = await adminClient.query(PREVIEW_LINK, { layoutId });
        expect(createBdPreviewLink.url).toContain('/s/panjabi-eid-offer/?preview=');
        const { bdSalesPage } = await shopClient.query(SHOP_PAGE, {
            slug: 'panjabi-eid-offer',
            preview: createBdPreviewLink.token,
        });
        expect(bdSalesPage).toMatchObject({ preview: true, layout: { type: 'landing' } });
        // Another page's token doesn't open it.
        expect(
            (await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer', preview: 'bad.token' }))
                .bdSalesPage,
        ).toBeNull();
    });

    it('checks the page settings: packs, the add-on and the thank-you redirect', async () => {
        const settings = (await adminClient.query(LIST)).bdSalesPages.items[0].settings;
        const bad = await adminClient.query(UPDATE, {
            id: pageId,
            input: {
                settings: {
                    ...settings,
                    packs: [...settings.packs, { quantity: 2, price: 200_000 }],
                    bump: { enabled: true, variantId: 'T_1', price: 10_000 },
                    thankYou: { ...settings.thankYou, redirect: 'https://evil.example/' },
                },
            },
        });
        expect(bad.updateBdSalesPage.errors).toEqual([
            { field: 'settings.packs.3.quantity', code: 'duplicatePack', suggestion: null },
            { field: 'settings.thankYou.redirect', code: 'invalidRedirect', suggestion: null },
            { field: 'settings.bump', code: 'bumpSameProduct', suggestion: null },
        ]);
        const { updateBdSalesPage } = await adminClient.query(UPDATE, {
            id: pageId,
            input: {
                settings: {
                    ...settings,
                    bump: {
                        enabled: true,
                        variantId: 'T_2',
                        price: 300_000,
                        title: { bn: 'সাথে একটি শাড়ি নিন', en: 'Add a saree' },
                        text: { bn: '', en: '' },
                    },
                    thankYou: { ...settings.thankYou, redirect: '/product/silk-saree/' },
                },
            },
        });
        expect(updateBdSalesPage.errors).toEqual([]);
        expect(updateBdSalesPage.page.settings.bump).toMatchObject({
            enabled: true,
            variantId: 'T_2',
            price: 300_000,
        });
    });

    it('shows the published page with its packs and add-on', async () => {
        const { publishBdLayout } = await adminClient.query(PUBLISH, { layoutId });
        expect(publishBdLayout.errors).toEqual([]);
        const { bdSalesPage } = await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' });
        expect(bdSalesPage).toMatchObject({
            id: pageId,
            title: 'Panjabi Eid offer',
            available: true,
            maxQuantity: 20,
            preview: false,
            product: { id: 'T_1', name: 'Cotton Panjabi' },
            bump: {
                variant: { id: 'T_2' },
                price: 300_000,
                normalPrice: 450_000,
                title: 'সাথে একটি শাড়ি নিন',
            },
            layout: { type: 'landing', version: 1 },
        });
        expect(bdSalesPage.packs).toEqual([
            { quantity: 1, price: 125_000, normalPrice: 125_000, popular: false, available: true },
            { quantity: 2, price: 237_000, normalPrice: 250_000, popular: true, available: true },
            { quantity: 3, price: 337_000, normalPrice: 375_000, popular: false, available: true },
        ]);
        const { bdSalesPages } = await adminClient.query(LIST, { search: 'eid' });
        expect(bdSalesPages.items[0].status).toBe('live');
    });

    it('prices a pack and the add-on exactly, whatever the browser sends', async () => {
        await shopClient.asAnonymousUser();
        const refused = await shopClient.query(SET_ORDER, {
            input: { slug: 'panjabi-eid-offer', variantId: 'T_1', quantity: 4 },
        });
        expect(refused.setBdSalesPageOrder).toMatchObject({ errorCode: 'INVALID_PACK', order: null });
        const wrong = await shopClient.query(SET_ORDER, {
            input: { slug: 'panjabi-eid-offer', variantId: 'T_2', quantity: 1 },
        });
        expect(wrong.setBdSalesPageOrder.errorCode).toBe('INVALID_VARIANT');

        const { setBdSalesPageOrder } = await shopClient.query(SET_ORDER, {
            input: { slug: 'panjabi-eid-offer', variantId: 'T_1', quantity: 3, bump: true },
        });
        expect(setBdSalesPageOrder.errorCode).toBeNull();
        // ৳1,400 for the pack of three and ৳3,000 for the saree.
        expect(setBdSalesPageOrder.order.subTotalWithTax).toBe(337_000 + 300_000);
        expect(setBdSalesPageOrder.order.discounts).toEqual([
            { description: 'সেলস পেজের অফার', amountWithTax: -(375_000 - 337_000) - (450_000 - 300_000) },
        ]);

        // Choosing again replaces the items: two, without the add-on.
        const again = await shopClient.query(SET_ORDER, {
            input: { slug: 'panjabi-eid-offer', variantId: 'T_1', quantity: 2, bump: false },
        });
        expect(again.setBdSalesPageOrder.order.lines).toEqual([
            { id: expect.any(String), quantity: 2, productVariant: { id: 'T_1' } },
        ]);
        expect(again.setBdSalesPageOrder.order.subTotalWithTax).toBe(237_000);
        orderId = again.setBdSalesPageOrder.order.id;
    });

    it('records where the order came from, cut to safe lengths', async () => {
        const { setBdOrderAttribution } = await shopClient.query(ATTRIBUTION, {
            input: {
                source: 'facebook',
                medium: 'paid',
                campaign: 'eid-2026',
                fbclid: `IwAR${'x'.repeat(400)}`,
                referrer: 'm.facebook.com',
                salesPage: pageId,
                at: Date.UTC(2026, 9, 20),
            },
        });
        expect(setBdOrderAttribution).toBe(true);
        await shopClient.query(SET_CUSTOMER, { input: { name: 'রহিম উদ্দিন', phone: '01712345678' } });
        await shopClient.query(SET_ADDRESS, {
            input: { districtId: 'BD3026', thanaId: 'BD3026M26', streetLine1: 'বাসা ১২, রোড ৫, মিরপুর ১০' },
        });
        await chooseDelivery(shopClient);
        const placed = await payAndPlace(shopClient);
        expect(placed.state).not.toBe('AddingItems');

        const { order } = await adminClient.query(ORDER_ATTRIBUTION, { id: orderId });
        expect(order.bdAttribution).toMatchObject({
            salesPage: { id: pageId, title: 'Panjabi Eid offer' },
            source: 'facebook',
            medium: 'paid',
            campaign: 'eid-2026',
            referrer: 'm.facebook.com',
            at: new Date(Date.UTC(2026, 9, 20)).toISOString(),
        });
        expect(order.bdAttribution.fbclid).toHaveLength(255);
    });

    it('filters orders and counts them by campaign and sales page', async () => {
        expect((await adminClient.query(ORDERS, { campaign: 'eid-2026' })).bdOrders.totalItems).toBe(1);
        expect((await adminClient.query(ORDERS, { campaign: 'other' })).bdOrders.totalItems).toBe(0);
        expect((await adminClient.query(ORDERS, { salesPageId: pageId })).bdOrders.totalItems).toBe(1);
        const { bdOrdersByCampaign } = await adminClient.query(BY_CAMPAIGN);
        expect(bdOrdersByCampaign).toEqual([
            {
                source: 'facebook',
                medium: 'paid',
                campaign: 'eid-2026',
                salesPage: { id: pageId, title: 'Panjabi Eid offer' },
                orders: 1,
                value: expect.any(Number),
            },
        ]);
        const { bdSalesPages } = await adminClient.query(LIST);
        expect(bdSalesPages.items.find((item: { id: string }) => item.id === pageId).orderCount).toBe(1);
    });

    it('never gives the offer to a normal cart, whatever attribution it carries', async () => {
        // The add-on alone in a normal cart, with an attribution naming the page (anyone can write
        // that cookie): the full price, placed and all.
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_2', quantity: 1 });
        const forged = await shopClient.query(ATTRIBUTION, { input: { salesPage: pageId } });
        expect(forged.setBdOrderAttribution).toBe(true);
        const { activeOrder } = await shopClient.query(ACTIVE_ORDER);
        expect(activeOrder).toMatchObject({ subTotalWithTax: 450_000, discounts: [] });
        await shopClient.query(SET_CUSTOMER, { input: { name: 'করিম মিয়া', phone: '01812345678' } });
        await shopClient.query(SET_ADDRESS, {
            input: { districtId: 'BD3026', thanaId: 'BD3026M26', streetLine1: 'বাসা ৭, রোড ২, মিরপুর ১১' },
        });
        await chooseDelivery(shopClient);
        // Attribution is copied again on every "Place order" (the storefront does this).
        await shopClient.query(ATTRIBUTION, { input: { salesPage: pageId } });
        const placed = await payAndPlace(shopClient);
        expect(placed.state).not.toBe('AddingItems');
        const { order } = await adminClient.query(ORDER_ATTRIBUTION, { id: activeOrder.id });
        expect(order).toMatchObject({ subTotalWithTax: 450_000, discounts: [] });
        // Reports still count it for the page.
        expect(order.bdAttribution.salesPage).toMatchObject({ id: pageId });
    });

    it('keeps the normal price of a pack quantity in the normal cart, so placing is never refused', async () => {
        // An ad shopper (with the real cookie) who later buys two in the normal cart: the total the
        // checkout shows them, with delivery.
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 2 });
        await shopClient.query(SET_CUSTOMER, { input: { name: 'সালমা বেগম', phone: '01912345678' } });
        await shopClient.query(SET_ADDRESS, {
            input: { districtId: 'BD3026', thanaId: 'BD3026M26', streetLine1: 'বাসা ৩, রোড ৮, মিরপুর ২' },
        });
        await chooseDelivery(shopClient);
        const seen = (await shopClient.query(ACTIVE_ORDER)).activeOrder;
        expect(seen).toMatchObject({ subTotalWithTax: 250_000, discounts: [] });
        // "Place order": the storefront copies the cookie, then sets the delivery again (prices are
        // worked out again) and compares the total with the one the shopper saw. A pack price
        // here made it refuse the first tap with "the total has changed".
        await shopClient.query(ATTRIBUTION, {
            input: { source: 'facebook', campaign: 'eid-2026', salesPage: pageId, at: Date.now() },
        });
        await chooseDelivery(shopClient);
        const placing = (await shopClient.query(ACTIVE_ORDER)).activeOrder;
        expect(placing).toMatchObject({ totalWithTax: seen.totalWithTax, discounts: [] });
    });

    it("gives the add-on its price only with the page's product, even from the page's own form", async () => {
        await shopClient.asAnonymousUser();
        const { setBdSalesPageOrder } = await shopClient.query(SET_ORDER, {
            input: { slug: 'panjabi-eid-offer', variantId: 'T_1', quantity: 1, bump: true },
        });
        // One at the normal price, the saree at ৳3,000 instead of ৳4,500.
        expect(setBdSalesPageOrder.order.subTotalWithTax).toBe(125_000 + 300_000);
        const main = setBdSalesPageOrder.order.lines.find(
            (line: { productVariant: { id: string } }) => line.productVariant.id === 'T_1',
        );
        // The page's product taken out (the Shop API allows it): the saree alone is at its price.
        await shopClient.query(REMOVE_LINE, { lineId: main.id });
        const { activeOrder } = await shopClient.query(ACTIVE_ORDER);
        expect(activeOrder).toMatchObject({ subTotalWithTax: 450_000, discounts: [] });
    });

    it('hides packs and the add-on that stock no longer covers', async () => {
        // The placed order holds two: two more can be sold.
        await adminClient.query(SET_STOCK, { id: 'T_1', stock: 4 });
        let { bdSalesPage } = await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' });
        expect(bdSalesPage.packs.map((pack: { available: boolean }) => pack.available)).toEqual([
            true,
            true,
            false,
        ]);
        expect(bdSalesPage.maxQuantity).toBe(2);
        await adminClient.query(SET_STOCK, { id: 'T_2', stock: 0 });
        ({ bdSalesPage } = await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' }));
        expect(bdSalesPage.bump).toBeNull();
        await adminClient.query(SET_STOCK, { id: 'T_1', stock: 0 });
        ({ bdSalesPage } = await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' }));
        expect(bdSalesPage.available).toBe(false);
        await shopClient.asAnonymousUser();
        const { setBdSalesPageOrder } = await shopClient.query(SET_ORDER, {
            input: { slug: 'panjabi-eid-offer', variantId: 'T_1', quantity: 1 },
        });
        expect(setBdSalesPageOrder).toMatchObject({ errorCode: 'NOT_ENOUGH_STOCK', quantityAvailable: 0 });
        await adminClient.query(SET_STOCK, { id: 'T_1', stock: 500 });
    });

    it('duplicates a page with a free address and its sections as a draft', async () => {
        const { duplicateBdSalesPage } = await adminClient.query(DUPLICATE, { id: pageId });
        expect(duplicateBdSalesPage.page).toMatchObject({
            title: 'Panjabi Eid offer (copy)',
            slug: 'panjabi-eid-offer-copy',
            status: 'notPublished',
        });
        const copy = await adminClient.query(LAYOUT, { pageId: duplicateBdSalesPage.page.id });
        const source = await adminClient.query(LAYOUT, { pageId });
        expect(copy.bdPageLayout.draft).toEqual(source.bdPageLayout.draft);
        expect(duplicateBdSalesPage.page.settings.bump.variantId).toBe('T_2');
    });

    it('goes off the storefront when switched off or when its product is deleted', async () => {
        await adminClient.query(UPDATE, { id: pageId, input: { active: false } });
        expect((await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' })).bdSalesPage).toBeNull();
        await shopClient.asAnonymousUser();
        const { setBdSalesPageOrder } = await shopClient.query(SET_ORDER, {
            input: { slug: 'panjabi-eid-offer', variantId: 'T_1', quantity: 1 },
        });
        expect(setBdSalesPageOrder.errorCode).toBe('NOT_AVAILABLE');
        await adminClient.query(UPDATE, { id: pageId, input: { active: true } });
        expect((await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' })).bdSalesPage).not.toBeNull();

        await adminClient.query(DELETE_PRODUCT, { id: 'T_1' });
        expect((await shopClient.query(SHOP_PAGE, { slug: 'panjabi-eid-offer' })).bdSalesPage).toBeNull();
        const { bdSalesPages } = await adminClient.query(LIST);
        expect(bdSalesPages.items.find((item: { id: string }) => item.id === pageId)).toMatchObject({
            status: 'productMissing',
            productId: null,
        });
    });

    it('deletes a page; its orders keep their campaign', async () => {
        expect((await adminClient.query(DELETE, { id: pageId })).deleteBdSalesPage).toBe(true);
        expect((await adminClient.query(LAYOUT, { pageId })).bdPageLayout).toBeNull();
        const { order } = await adminClient.query(ORDER_ATTRIBUTION, { id: orderId });
        expect(order.bdAttribution).toMatchObject({ salesPage: null, campaign: 'eid-2026' });
    });
});
