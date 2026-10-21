import { CollectionFilter, LanguageCode } from '@vendure/core';

export const CATEGORY_FILTER_CODE = 'bd-category-filter';

/**
 * A category's contents: the products whose `category` field is this collection (set in the
 * product form). Vendure re-applies filters when products change, so lists stay up to date.
 */
export const categoryCollectionFilter = new CollectionFilter({
    code: CATEGORY_FILTER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Products in this category (product form)' },
        { languageCode: LanguageCode.bn, value: 'এই ক্যাটাগরির পণ্য (পণ্যের ফর্ম থেকে)' },
    ],
    args: {
        collectionId: { type: 'ID', label: [{ languageCode: LanguageCode.en, value: 'Category' }] },
    },
    apply: (qb, args) =>
        qb.andWhere(
            `productVariant.productId IN (SELECT "bdCategoryProduct"."id" FROM "product" "bdCategoryProduct"
                WHERE "bdCategoryProduct"."customFieldsCategoryid" = :bdCategoryId AND "bdCategoryProduct"."deletedAt" IS NULL)`,
            { bdCategoryId: args.collectionId },
        ),
});
