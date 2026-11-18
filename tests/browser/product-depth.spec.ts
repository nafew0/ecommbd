import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession } from './support/store-api';

/**
 * Product depth (phase 55), in Bangla: a brand and a unit are chosen on the product form, the
 * storefront shows "/ কেজি" beside the price and the brand's page lists the product, and the
 * product goes to the trash and comes back from it.
 */

const storefrontURL = process.env.STOREFRONT_URL ?? 'http://localhost:4321';

test('sets a brand and a unit, shows them on the store, and uses the trash', async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    const admin = await adminSession();
    const run = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const brandCode = `pw-brand-${run}`;
    const { saveBdBrand } = await admin.query(
        `mutation ($input: JSON!) { saveBdBrand(input: $input) { brand { id } errors { path } } }`,
        { input: { name: { bn: `পিডব্লিউ ব্র্যান্ড ${run}`, en: `PW Brand ${run}` }, code: brandCode } },
    );
    expect(saveBdBrand.errors).toEqual([]);
    const name = `PW Mango ${run}`;
    const { saveBdProduct } = await admin.query(
        `mutation ($input: JSON!) { saveBdProduct(input: $input) { product errors { path } } }`,
        {
            input: {
                id: null,
                name: { bn: `পিডব্লিউ আম ${run}`, en: name },
                shortDescription: { bn: '', en: '' },
                description: { bn: '', en: '' },
                enabled: true,
                featuredAssetId: null,
                galleryAssetIds: [],
                feedbackAssetIds: [],
                youtubeUrl: '',
                featured: false,
                isNew: false,
                categoryId: null,
                delivery: { free: false, insideDhaka: null, outsideDhaka: null, surcharge: 0 },
                seo: { title: { bn: '', en: '' }, description: { bn: '', en: '' } },
                variationType: 'none',
                variationName: { bn: '', en: '' },
                variants: [
                    {
                        id: null,
                        option: { bn: '', en: '' },
                        sku: '',
                        price: 25000,
                        oldPrice: null,
                        stock: 50,
                        assetId: null,
                        isDefault: true,
                        enabled: true,
                        allowBackorder: false,
                        weightGrams: null,
                    },
                ],
            },
        },
    );
    expect(saveBdProduct.errors).toEqual([]);
    const productId = saveBdProduct.product.id as string;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    await signIn(page, 'bn');
    await page.goto(`/admin/products/${productId}`);
    await expect(page.getByLabel('অবস্থা')).toHaveValue('published');
    await page.getByLabel('ব্র্যান্ড').selectOption({ label: `পিডব্লিউ ব্র্যান্ড ${run}` });
    await page.getByLabel('একক').selectOption({ label: 'কেজি' });
    await page.getByRole('button', { name: 'পণ্য সেভ করুন' }).click();
    await expect(page.getByText('পণ্য সেভ হয়েছে।')).toBeVisible();
    await page.screenshot({ path: `test-results/product-depth-form-${testInfo.project.name}.png`, fullPage: true });

    // The store: "/ কেজি" beside the price, the brand above the name, and the brand's page.
    await page.goto(`${storefrontURL}/product/${slug}/`);
    await expect(page.locator('.price-unit').first()).toHaveText('/ কেজি');
    await page.locator('.product-brand a').click();
    await expect(page).toHaveURL(new RegExp(`/brand/${brandCode}/$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`পিডব্লিউ ব্র্যান্ড ${run}`);
    await expect(page.getByText(`পিডব্লিউ আম ${run}`)).toBeVisible();
    await page.screenshot({ path: `test-results/product-depth-brand-${testInfo.project.name}.png`, fullPage: true });

    // The trash: out of the list, back as a draft.
    await page.goto('/admin/products');
    await page.getByRole('searchbox').fill(`PW Mango ${run}`);
    const row = page.getByRole('row').filter({ hasText: `পিডব্লিউ আম ${run}` });
    await row.getByRole('button', { name: 'ট্র্যাশে সরান' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ট্র্যাশে সরান' }).click();
    await expect(page.getByText('ট্র্যাশে সরানো হয়েছে।')).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'অন্যান্য' }).click();
    await page.getByRole('menuitem', { name: 'ট্র্যাশ' }).click();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'ফিরিয়ে আনুন' }).click();
    await expect(page.getByText('ড্রাফট হিসেবে ফিরিয়ে আনা হয়েছে।')).toBeVisible();
    await page.getByRole('tab', { name: 'ড্রাফট' }).click();
    await expect(row).toBeVisible();
    await page.screenshot({ path: `test-results/product-depth-list-${testInfo.project.name}.png`, fullPage: true });
    expect(errors, errors.join('\n')).toEqual([]);
});
