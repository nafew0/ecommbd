import { asciiToBanglaDigits } from '@ecommbd/shared/text';

/**
 * Strings for the WooCommerce migration screens (pages/woo-migration.tsx and the woo-* components),
 * kept apart from en.ts/bn.ts because there are many. `migrationBn` has the same type, so a missing
 * Bangla string fails the typecheck. Terms follow docs/glossary.md.
 */

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const migrationEn = {
    sourceReference: 'Imported source settings',
    importedPixel: 'Imported Meta Pixel ID',
    referenceHint:
        'Review these values before configuring payments, shipping or tracking. The Meta integration is owned by Phase 20; importing this reference does not enable tracking.',
    ordersSince: 'Orders placed since (your local time)',
    exportRollback: 'Export private rollback orders',
    rollbackHint:
        'For a rollback, export the last 31 days or less. Keep this customer/payment data private and reconcile it before re-entry.',
    helperTitle: 'WordPress helper and cutover',
    helperHint:
        'Install Ecomm BD Migrator in WordPress on a copy of the old store. Create pairing details here, paste them in WooCommerce → Move to Ecomm BD, and wait for upload completion. Select that source below to dry-run and import.',
    createPairing: 'Create one-use pairing',
    pairingDetails: 'Pairing details (valid for one hour)',
    fileTitle: 'Or import an export file',
    fileHint:
        'If the old site cannot connect to this store, open WooCommerce → Move to Ecomm BD there, click Create export file, wait for "Export complete" and download the file. Choose it here. Then select its source below to dry-run and import.',
    exportFile: 'Export file (.jsonl.gz or .jsonl)',
    importFile: 'Import file',
    fileUploading: (percent: number) => `Uploading the file: ${percent}%`,
    fileImported: (products: number, customers: number, orders: number) =>
        `File read: ${plural(products, 'product', 'products')}, ${plural(customers, 'customer', 'customers')} and ${plural(orders, 'order', 'orders')}. Next, run the check.`,
    revokeHelper: 'Revoke helper upload token',
    redirectTitle: 'Old URL mappings',
    oldPath: 'Old local path',
    targetPath: 'Final local path',
    saveRedirect: 'Save redirect',
    missingUrls: 'Most visited missing URLs',
    crawler: 'Check old sitemap URLs',
    sitemap: 'Old sitemap URL (HTTPS)',
    destination: 'New storefront URL (HTTPS)',
    runCrawl: 'Check URLs',
    cutoverTitle: 'Cutover checklist',
    cutoverHint: 'These checks record your review. They do not change DNS, payment panels or the old store.',
    saveChecklist: 'Save checklist',
    cutoverSteps: {
        backup: 'Backups and permission recorded',
        rehearsal: 'Staging rehearsal and totals passed',
        dnsTtl: 'DNS TTL lowered 24 hours beforehand',
        ssl: 'New subdomain and SSL ready',
        freeze: 'Old checkout and source writes frozen',
        sync: 'Final full reconciliation and images verified',
        gateway: 'Gateway callbacks/IPN updated',
        courier: 'Courier webhook URLs updated',
        meta: 'Meta domain verification checked',
        searchConsole: 'Search Console ownership checked',
        crawl: 'Old sitemap crawl passed with no chains',
        rollback: 'Thirty-day rollback plan and new-order export ready',
    },
    /** The step-by-step migration page and the WooCommerce orders page. */
    flow: {
        steps: {
            connect: 'Connect',
            check: 'Check',
            import: 'Import',
            links: 'Old links',
            live: 'Go live',
        },
        stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
        done: 'Done',
        oldStore: 'Old store',
        addStore: 'Connect another store',
        cancelAdd: 'Cancel',
        connectTitle: 'Connect your old WooCommerce store',
        connectIntro:
            'Choose how to bring your products, customers and orders here. All three bring the same data; you can import again later to update it.',
        methods: {
            helper: {
                title: 'WordPress plugin',
                badge: 'Recommended',
                hint: 'The Ecomm BD Migrator plugin sends everything from WordPress straight to this store.',
            },
            file: {
                title: 'Export file',
                hint: 'For a site that cannot reach this store: the plugin makes a file you download, then upload here.',
            },
            rest: {
                title: 'WooCommerce API key',
                hint: 'Only if you cannot install a plugin. Needs a Read API key from WooCommerce → Settings → Advanced → REST API.',
            },
        },
        helperSteps: [
            'Install and activate the Ecomm BD Migrator plugin on your WordPress site.',
            'Enter your WordPress store address below and click "Create one-use pairing".',
            'Copy the pairing details. In WordPress, open WooCommerce → Move to Ecomm BD, paste them and start the upload.',
            'Keep that page open until it says the upload is complete. The store then appears here, ready to check.',
        ],
        fileSteps: [
            'In WordPress, open WooCommerce → Move to Ecomm BD and click "Create export file".',
            'Wait for "Export complete", then download the file.',
            'Choose the file below and click "Import file".',
        ],
        restSteps: [
            'In WordPress, open WooCommerce → Settings → Advanced → REST API and add a key with Read permission.',
            'Paste the store address, consumer key and secret below and click Connect.',
        ],
        moreOptions: 'More options',
        hostsHint: 'Only needed when product images are on another domain, such as a CDN.',
        checkTitle: 'Check before importing',
        checkHint:
            'Reads the old store and reports what will come across and what needs attention. Nothing changes in this store.',
        checkAgain: 'Run the check again',
        importTitle: 'Import into this store',
        importHint:
            'Copies categories, products, images, customers and order history. Running it again updates what changed; nothing is duplicated.',
        checkFirst: 'Run the check (previous step) first.',
        seeOrders: 'See the imported orders',
        seeProducts: 'See the products',
        seeCustomers: 'See the customers',
        linksTitle: 'Keep your old links working',
        linksHint:
            'Old product and page addresses send visitors to the new pages, so search rankings and shared links keep working. The import creates most of them; add any that are missing here.',
        liveTitle: 'Switch to the new store',
        liveHint:
            'Do these in order on the day you switch. Nothing here changes your domain or the old store.',
        syncTitle: 'Last sync',
        syncHint:
            "After closing the old store's checkout, bring over the orders and changes made since the import.",
        finishTitle: 'Finish the migration',
        finishHint:
            "When the new store is live, remove the saved keys and the plugin's access. The imported data stays.",
        rollbackTitle: 'Rollback export',
        latestRun: 'Latest run',
        earlierRuns: 'Choose a run',
        notRun: 'Not run yet.',
        running: 'Working… you can leave this page; it continues in the background.',
        next: 'Next step',
        back: 'Previous step',
        ordersTitle: 'WooCommerce orders',
        ordersIntro:
            'Orders imported from your old WooCommerce store. They are kept as history: they keep their old totals and do not change stock or send messages. New orders appear in All orders.',
        ordersEmpty: 'No orders have been imported from WooCommerce.',
        ordersBanner: (count: string) =>
            `${count} orders from your old WooCommerce store are kept separately.`,
        ordersBannerLink: 'See WooCommerce orders',
        customer: 'Customer',
        orderNumber: 'Order',
        date: 'Date',
    },
    title: 'WooCommerce migration',
    intro: 'Connect a copy of the old store, review a dry run, then import. Keep the old checkout frozen during the final sync.',
    source: 'Source store',
    url: 'WooCommerce store URL (HTTPS)',
    key: 'Consumer key (Read permission)',
    secret: 'Consumer secret',
    hosts: 'Additional image hosts, separated by commas',
    tax: 'Source catalog prices include tax',
    weight: 'Source weight unit',
    connect: 'Connect / update credentials',
    connected: 'Store connected. Credentials are stored encrypted.',
    select: 'Choose a source store',
    dryRun: 'Run dry run',
    import: 'Import reviewed data',
    catchUp: 'Catch up changes',
    acknowledge: 'I reviewed the dry-run issues and accept the reported exclusions.',
    resume: 'Resume interrupted run',
    complete: 'Finish and remove saved keys',
    completeBody:
        'This removes the saved WooCommerce keys. Revoke the read-only keys in WooCommerce too. Records and reports remain available.',
    runs: 'Migration runs',
    counts: 'Progress',
    issues: 'Issues (latest 200)',
    verification: 'Verification',
    csv: 'Download CSV report',
    html: 'Download HTML report',
    credentialsRemoved: 'Saved credentials removed. Revoke them in WooCommerce.',
    noRuns: 'No runs yet.',
    failed: 'The operation needs attention. Review the code and retry after correcting the source or settings.',
    status: 'Status',
    mode: 'Mode',
    resource: 'Resource',
    processed: 'Records processed',
    code: 'Issue code',
    severity: 'Severity',
    sourceId: 'Source record',
    legacyTitle: 'WooCommerce order history',
    legacyIntro:
        'Historical snapshots preserve the old totals. They do not reserve stock or send notifications.',
    search: 'Search by order number, phone digits or name',
    previous: 'Previous',
    next: 'Next',
    details: 'Details',
    number: 'Original order number',
    total: 'Original total',
    currency: 'Currency',
    empty: 'No historical orders found.',
    close: 'Close details',
    snapshot: 'Original order snapshot',
    open: 'Convert reviewed COD order',
    frozen: 'The old checkout is frozen and this order will not be fulfilled there.',
    reduced: 'WooCommerce already deducted this order from the imported available stock.',
    conversionHint:
        'Conversion requires a recent unpaid COD order, a reviewed address and exact matching totals. Repeating it returns the same live order.',
    converted: 'Live order created. Continue in Orders.',
    active: 'Open live order',
    states: {
        queued: 'Queued',
        running: 'Running',
        completed: 'Completed',
        needsReview: 'Needs review',
        failed: 'Interrupted',
    },
    modes: { dryRun: 'Dry run', import: 'Import', catchUp: 'Catch-up' },
    /** Stage names, the kinds of record an issue is about, and the keys of a run's `counts`. */
    stages: {
        coupons: 'Coupons',
        reviews: 'Reviews',
        settings: 'Source settings',
        categories: 'Categories',
        tags: 'Tags',
        products: 'Products',
        customers: 'Customers',
        orders: 'Orders',
        written: 'Written',
        unchanged: 'Unchanged',
        dryRun: 'Inspected',
        failed: 'Refused records',
        images: 'Images',
        imageHosts: 'Image hosts',
        guestCustomers: 'Guest customers',
        variants: 'Variations',
    },

    // The run's report (components/woo-run-report.tsx).
    runStopped: 'The run stopped.',
    report: {
        dryRun: 'Dry run: nothing has been saved yet. These are the numbers found in the old store.',
        matches: 'Everything checked matches the old store.',
        differs: 'Some numbers differ from the old store. Check the rows marked “Different”.',
        recordsFound: 'Records found',
        estimatedTime: 'Estimated import time',
        estimateHint:
            'A rough guide from the number of records. A slow old host and many images take longer.',
        counts: 'Records by type',
        kind: 'Type',
        oldStore: 'Old store',
        read: 'Read',
        imported: 'Imported',
        skipped: 'Skipped',
        result: 'Result',
        same: 'Same',
        different: 'Different',
        totals: 'Order totals by month',
        totalsSummary: (months: number, different: number) =>
            plural(months, 'month', 'months') + (different ? `, ${different} different` : ''),
        month: 'Month',
        unknownMonth: 'No date',
        samples: 'Sample orders',
        samplesResult: (passed: number, total: number) =>
            `${passed} of ${total} sample orders match exactly.`,
        sampleDiffers: (order: string, fields: string) => `Order #${order} differs in: ${fields}.`,
        sampleMissing: (order: string) => `Order #${order} was not found here.`,
        /** The parts of an order the spot check compares. */
        sampleFields: {
            total: 'total',
            currency: 'currency',
            status: 'status',
            number: 'order number',
            lines: 'items',
            notes: 'notes',
            refunds: 'refunds',
        },
        images: 'Images',
        imagesCopied: (count: number) => `${plural(count, 'image', 'images')} copied`,
        imagesReady: (count: number) => `${count} ready to show`,
        imagesFailed: (count: number) => `${count} could not be copied`,
        technical: 'Technical details (for Ecomm BD support)',
    },
    duration: {
        underMinute: 'Under a minute',
        minutes: (minutes: number) => `About ${plural(minutes, 'minute', 'minutes')}`,
        hours: (hours: number, minutes: number) =>
            `About ${plural(hours, 'hour', 'hours')}${minutes ? ` ${minutes} minutes` : ''}`,
    },
    months: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ],

    // Issues.
    noIssues: 'No issues found.',
    severities: { error: 'Must fix', warning: 'Check' },
    affected: (count: number) => plural(count, 'record', 'records'),
    more: (count: number) => `and ${count} more`,
    codeLabel: (code: string) => `Code: ${code}`,
    unknownCode: (code: string) =>
        `Something needs checking (code ${code}). If it keeps happening, send this code to Ecomm BD support.`,
    sourceHttp: (status: number) =>
        `The old store answered with error ${status}. Check that the site and its WooCommerce API are working.`,
    /**
     * Every code the importer can show a merchant, in one place: the issue codes it records
     * (`issue(…, 'CODE')` in apps/core/src/plugins/woo-import), the codes a refused record or a
     * stopped run carries (`new Error('CODE')`), the WordPress helper's warnings, and the sitemap
     * check's errors. `SOURCE_HTTP_<status>` is built from a value and has its own message
     * (`sourceHttp`); a code missing here falls back to `unknownCode`. The admin's unit tests
     * (components/woo-migration-format.spec.ts) read the core and fail when a code has no message.
     */
    codes: {
        // Issues found while reading or importing a record.
        SOURCE_COUNT_MISMATCH:
            'Fewer or more records were read than the old store reported. Run it again; if it repeats, check whether records are changing during the import.',
        SOURCE_RECORD_UNREADABLE:
            'Part of this record (its variations, notes or refunds) could not be read from the old store, so it was skipped. A catch-up reads it again.',
        UNSUPPORTED_PRODUCT_TYPE:
            'This kind of product (grouped, external, virtual or downloadable) is not imported. Add it by hand if you still sell it.',
        BUILDER_SHORTCODES:
            'Page-builder shortcodes were removed from the description. Check that it still reads well.',
        SHARED_PARENT_STOCK_REQUIRES_REVIEW:
            'Stock is kept on the main product, not on each variation. Set stock for each variation, then switch the product on.',
        VARIATION_WITHOUT_PRICE_SKIPPED:
            'A variation has no price, so it was skipped. Give it a price in WooCommerce and run again, or add it here.',
        IMAGE_HOST_NOT_APPROVED:
            'Images come from a site that is not in the image hosts list, so they are skipped. Add this host when connecting the store.',
        INVALID_IMAGE_URL: 'An image link is broken, so the image was skipped.',
        IMAGE_FAILED_OR_UNAPPROVED:
            'An image could not be copied. Check that it opens on the old store and that its host is in the image hosts list.',
        SOURCE_CONTENT_LIMIT_REQUIRES_REVIEW:
            'This product has more than 100 images or a very long description. Shorten it in WooCommerce and run again.',
        DIMENSIONS_RETAINED_IN_MAPPING:
            'The package size (length, width, height) was kept for reference. It is not used for delivery charges.',
        HIDDEN_PRODUCT_IMPORTED_DISABLED:
            'This product was hidden in the old store, so it was imported switched off.',
        DUPLICATE_SKU_IN_SOURCE:
            'Another product in the old store has the same SKU. Give each product its own SKU.',
        DUPLICATE_SKU_SUFFIXED:
            'This SKU was already used here, so something was added to the end of it. Check the SKU before printing labels.',
        TAX_EXCLUSIVE_PRICE_REQUIRES_REVIEW:
            'The old price does not include tax. The product stays switched off until you check its price.',
        WILDCARD_VARIATION_REQUIRES_REVIEW:
            'A variation uses “Any” for an option. Create each variation separately in WooCommerce, then run again.',
        SALE_SCHEDULE_REQUIRES_REVIEW:
            'The sale price had start or end dates, which were not imported. Check the sale price here.',
        CATEGORY_PARENT_MISSING:
            'This category’s parent was not imported, so it was put at the top level. Move it under the right category here.',
        CATEGORY_CYCLE:
            'Two categories are set as each other’s parent. Fix the category tree in WooCommerce.',
        ADDRESS_NEEDS_REVIEW:
            'The district or thana could not be matched. Check the address before delivery.',
        PHONE_MISSING_OR_AMBIGUOUS:
            'No single valid Bangladeshi mobile number was found. Add the phone number by hand.',
        FOREIGN_CURRENCY_PRESERVED:
            'This order was not in taka. It is kept in its original currency in the order history.',
        MERGED_CUSTOMER_PROFILE_NOT_OVERWRITTEN:
            'This customer already existed here, so their profile was not overwritten.',
        CUSTOMER_IDENTITY_CONFLICT:
            'The phone number and the email belong to two different customers here. Check which customer this is.',
        EMAIL_HAS_DIFFERENT_PHONE:
            'A customer with this email already has a different phone number here, so they were kept separate.',
        LEGACY_LOGIN_IDENTITY_REFUSED:
            'This customer’s old password was not carried over, because their account could not be matched safely.',
        LEGACY_PASSWORD_FORMAT_REQUIRES_RESET:
            'This customer’s old password is stored in a format we cannot check. They will need to set a new password.',
        LEGACY_LOGIN_IDENTIFIER_CONFLICT:
            'Another account here already uses this email, so the old login was not carried over.',
        COUPON_CONSTRAINT_REQUIRES_REVIEW:
            'This coupon has rules that cannot be copied (product limits, free delivery or similar). Create it again here.',
        COUPON_USED_UP_IMPORTED_DISABLED: 'This coupon had no uses left, so it was imported switched off.',
        COUPON_PER_CUSTOMER_HISTORY_NOT_KEPT:
            'This coupon has a limit per customer, but earlier uses in the old store are not carried over: customers can use it again up to the limit.',
        REDIRECT_RULE_REQUIRES_REVIEW:
            'An old address could not be redirected automatically. Add a rule for it by hand under Old URL mappings.',
        // Warnings from the WordPress helper about the old site.
        PRIMARY_LANGUAGE_ONLY_REVIEW:
            'The old store uses a translation plugin. Only the main language was imported.',
        SUBSCRIPTIONS_BOOKINGS_NOT_SUPPORTED:
            'Subscriptions and bookings are not supported and were not imported.',

        // Why a record was refused, or why a run stopped.
        IMPORT_RECORD_FAILED: 'This record could not be imported. Check it in WooCommerce and run again.',
        IMPORT_LEASE_LOST:
            'The run was interrupted (another worker took it over, or it timed out). Resume it.',
        QUEUE_UNAVAILABLE:
            'The import could not be started. Resume it once the background worker is running.',
        LEGACY_USER_CREATE_FAILED: 'The customer’s login account could not be created.',
        COUPON_DISABLE_FAILED:
            'A coupon that needs checking could not be switched off. Switch it off by hand.',
        INVALID_COUPON_AMOUNT:
            'The coupon amount is not valid (zero, negative, over 100% or not in whole taka).',
        COUPON_IMPORT_FAILED: 'The coupon could not be saved. Its code may already be used here.',
        CATEGORY_SLUG_CONFLICT: 'A category with the same link name already exists here. Rename one of them.',
        PRODUCT_SLUG_CONFLICT: 'A product with the same link name already exists here. Rename one of them.',
        SOURCE_CATALOG_CURRENCY_NOT_BDT:
            'The old store’s currency is not taka, so products cannot be imported. Set the currency to BDT on the copy.',
        IMPORTED_FACET_MISSING:
            'A product option list made by the import (for example Size) was deleted here. Run the import again.',
        IMAGE_DOWNLOAD_FAILED: 'An image could not be downloaded from the old store.',
        IMAGE_REJECTED: 'An image was refused: the file type is not supported or it is too large.',
        VARIABLE_PRODUCT_HAS_NO_VARIATIONS:
            'This product has options but no variations. Add variations in WooCommerce or make it a simple product.',
        INVALID_WEIGHT: 'The weight is not a valid number.',
        DESTINATION_HAS_ALLOCATED_STOCK:
            'Stock for this product is already held for live orders here, so its stock was not overwritten.',
        MAPPED_CUSTOMER_IDENTITY_CHANGED:
            'This customer’s phone number or email changed in the old store since the last import. Update it here by hand.',
        OPEN_ORDER_ALREADY_CONVERTED:
            'This order was already turned into a live order, so it was not updated.',
        ORDER_NUMBER_RANGE_REQUIRES_REVIEW:
            'Old order numbers are far higher than the new store’s. Contact Ecomm BD support before going live.',
        HTTPS_SOURCE_REQUIRED: 'The store address must start with https://.',
        INVALID_SOURCE_RESOURCE:
            'The import asked the old store for an unknown kind of data. Contact Ecomm BD support.',
        INVALID_SOURCE_ENDPOINT:
            'The import tried an unexpected address on the old store. Contact Ecomm BD support.',
        INVALID_SOURCE_RESPONSE:
            'The old store sent a reply that could not be read. A plugin may be changing the WooCommerce API.',
        SOURCE_AUTH_OR_FIREWALL:
            'The old store refused the API keys, or a security plugin (such as Wordfence) blocked the request. Check the read-only keys, or use the WordPress helper plugin instead.',
        SOURCE_TIMEOUT: 'The old store took too long to answer. Resume when it is less busy.',
        SOURCE_NETWORK: 'The old store could not be reached. Check that the site is online, then resume.',
        SOURCE_BLOCKED: 'The old store’s address points to a private network, so it was blocked.',
        SOURCE_TOO_LARGE: 'The old store sent too much data at once.',
        SOURCE_TOO_MANY_REDIRECTS: 'The old store keeps redirecting. Check its address and HTTPS settings.',
        SOURCE_CIRCUIT_OPEN: 'The old store failed several times in a row. Wait a few minutes, then resume.',
        SOURCE_CHILD_LIMIT: 'A product or order has too many variations, notes or refunds to import.',
        INVALID_RECORD: 'The old store sent a record that could not be read.',
        INVALID_SOURCE_ID: 'A record from the old store has no valid ID.',
        DECIMAL_OUT_OF_RANGE: 'An amount is too large.',
        INVALID_DECIMAL: 'An amount is not a valid number.',
        CATALOG_PRICE_NOT_WHOLE_TAKA: 'A price has poisha or is too large. Prices must be in whole taka.',
        INVALID_GMT_DATE: 'A date could not be read.',

        // Old addresses and the sitemap check.
        INVALID_LOCAL_PATH: 'This old address is not valid. It must start with / and be on the same site.',
        RESERVED_REDIRECT_PATH:
            'This address is used by the new store itself, so it cannot be a redirect target.',
        SITEMAP_HOST_CHANGED: 'The sitemap points to another website. Use the old store’s own sitemap.',
        SITEMAP_READ_FAILED: 'The sitemap could not be opened. Check its address.',
        UNSAFE_SITEMAP:
            'The sitemap contains content that is not read for safety reasons. Use the standard WordPress or SEO-plugin sitemap.',
        // Raised by this screen itself (components/woo-cutover.tsx), not by the core.
        EXPORT_TOO_LARGE: 'More than 5,000 orders were placed in this time. Choose a later start time.',
    },

    // WooCommerce order statuses (the old store's words; plugins can add more).
    wooStatuses: {
        pending: 'Pending payment',
        processing: 'Processing',
        'on-hold': 'On hold',
        completed: 'Completed',
        cancelled: 'Cancelled',
        refunded: 'Refunded',
        failed: 'Failed',
        'checkout-draft': 'Draft',
        draft: 'Draft',
        trash: 'In trash',
    },

    // An old order's details (components/legacy-orders.tsx).
    placedAt: 'Order date',
    orderStatus: 'Status in WooCommerce',
    payment: 'Payment',
    cod: 'Cash on delivery',
    items: 'Items',
    deliveryCharge: 'Delivery charge',
    discount: 'Discount',
    refunded: 'Refunded',
    customerNote: 'Customer note',
    address: 'Address',
    billingAddress: 'Billing address',
    deliveryAddress: 'Delivery address',
    name: 'Name',
    phone: 'Phone number',
    district: 'District',
    convertedTag: 'Converted to a live order',

    // Old URL mappings and missing pages (components/woo-cutover.tsx).
    gone: 'Gone (410)',
    visits: (count: number) => plural(count, 'visit', 'visits'),
    editedByStaff: 'Edited by staff',
    editedByStaffHint: 'Rules saved here are never changed by later imports.',
    deleteRedirectLabel: (path: string) => `Delete redirect ${path}`,
    deleteRedirectTitle: 'Delete this redirect?',
    deleteRedirectBody: (path: string) =>
        `Visitors to ${path} will see “Page not found” until you add a new rule for it.`,
    noRedirects: 'No old URL mappings yet.',
    missingHint: 'Old addresses visitors asked for that have no page here. Redirect the busiest ones.',
    noMisses: 'No missing pages recorded yet.',
    redirectMiss: 'Redirect',
    redirectMissLabel: (path: string) => `Redirect ${path}`,
    hasRule: 'Rule saved',

    // The sitemap check's result.
    crawlPassed: (count: number) => `All ${count} checked URLs open on the new store.`,
    crawlFailed: (failed: number, total: number) =>
        `${failed} of ${total} old URLs do not open correctly. Add redirects for them and check again.`,
    crawlEmpty: 'No URLs were found in this sitemap. Check the sitemap address.',
    crawlTruncated:
        'The check stopped early: it reads at most 2,000 URLs from 20 sitemap files. Check again after fixing these.',
    crawlCheckedAt: (date: string) => `Checked ${date}`,
    failingUrls: 'URLs to fix',
    crawlStatus: {
        noAnswer: 'No answer',
        notFound: 'Not found (404)',
        gone: 'Gone (410)',
        redirect: (status: number) => `Redirects more than once (${status})`,
        server: (status: number) => `Server error (${status})`,
        other: (status: number) => `Error ${status}`,
    },

    // The old store's settings, for reference.
    pricesIncludedTax: 'Prices in the old store include tax',
    yes: 'Yes',
    no: 'No',
    shippingZones: 'Shipping zones',
    noShippingZones: 'No shipping zones were set up.',
    zoneNoLocations: 'No locations set',
    locationTypes: {
        country: 'Countries',
        state: 'Districts',
        postcode: 'Postcodes',
        continent: 'Continents',
    },
    permalinks: 'Old link format',
    permalinkKinds: {
        product_base: 'Product links',
        category_base: 'Category links',
        tag_base: 'Tag links',
        attribute_base: 'Attribute links',
    },
    permalinkDefault: 'WooCommerce default',
    importedRedirects: (count: number) =>
        `${plural(count, 'redirect rule', 'redirect rules')} found in the old store.`,
};

/** Bangla digits for counts, the way the rest of the Bangla admin writes numbers. */
const n = (value: number) => asciiToBanglaDigits(String(value));

export const migrationBn: typeof migrationEn = {
    sourceReference: 'ইমপোর্ট করা পুরোনো সেটিংস',
    importedPixel: 'পুরোনো Meta Pixel ID',
    referenceHint:
        'পেমেন্ট, ডেলিভারি বা ট্র্যাকিং সেট করার আগে এগুলো মিলিয়ে নিন। Meta সংযোগ ফেজ ২০-এর কাজ; এই তথ্য আনলেই ট্র্যাকিং চালু হয় না।',
    ordersSince: 'এই সময়ের পরের অর্ডার (আপনার স্থানীয় সময়)',
    exportRollback: 'ফেরত নেওয়ার জন্য ব্যক্তিগত অর্ডার এক্সপোর্ট',
    rollbackHint:
        'ফেরত যাওয়ার জন্য সর্বশেষ ৩১ দিন বা তার কম সময়ের অর্ডার নামান। ক্রেতা ও পেমেন্টের তথ্য ব্যক্তিগত রাখুন এবং আবার লেখার আগে মিলিয়ে নিন।',
    helperTitle: 'WordPress হেল্পার ও স্টোর বদলানো',
    helperHint:
        'পুরোনো স্টোরের কপির WordPress-এ Ecomm BD Migrator বসান। এখানে পেয়ারিং তথ্য বানিয়ে WooCommerce → Ecomm BD-তে নিন পাতায় দিন। আপলোড শেষ হলে নিচে স্টোর বেছে ড্রাই রান ও ইমপোর্ট করুন।',
    createPairing: 'একবারের পেয়ারিং তৈরি করুন',
    pairingDetails: 'পেয়ারিং তথ্য (এক ঘণ্টা চলবে)',
    fileTitle: 'অথবা এক্সপোর্ট ফাইল ইমপোর্ট করুন',
    fileHint:
        'পুরোনো সাইট এই স্টোরের সাথে যুক্ত হতে না পারলে সেখানে WooCommerce → Ecomm BD-তে নিন পাতায় "এক্সপোর্ট ফাইল তৈরি করুন" চাপুন, "এক্সপোর্ট সম্পূর্ণ" দেখালে ফাইলটি ডাউনলোড করুন। ফাইলটি এখানে বেছে নিন। তারপর নিচে স্টোর বেছে ড্রাই রান ও ইমপোর্ট করুন।',
    exportFile: 'এক্সপোর্ট ফাইল (.jsonl.gz বা .jsonl)',
    importFile: 'ফাইল ইমপোর্ট করুন',
    fileUploading: (percent: number) => `ফাইল আপলোড হচ্ছে: ${asciiToBanglaDigits(String(percent))}%`,
    fileImported: (products: number, customers: number, orders: number) =>
        `ফাইল পড়া হয়েছে: ${asciiToBanglaDigits(String(products))}টি পণ্য, ${asciiToBanglaDigits(String(customers))} জন কাস্টমার ও ${asciiToBanglaDigits(String(orders))}টি অর্ডার। এবার যাচাই চালান।`,
    revokeHelper: 'হেল্পারের আপলোড টোকেন বাতিল করুন',
    redirectTitle: 'পুরোনো ঠিকানার নিয়ম',
    oldPath: 'পুরোনো লোকাল পাথ',
    targetPath: 'শেষ লোকাল পাথ',
    saveRedirect: 'রিডাইরেক্ট সেভ করুন',
    missingUrls: 'বেশি খোঁজা না পাওয়া ঠিকানা',
    crawler: 'পুরোনো সাইটম্যাপের ঠিকানা যাচাই',
    sitemap: 'পুরোনো সাইটম্যাপ (HTTPS)',
    destination: 'নতুন স্টোরের ঠিকানা (HTTPS)',
    runCrawl: 'ঠিকানা যাচাই করুন',
    cutoverTitle: 'স্টোর বদলানোর তালিকা',
    cutoverHint: 'এতে আপনার যাচাই সেভ হয়। DNS, পেমেন্ট প্যানেল বা পুরোনো স্টোর বদলায় না।',
    saveChecklist: 'তালিকা সেভ করুন',
    cutoverSteps: {
        backup: 'ব্যাকআপ ও অনুমতি রাখা হয়েছে',
        rehearsal: 'স্টেজিংয়ে মাইগ্রেশন ও হিসাব মিলে গেছে',
        dnsTtl: '২৪ ঘণ্টা আগে DNS TTL কমানো হয়েছে',
        ssl: 'নতুন সাবডোমেইন ও SSL প্রস্তুত',
        freeze: 'পুরোনো চেকআউট ও তথ্য বদলানো বন্ধ',
        sync: 'শেষ সিঙ্ক ও ছবি যাচাই হয়েছে',
        gateway: 'পেমেন্ট গেটওয়ের callback/IPN বদলানো হয়েছে',
        courier: 'কুরিয়ারের webhook ঠিকানা বদলানো হয়েছে',
        meta: 'Meta ডোমেইন যাচাই হয়েছে',
        searchConsole: 'Search Console মালিকানা যাচাই হয়েছে',
        crawl: 'পুরোনো সাইটম্যাপে ভাঙা ঠিকানা বা রিডাইরেক্ট চেইন নেই',
        rollback: '৩০ দিনের ফেরত যাওয়ার পরিকল্পনা ও নতুন অর্ডার এক্সপোর্ট প্রস্তুত',
    },
    flow: {
        steps: {
            connect: 'যুক্ত করুন',
            check: 'যাচাই',
            import: 'ইমপোর্ট',
            links: 'পুরোনো লিংক',
            live: 'লাইভ করুন',
        },
        stepOf: (step: number, total: number) =>
            `ধাপ ${asciiToBanglaDigits(String(step))}/${asciiToBanglaDigits(String(total))}`,
        done: 'সম্পন্ন',
        oldStore: 'পুরোনো স্টোর',
        addStore: 'আরেকটি স্টোর যুক্ত করুন',
        cancelAdd: 'বাতিল',
        connectTitle: 'আপনার পুরোনো WooCommerce স্টোর যুক্ত করুন',
        connectIntro:
            'পণ্য, কাস্টমার আর অর্ডার কীভাবে আনবেন বেছে নিন। তিনটি উপায়েই একই তথ্য আসে; পরে আবার ইমপোর্ট করে আপডেট করা যায়।',
        methods: {
            helper: {
                title: 'WordPress প্লাগইন',
                badge: 'সুপারিশকৃত',
                hint: 'Ecomm BD Migrator প্লাগইন WordPress থেকে সব তথ্য সরাসরি এই স্টোরে পাঠায়।',
            },
            file: {
                title: 'এক্সপোর্ট ফাইল',
                hint: 'যে সাইট এই স্টোরে সংযোগ করতে পারে না: প্লাগইন একটি ফাইল বানায়, সেটি ডাউনলোড করে এখানে আপলোড করুন।',
            },
            rest: {
                title: 'WooCommerce API কী',
                hint: 'শুধু প্লাগইন বসানো না গেলে। WooCommerce → Settings → Advanced → REST API থেকে Read অনুমতির কী লাগবে।',
            },
        },
        helperSteps: [
            'আপনার WordPress সাইটে Ecomm BD Migrator প্লাগইন ইনস্টল করে চালু করুন।',
            'নিচে WordPress স্টোরের ঠিকানা দিয়ে "একবারের পেয়ারিং তৈরি করুন" চাপুন।',
            'পেয়ারিং তথ্য কপি করুন। WordPress-এ WooCommerce → Ecomm BD-তে নিন পাতায় পেস্ট করে আপলোড শুরু করুন।',
            'আপলোড সম্পূর্ণ না হওয়া পর্যন্ত সেই পাতা খোলা রাখুন। তারপর স্টোরটি এখানে দেখাবে, যাচাইয়ের জন্য তৈরি।',
        ],
        fileSteps: [
            'WordPress-এ WooCommerce → Ecomm BD-তে নিন পাতায় "এক্সপোর্ট ফাইল তৈরি করুন" চাপুন।',
            '"এক্সপোর্ট সম্পূর্ণ" দেখালে ফাইলটি ডাউনলোড করুন।',
            'নিচে ফাইলটি বেছে নিয়ে "ফাইল ইমপোর্ট করুন" চাপুন।',
        ],
        restSteps: [
            'WordPress-এ WooCommerce → Settings → Advanced → REST API-তে Read অনুমতির একটি কী যোগ করুন।',
            'নিচে স্টোরের ঠিকানা, কনজিউমার কী ও সিক্রেট দিয়ে যুক্ত করুন চাপুন।',
        ],
        moreOptions: 'আরও অপশন',
        hostsHint: 'শুধু তখনই লাগবে যখন পণ্যের ছবি অন্য ডোমেইনে (যেমন CDN) থাকে।',
        checkTitle: 'ইমপোর্টের আগে যাচাই করুন',
        checkHint: 'পুরোনো স্টোর পড়ে দেখায় কী কী আসবে আর কোথায় নজর দিতে হবে। এই স্টোরে কিছুই বদলায় না।',
        checkAgain: 'আবার যাচাই করুন',
        importTitle: 'এই স্টোরে ইমপোর্ট করুন',
        importHint:
            'ক্যাটাগরি, পণ্য, ছবি, কাস্টমার আর অর্ডারের ইতিহাস কপি করে। আবার চালালে শুধু বদলানো তথ্য আপডেট হয়; কিছু দুবার হয় না।',
        checkFirst: 'আগে যাচাই (আগের ধাপ) চালান।',
        seeOrders: 'ইমপোর্ট করা অর্ডার দেখুন',
        seeProducts: 'পণ্য দেখুন',
        seeCustomers: 'কাস্টমার দেখুন',
        linksTitle: 'পুরোনো লিংকগুলো চালু রাখুন',
        linksHint:
            'পুরোনো পণ্য ও পাতার ঠিকানা থেকে ভিজিটর নতুন পাতায় যায়, তাই সার্চের র‍্যাংকিং আর শেয়ার করা লিংক কাজ করে। বেশিরভাগ ইমপোর্টের সময় তৈরি হয়; বাদ পড়াগুলো এখানে যোগ করুন।',
        liveTitle: 'নতুন স্টোরে চলে যান',
        liveHint:
            'যেদিন বদলাবেন সেদিন ক্রমানুসারে করুন। এখানকার কিছুই আপনার ডোমেইন বা পুরোনো স্টোর বদলায় না।',
        syncTitle: 'শেষ সিঙ্ক',
        syncHint: 'পুরোনো স্টোরের চেকআউট বন্ধ করার পর, ইমপোর্টের পরে আসা অর্ডার ও বদল নিয়ে আসুন।',
        finishTitle: 'মাইগ্রেশন শেষ করুন',
        finishHint:
            'নতুন স্টোর লাইভ হলে সেভ করা কী আর প্লাগইনের অনুমতি মুছে দিন। ইমপোর্ট করা তথ্য থেকে যায়।',
        rollbackTitle: 'ফেরত যাওয়ার এক্সপোর্ট',
        latestRun: 'সর্বশেষ কাজ',
        earlierRuns: 'কাজ বেছে নিন',
        notRun: 'এখনো চালানো হয়নি।',
        running: 'কাজ চলছে… এই পাতা ছেড়ে গেলেও পেছনে চলতে থাকবে।',
        next: 'পরের ধাপ',
        back: 'আগের ধাপ',
        ordersTitle: 'WooCommerce অর্ডার',
        ordersIntro:
            'পুরোনো WooCommerce স্টোর থেকে আনা অর্ডার। এগুলো ইতিহাস হিসেবে রাখা: আগের মোট টাকা থাকে, স্টক বদলায় না, মেসেজও যায় না। নতুন অর্ডার "সব অর্ডার"-এ দেখাবে।',
        ordersEmpty: 'WooCommerce থেকে কোনো অর্ডার ইমপোর্ট করা হয়নি।',
        ordersBanner: (count: string) => `পুরোনো WooCommerce স্টোরের ${count}টি অর্ডার আলাদা করে রাখা আছে।`,
        ordersBannerLink: 'WooCommerce অর্ডার দেখুন',
        customer: 'কাস্টমার',
        orderNumber: 'অর্ডার',
        date: 'তারিখ',
    },
    title: 'WooCommerce মাইগ্রেশন',
    intro: 'পুরোনো স্টোরের কপি যুক্ত করুন, ড্রাই রানের রিপোর্ট দেখুন, তারপর ইমপোর্ট করুন। শেষ সিঙ্কের সময় পুরোনো চেকআউট বন্ধ রাখুন।',
    source: 'পুরোনো স্টোর',
    url: 'WooCommerce স্টোরের ঠিকানা (HTTPS)',
    key: 'কনজিউমার কী (শুধু পড়ার অনুমতি)',
    secret: 'কনজিউমার সিক্রেট',
    hosts: 'ছবির বাড়তি হোস্ট, কমা দিয়ে আলাদা করুন',
    tax: 'পুরোনো ক্যাটালগের দামে কর অন্তর্ভুক্ত',
    weight: 'পুরোনো স্টোরের ওজনের একক',
    connect: 'যুক্ত করুন / কী বদলান',
    connected: 'স্টোর যুক্ত হয়েছে। কী এনক্রিপ্ট করে রাখা হয়েছে।',
    select: 'পুরোনো স্টোর বেছে নিন',
    dryRun: 'ড্রাই রান করুন',
    import: 'যাচাই করা তথ্য ইমপোর্ট করুন',
    catchUp: 'বদলানো তথ্য সিঙ্ক করুন',
    acknowledge: 'ড্রাই রানের সমস্যাগুলো দেখেছি এবং বাদ পড়া তথ্যের তালিকা মেনে নিচ্ছি।',
    resume: 'থেমে যাওয়া কাজ আবার চালান',
    complete: 'শেষ করে সেভ করা কী মুছুন',
    completeBody:
        'সেভ করা WooCommerce কী মুছে যাবে। WooCommerce থেকেও শুধু পড়ার অনুমতির কী বাতিল করুন। ইমপোর্ট করা তথ্য ও রিপোর্ট থাকবে।',
    runs: 'মাইগ্রেশনের কাজগুলো',
    counts: 'অগ্রগতি',
    issues: 'সমস্যা (শেষ ২০০টি)',
    verification: 'হিসাব যাচাই',
    csv: 'CSV রিপোর্ট নামান',
    html: 'HTML রিপোর্ট নামান',
    credentialsRemoved: 'সেভ করা কী মুছে গেছে। WooCommerce থেকেও বাতিল করুন।',
    noRuns: 'এখনো কোনো কাজ শুরু হয়নি।',
    failed: 'কাজটি যাচাই করা দরকার। কোড দেখে পুরোনো স্টোর বা সেটিংস ঠিক করে আবার চালান।',
    status: 'অবস্থা',
    mode: 'ধরন',
    resource: 'তথ্যের ধরন',
    processed: 'যতগুলো তথ্য দেখা হয়েছে',
    code: 'সমস্যার কোড',
    severity: 'গুরুত্ব',
    sourceId: 'পুরোনো রেকর্ড',
    legacyTitle: 'WooCommerce অর্ডারের ইতিহাস',
    legacyIntro: 'পুরোনো অর্ডারের মোট টাকা আগের মতোই থাকে। এগুলো স্টক সংরক্ষণ বা নোটিফিকেশন পাঠায় না।',
    search: 'অর্ডার নম্বর, ফোনের সংখ্যা বা নাম দিয়ে খুঁজুন',
    previous: 'আগের',
    next: 'পরের',
    details: 'বিস্তারিত',
    number: 'পুরোনো অর্ডার নম্বর',
    total: 'পুরোনো মোট টাকা',
    currency: 'মুদ্রা',
    empty: 'পুরোনো অর্ডার পাওয়া যায়নি।',
    close: 'বিস্তারিত বন্ধ করুন',
    snapshot: 'পুরোনো অর্ডারের সংরক্ষিত তথ্য',
    open: 'যাচাই করা COD অর্ডার রূপান্তর করুন',
    frozen: 'পুরোনো চেকআউট বন্ধ এবং এই অর্ডার সেখান থেকে পাঠানো হবে না।',
    reduced: 'ইমপোর্ট করা স্টক থেকে WooCommerce এই অর্ডারের পণ্য আগেই বাদ দিয়েছে।',
    conversionHint:
        'রূপান্তরের জন্য সাম্প্রতিক, টাকা না পাওয়া COD অর্ডার, যাচাই করা ঠিকানা এবং হুবহু একই মোট টাকা দরকার। আবার চাপলে একই নতুন অর্ডার পাবেন।',
    converted: 'নতুন অর্ডার তৈরি হয়েছে। অর্ডার তালিকা থেকে কাজ চালান।',
    active: 'নতুন অর্ডার খুলুন',
    states: {
        queued: 'অপেক্ষায়',
        running: 'চলছে',
        completed: 'সম্পন্ন',
        needsReview: 'যাচাই দরকার',
        failed: 'থেমে গেছে',
    },
    modes: { dryRun: 'ড্রাই রান', import: 'ইমপোর্ট', catchUp: 'শেষ পরিবর্তন সিঙ্ক' },
    stages: {
        coupons: 'কুপন',
        reviews: 'রিভিউ',
        settings: 'পুরোনো স্টোরের সেটিংস',
        categories: 'ক্যাটাগরি',
        tags: 'ট্যাগ',
        products: 'পণ্য',
        customers: 'কাস্টমার',
        orders: 'অর্ডার',
        written: 'লেখা হয়েছে',
        unchanged: 'একই আছে',
        dryRun: 'যাচাই হয়েছে',
        failed: 'যেগুলো নেওয়া যায়নি',
        images: 'ছবি',
        imageHosts: 'ছবির হোস্ট',
        guestCustomers: 'অ্যাকাউন্ট ছাড়া কাস্টমার',
        variants: 'ভেরিয়েশন',
    },

    runStopped: 'কাজটি থেমে গেছে।',
    report: {
        dryRun: 'ড্রাই রান: এখনো কিছু সেভ হয়নি। পুরোনো স্টোরে যা পাওয়া গেছে তার হিসাব নিচে।',
        matches: 'যা যাচাই করা হয়েছে সব পুরোনো স্টোরের সঙ্গে মিলেছে।',
        differs: 'কিছু হিসাব পুরোনো স্টোরের সঙ্গে মেলেনি। “মেলেনি” লেখা সারিগুলো দেখুন।',
        recordsFound: 'যত রেকর্ড পাওয়া গেছে',
        estimatedTime: 'ইমপোর্টে আনুমানিক সময়',
        estimateHint:
            'রেকর্ডের সংখ্যা দেখে মোটামুটি হিসাব। পুরোনো হোস্ট ধীর হলে বা ছবি বেশি থাকলে বেশি সময় লাগবে।',
        counts: 'ধরন অনুযায়ী রেকর্ড',
        kind: 'ধরন',
        oldStore: 'পুরোনো স্টোর',
        read: 'পড়া হয়েছে',
        imported: 'ইমপোর্ট হয়েছে',
        skipped: 'বাদ',
        result: 'ফল',
        same: 'মিলেছে',
        different: 'মেলেনি',
        totals: 'মাস অনুযায়ী অর্ডারের মোট টাকা',
        totalsSummary: (months, different) =>
            `${n(months)} মাস` + (different ? `, ${n(different)}টি মেলেনি` : ''),
        month: 'মাস',
        unknownMonth: 'তারিখ নেই',
        samples: 'নমুনা অর্ডার',
        samplesResult: (passed, total) => `${n(total)}টি নমুনা অর্ডারের ${n(passed)}টি হুবহু মিলেছে।`,
        sampleDiffers: (order, fields) => `অর্ডার #${order}-এ মেলেনি: ${fields}।`,
        sampleMissing: order => `অর্ডার #${order} এখানে পাওয়া যায়নি।`,
        sampleFields: {
            total: 'মোট টাকা',
            currency: 'মুদ্রা',
            status: 'অবস্থা',
            number: 'অর্ডার নম্বর',
            lines: 'পণ্য',
            notes: 'নোট',
            refunds: 'রিফান্ড',
        },
        images: 'ছবি',
        imagesCopied: count => `${n(count)}টি ছবি কপি হয়েছে`,
        imagesReady: count => `${n(count)}টি দেখানোর জন্য প্রস্তুত`,
        imagesFailed: count => `${n(count)}টি কপি করা যায়নি`,
        technical: 'কারিগরি তথ্য (Ecomm BD সাপোর্টের জন্য)',
    },
    duration: {
        underMinute: 'এক মিনিটের কম',
        minutes: minutes => `প্রায় ${n(minutes)} মিনিট`,
        hours: (hours, minutes) => `প্রায় ${n(hours)} ঘণ্টা${minutes ? ` ${n(minutes)} মিনিট` : ''}`,
    },
    months: [
        'জানুয়ারি',
        'ফেব্রুয়ারি',
        'মার্চ',
        'এপ্রিল',
        'মে',
        'জুন',
        'জুলাই',
        'আগস্ট',
        'সেপ্টেম্বর',
        'অক্টোবর',
        'নভেম্বর',
        'ডিসেম্বর',
    ],

    noIssues: 'কোনো সমস্যা পাওয়া যায়নি।',
    severities: { error: 'ঠিক করতে হবে', warning: 'দেখে নিন' },
    affected: count => `${n(count)}টি রেকর্ড`,
    more: count => `এবং আরও ${n(count)}টি`,
    codeLabel: code => `কোড: ${code}`,
    unknownCode: code => `কিছু যাচাই করা দরকার (কোড ${code})। বারবার হলে এই কোডটি Ecomm BD সাপোর্টকে পাঠান।`,
    sourceHttp: status =>
        `পুরোনো স্টোর ${n(status)} ত্রুটি দিয়েছে। সাইট ও এর WooCommerce API ঠিকমতো চলছে কি না দেখুন।`,
    codes: {
        SOURCE_COUNT_MISMATCH:
            'পুরোনো স্টোর যত রেকর্ডের কথা বলেছে, পড়া হয়েছে তার চেয়ে কম বা বেশি। আবার চালান; বারবার হলে ইমপোর্টের সময় তথ্য বদলাচ্ছে কি না দেখুন।',
        SOURCE_RECORD_UNREADABLE:
            'পুরোনো স্টোর থেকে এই রেকর্ডের কিছু অংশ (ভেরিয়েশন, নোট বা রিফান্ড) পড়া যায়নি, তাই বাদ গেছে। পরের সিঙ্কে আবার পড়া হবে।',
        UNSUPPORTED_PRODUCT_TYPE:
            'এই ধরনের পণ্য (গ্রুপড, এক্সটার্নাল, ভার্চুয়াল বা ডাউনলোড করার মতো) ইমপোর্ট হয় না। এখনো বিক্রি করলে হাতে যোগ করুন।',
        BUILDER_SHORTCODES:
            'বিবরণ থেকে পেজ-বিল্ডারের শর্টকোড বাদ দেওয়া হয়েছে। বিবরণ ঠিকমতো পড়া যায় কি না দেখুন।',
        SHARED_PARENT_STOCK_REQUIRES_REVIEW:
            'স্টক মূল পণ্যে রাখা, প্রতিটি ভেরিয়েশনে নয়। প্রতিটি ভেরিয়েশনের স্টক দিন, তারপর পণ্যটি চালু করুন।',
        VARIATION_WITHOUT_PRICE_SKIPPED:
            'একটি ভেরিয়েশনের দাম নেই, তাই বাদ গেছে। WooCommerce-এ দাম দিয়ে আবার চালান, অথবা এখানে যোগ করুন।',
        IMAGE_HOST_NOT_APPROVED:
            'ছবিগুলো এমন সাইট থেকে আসছে যা ছবির হোস্টের তালিকায় নেই, তাই বাদ যাচ্ছে। স্টোর যুক্ত করার সময় এই হোস্ট যোগ করুন।',
        INVALID_IMAGE_URL: 'ছবির লিংক ভাঙা, তাই ছবিটি বাদ গেছে।',
        IMAGE_FAILED_OR_UNAPPROVED:
            'একটি ছবি কপি করা যায়নি। পুরোনো স্টোরে ছবিটি খোলে কি না এবং হোস্ট তালিকায় আছে কি না দেখুন।',
        SOURCE_CONTENT_LIMIT_REQUIRES_REVIEW:
            'এই পণ্যে ১০০টির বেশি ছবি বা অনেক বড় বিবরণ আছে। WooCommerce-এ ছোট করে আবার চালান।',
        DIMENSIONS_RETAINED_IN_MAPPING:
            'প্যাকেটের মাপ (দৈর্ঘ্য, প্রস্থ, উচ্চতা) রেখে দেওয়া হয়েছে। ডেলিভারি চার্জে এটি ব্যবহার হয় না।',
        HIDDEN_PRODUCT_IMPORTED_DISABLED:
            'পুরোনো স্টোরে পণ্যটি লুকানো ছিল, তাই বন্ধ অবস্থায় ইমপোর্ট হয়েছে।',
        DUPLICATE_SKU_IN_SOURCE: 'পুরোনো স্টোরে আরেকটি পণ্যের একই SKU আছে। প্রতিটি পণ্যকে আলাদা SKU দিন।',
        DUPLICATE_SKU_SUFFIXED:
            'এই SKU এখানে আগেই ব্যবহার হয়েছে, তাই শেষে কিছু যোগ করা হয়েছে। লেবেল প্রিন্টের আগে SKU দেখে নিন।',
        TAX_EXCLUSIVE_PRICE_REQUIRES_REVIEW:
            'পুরোনো দামে কর ধরা নেই। দাম যাচাই না করা পর্যন্ত পণ্যটি বন্ধ থাকবে।',
        WILDCARD_VARIATION_REQUIRES_REVIEW:
            'একটি ভেরিয়েশনে কোনো অপশন “যেকোনো” রাখা। WooCommerce-এ প্রতিটি ভেরিয়েশন আলাদা করে বানিয়ে আবার চালান।',
        SALE_SCHEDULE_REQUIRES_REVIEW:
            'ছাড়ের দামের শুরু বা শেষের তারিখ ছিল, যা ইমপোর্ট হয়নি। এখানে ছাড়ের দাম দেখে নিন।',
        CATEGORY_PARENT_MISSING:
            'এই ক্যাটাগরির প্যারেন্ট ইমপোর্ট হয়নি, তাই একে সবার উপরের স্তরে রাখা হয়েছে। এখানে ঠিক ক্যাটাগরির নিচে সরিয়ে নিন।',
        CATEGORY_CYCLE:
            'দুটি ক্যাটাগরি একে অপরের প্যারেন্ট হিসেবে রাখা। WooCommerce-এ ক্যাটাগরির ক্রম ঠিক করুন।',
        ADDRESS_NEEDS_REVIEW: 'জেলা বা থানা মেলানো যায়নি। ডেলিভারির আগে ঠিকানা যাচাই করুন।',
        PHONE_MISSING_OR_AMBIGUOUS: 'একটি সঠিক বাংলাদেশি মোবাইল নম্বর পাওয়া যায়নি। হাতে ফোন নম্বর দিন।',
        FOREIGN_CURRENCY_PRESERVED: 'এই অর্ডার টাকায় ছিল না। অর্ডারের ইতিহাসে আগের মুদ্রাতেই রাখা হয়েছে।',
        MERGED_CUSTOMER_PROFILE_NOT_OVERWRITTEN:
            'এই কাস্টমার এখানে আগে থেকেই ছিলেন, তাই তাঁর প্রোফাইল বদলানো হয়নি।',
        CUSTOMER_IDENTITY_CONFLICT:
            'ফোন নম্বর আর ইমেইল এখানে দুইজন আলাদা কাস্টমারের। এটি কোন কাস্টমার তা যাচাই করুন।',
        EMAIL_HAS_DIFFERENT_PHONE:
            'এই ইমেইলের কাস্টমারের এখানে অন্য ফোন নম্বর আছে, তাই তাঁদের আলাদা রাখা হয়েছে।',
        LEGACY_LOGIN_IDENTITY_REFUSED:
            'অ্যাকাউন্ট নিরাপদে মেলানো যায়নি, তাই এই কাস্টমারের পুরোনো পাসওয়ার্ড আনা হয়নি।',
        LEGACY_PASSWORD_FORMAT_REQUIRES_RESET:
            'এই কাস্টমারের পুরোনো পাসওয়ার্ড এমনভাবে রাখা যা যাচাই করা যায় না। তাঁকে নতুন পাসওয়ার্ড দিতে হবে।',
        LEGACY_LOGIN_IDENTIFIER_CONFLICT:
            'এখানে আরেকটি অ্যাকাউন্ট এই ইমেইল ব্যবহার করছে, তাই পুরোনো লগইন আনা হয়নি।',
        COUPON_CONSTRAINT_REQUIRES_REVIEW:
            'এই কুপনে এমন নিয়ম আছে যা কপি করা যায় না (পণ্যের সীমা, ফ্রি ডেলিভারি ইত্যাদি)। এখানে নতুন করে বানান।',
        COUPON_USED_UP_IMPORTED_DISABLED:
            'এই কুপন আর ব্যবহারের সুযোগ ছিল না, তাই বন্ধ অবস্থায় ইমপোর্ট হয়েছে।',
        COUPON_PER_CUSTOMER_HISTORY_NOT_KEPT:
            'এই কুপনে কাস্টমারপ্রতি সীমা আছে, কিন্তু পুরোনো স্টোরে আগের ব্যবহার আনা যায় না: কাস্টমাররা সীমা পর্যন্ত আবার ব্যবহার করতে পারবেন।',
        REDIRECT_RULE_REQUIRES_REVIEW:
            'একটি পুরোনো ঠিকানা নিজে থেকে রিডাইরেক্ট করা যায়নি। “পুরোনো ঠিকানার নিয়ম” অংশে হাতে নিয়ম যোগ করুন।',
        PRIMARY_LANGUAGE_ONLY_REVIEW:
            'পুরোনো স্টোরে অনুবাদের প্লাগইন আছে। শুধু মূল ভাষার তথ্য ইমপোর্ট হয়েছে।',
        SUBSCRIPTIONS_BOOKINGS_NOT_SUPPORTED: 'সাবস্ক্রিপশন ও বুকিং চলে না, তাই ইমপোর্ট হয়নি।',

        IMPORT_RECORD_FAILED: 'এই রেকর্ড ইমপোর্ট করা যায়নি। WooCommerce-এ দেখে আবার চালান।',
        IMPORT_LEASE_LOST: 'কাজটি মাঝপথে থেমেছে (অন্য প্রসেস নিয়ে নিয়েছে বা সময় শেষ)। আবার চালান।',
        QUEUE_UNAVAILABLE: 'ইমপোর্ট শুরু করা যায়নি। ব্যাকগ্রাউন্ড ওয়ার্কার চালু হলে আবার চালান।',
        LEGACY_USER_CREATE_FAILED: 'কাস্টমারের লগইন অ্যাকাউন্ট তৈরি করা যায়নি।',
        COUPON_DISABLE_FAILED: 'যাচাই দরকার এমন একটি কুপন বন্ধ করা যায়নি। হাতে বন্ধ করুন।',
        INVALID_COUPON_AMOUNT: 'কুপনের পরিমাণ সঠিক নয় (শূন্য, ঋণাত্মক, ১০০%-এর বেশি বা পূর্ণ টাকায় নয়)।',
        COUPON_IMPORT_FAILED: 'কুপন সেভ করা যায়নি। কোডটি হয়তো এখানে আগেই ব্যবহার হয়েছে।',
        CATEGORY_SLUG_CONFLICT: 'একই লিংক নামের ক্যাটাগরি এখানে আগেই আছে। একটির নাম বদলান।',
        PRODUCT_SLUG_CONFLICT: 'একই লিংক নামের পণ্য এখানে আগেই আছে। একটির নাম বদলান।',
        SOURCE_CATALOG_CURRENCY_NOT_BDT:
            'পুরোনো স্টোরের মুদ্রা টাকা নয়, তাই পণ্য ইমপোর্ট করা যায় না। কপিতে মুদ্রা BDT করুন।',
        IMPORTED_FACET_MISSING:
            'ইমপোর্টে তৈরি পণ্যের অপশনের তালিকা (যেমন সাইজ) এখানে মুছে ফেলা হয়েছে। আবার ইমপোর্ট চালান।',
        IMAGE_DOWNLOAD_FAILED: 'পুরোনো স্টোর থেকে ছবি নামানো যায়নি।',
        IMAGE_REJECTED: 'ছবিটি নেওয়া হয়নি: ফাইলের ধরন চলে না বা ফাইল বেশি বড়।',
        VARIABLE_PRODUCT_HAS_NO_VARIATIONS:
            'এই পণ্যে অপশন আছে কিন্তু কোনো ভেরিয়েশন নেই। WooCommerce-এ ভেরিয়েশন যোগ করুন বা সাধারণ পণ্য করুন।',
        INVALID_WEIGHT: 'ওজন সঠিক সংখ্যা নয়।',
        DESTINATION_HAS_ALLOCATED_STOCK:
            'এখানে চালু অর্ডারের জন্য এই পণ্যের স্টক রাখা আছে, তাই স্টক বদলানো হয়নি।',
        MAPPED_CUSTOMER_IDENTITY_CHANGED:
            'শেষ ইমপোর্টের পর পুরোনো স্টোরে এই কাস্টমারের ফোন নম্বর বা ইমেইল বদলেছে। এখানে হাতে বদলে নিন।',
        OPEN_ORDER_ALREADY_CONVERTED: 'এই অর্ডার আগেই নতুন অর্ডারে রূপান্তর হয়েছে, তাই আর বদলানো হয়নি।',
        ORDER_NUMBER_RANGE_REQUIRES_REVIEW:
            'পুরোনো অর্ডার নম্বর নতুন স্টোরের চেয়ে অনেক বড়। চালু করার আগে Ecomm BD সাপোর্টে যোগাযোগ করুন।',
        HTTPS_SOURCE_REQUIRED: 'স্টোরের ঠিকানা https:// দিয়ে শুরু হতে হবে।',
        INVALID_SOURCE_RESOURCE:
            'ইমপোর্ট পুরোনো স্টোরের কাছে অজানা ধরনের তথ্য চেয়েছে। Ecomm BD সাপোর্টে যোগাযোগ করুন।',
        INVALID_SOURCE_ENDPOINT:
            'ইমপোর্ট পুরোনো স্টোরের অপ্রত্যাশিত ঠিকানায় গেছে। Ecomm BD সাপোর্টে যোগাযোগ করুন।',
        INVALID_SOURCE_RESPONSE:
            'পুরোনো স্টোরের উত্তর পড়া যায়নি। কোনো প্লাগইন হয়তো WooCommerce API বদলাচ্ছে।',
        SOURCE_AUTH_OR_FIREWALL:
            'পুরোনো স্টোর API কী মেনে নেয়নি, অথবা কোনো নিরাপত্তা প্লাগইন (যেমন Wordfence) অনুরোধ আটকে দিয়েছে। শুধু পড়ার অনুমতির কী দেখুন, অথবা এর বদলে WordPress হেল্পার প্লাগইন ব্যবহার করুন।',
        SOURCE_TIMEOUT: 'পুরোনো স্টোর উত্তর দিতে বেশি সময় নিয়েছে। কম ব্যস্ত সময়ে আবার চালান।',
        SOURCE_NETWORK: 'পুরোনো স্টোরে পৌঁছানো যায়নি। সাইটটি চালু আছে কি না দেখে আবার চালান।',
        SOURCE_BLOCKED: 'পুরোনো স্টোরের ঠিকানা একটি ব্যক্তিগত নেটওয়ার্কের, তাই আটকানো হয়েছে।',
        SOURCE_TOO_LARGE: 'পুরোনো স্টোর একবারে অনেক বেশি তথ্য পাঠিয়েছে।',
        SOURCE_TOO_MANY_REDIRECTS: 'পুরোনো স্টোর বারবার অন্য ঠিকানায় পাঠাচ্ছে। ঠিকানা ও HTTPS সেটিং দেখুন।',
        SOURCE_CIRCUIT_OPEN: 'পুরোনো স্টোর পরপর কয়েকবার সাড়া দেয়নি। কয়েক মিনিট পরে আবার চালান।',
        SOURCE_CHILD_LIMIT: 'একটি পণ্য বা অর্ডারে ইমপোর্টের জন্য অনেক বেশি ভেরিয়েশন, নোট বা রিফান্ড আছে।',
        INVALID_RECORD: 'পুরোনো স্টোর এমন একটি রেকর্ড পাঠিয়েছে যা পড়া যায়নি।',
        INVALID_SOURCE_ID: 'পুরোনো স্টোরের একটি রেকর্ডের সঠিক আইডি নেই।',
        DECIMAL_OUT_OF_RANGE: 'একটি পরিমাণ অনেক বড়।',
        INVALID_DECIMAL: 'একটি পরিমাণ সঠিক সংখ্যা নয়।',
        CATALOG_PRICE_NOT_WHOLE_TAKA: 'দামে পয়সা আছে বা দাম অনেক বড়। দাম পূর্ণ টাকায় হতে হবে।',
        INVALID_GMT_DATE: 'একটি তারিখ পড়া যায়নি।',

        INVALID_LOCAL_PATH: 'পুরোনো ঠিকানাটি সঠিক নয়। এটি / দিয়ে শুরু হতে হবে এবং একই সাইটের হতে হবে।',
        RESERVED_REDIRECT_PATH: 'এই ঠিকানা নতুন স্টোর নিজেই ব্যবহার করে, তাই এখানে রিডাইরেক্ট করা যায় না।',
        SITEMAP_HOST_CHANGED: 'সাইটম্যাপটি অন্য ওয়েবসাইটের দিকে যাচ্ছে। পুরোনো স্টোরের নিজের সাইটম্যাপ দিন।',
        SITEMAP_READ_FAILED: 'সাইটম্যাপ খোলা যায়নি। ঠিকানাটি দেখুন।',
        UNSAFE_SITEMAP:
            'নিরাপত্তার জন্য এই সাইটম্যাপের কিছু অংশ পড়া হয় না। WordPress বা SEO প্লাগইনের সাধারণ সাইটম্যাপ দিন।',
        EXPORT_TOO_LARGE: 'এই সময়ের মধ্যে ৫,০০০-এর বেশি অর্ডার হয়েছে। আরও পরের শুরুর সময় বেছে নিন।',
    },

    wooStatuses: {
        pending: 'পেমেন্টের অপেক্ষায়',
        processing: 'প্রসেসিং',
        'on-hold': 'হোল্ডে আছে',
        completed: 'সম্পন্ন',
        cancelled: 'বাতিল',
        refunded: 'রিফান্ড হয়েছে',
        failed: 'ব্যর্থ',
        'checkout-draft': 'ড্রাফট',
        draft: 'ড্রাফট',
        trash: 'ট্র্যাশে',
    },

    placedAt: 'অর্ডারের তারিখ',
    orderStatus: 'WooCommerce-এ অবস্থা',
    payment: 'পেমেন্ট',
    cod: 'ক্যাশ অন ডেলিভারি',
    items: 'পণ্য',
    deliveryCharge: 'ডেলিভারি চার্জ',
    discount: 'ছাড়',
    refunded: 'রিফান্ড',
    customerNote: 'কাস্টমারের নোট',
    address: 'ঠিকানা',
    billingAddress: 'বিলের ঠিকানা',
    deliveryAddress: 'ডেলিভারির ঠিকানা',
    name: 'নাম',
    phone: 'ফোন নম্বর',
    district: 'জেলা',
    convertedTag: 'নতুন অর্ডারে রূপান্তর হয়েছে',

    gone: 'আর নেই (410)',
    visits: count => `${n(count)} বার খোঁজা হয়েছে`,
    editedByStaff: 'স্টাফ বদলেছেন',
    editedByStaffHint: 'এখানে সেভ করা নিয়ম পরের ইমপোর্টে বদলায় না।',
    deleteRedirectLabel: path => `${path} রিডাইরেক্ট মুছে ফেলুন`,
    deleteRedirectTitle: 'এই রিডাইরেক্ট মুছবেন?',
    deleteRedirectBody: path =>
        `নতুন নিয়ম না দেওয়া পর্যন্ত ${path} ঠিকানায় এলে “পাতা পাওয়া যায়নি” দেখাবে।`,
    noRedirects: 'এখনো পুরোনো ঠিকানার কোনো নিয়ম নেই।',
    missingHint:
        'ভিজিটররা পুরোনো যেসব ঠিকানা খুঁজেছেন কিন্তু এখানে পাতা নেই। বেশি খোঁজা ঠিকানাগুলো রিডাইরেক্ট করুন।',
    noMisses: 'এখনো না পাওয়া কোনো ঠিকানা জমা হয়নি।',
    redirectMiss: 'রিডাইরেক্ট',
    redirectMissLabel: path => `${path} রিডাইরেক্ট করুন`,
    hasRule: 'নিয়ম সেভ আছে',

    crawlPassed: count => `যাচাই করা ${n(count)}টি ঠিকানার সবগুলো নতুন স্টোরে খোলে।`,
    crawlFailed: (failed, total) =>
        `পুরোনো ${n(total)}টি ঠিকানার ${n(failed)}টি ঠিকমতো খোলে না। এগুলোর রিডাইরেক্ট দিয়ে আবার যাচাই করুন।`,
    crawlEmpty: 'এই সাইটম্যাপে কোনো ঠিকানা পাওয়া যায়নি। সাইটম্যাপের ঠিকানা দেখুন।',
    crawlTruncated:
        'যাচাই আগেই থেমেছে: ২০টি সাইটম্যাপ ফাইল থেকে সর্বোচ্চ ২,০০০ ঠিকানা পড়া হয়। এগুলো ঠিক করে আবার যাচাই করুন।',
    crawlCheckedAt: date => `যাচাই: ${date}`,
    failingUrls: 'যে ঠিকানাগুলো ঠিক করতে হবে',
    crawlStatus: {
        noAnswer: 'কোনো উত্তর নেই',
        notFound: 'পাওয়া যায়নি (404)',
        gone: 'আর নেই (410)',
        redirect: status => `একাধিকবার রিডাইরেক্ট হয় (${status})`,
        server: status => `সার্ভারের ত্রুটি (${status})`,
        other: status => `ত্রুটি ${status}`,
    },

    pricesIncludedTax: 'পুরোনো স্টোরের দামে কর অন্তর্ভুক্ত',
    yes: 'হ্যাঁ',
    no: 'না',
    shippingZones: 'ডেলিভারি এলাকা (শিপিং জোন)',
    noShippingZones: 'কোনো শিপিং জোন সেট করা ছিল না।',
    zoneNoLocations: 'কোনো এলাকা দেওয়া নেই',
    locationTypes: { country: 'দেশ', state: 'জেলা', postcode: 'পোস্ট কোড', continent: 'মহাদেশ' },
    permalinks: 'পুরোনো লিংকের ধরন',
    permalinkKinds: {
        product_base: 'পণ্যের লিংক',
        category_base: 'ক্যাটাগরির লিংক',
        tag_base: 'ট্যাগের লিংক',
        attribute_base: 'অ্যাট্রিবিউটের লিংক',
    },
    permalinkDefault: 'WooCommerce-এর নিজের ধরন',
    importedRedirects: count => `পুরোনো স্টোরে ${n(count)}টি রিডাইরেক্ট নিয়ম পাওয়া গেছে।`,
};
