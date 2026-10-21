# M3 · Storefront

> Phases 12–17 · [Roadmap overview](README.md)
> **Exit criteria:** a shopper completes a COD checkout on a cached, Bangla/English storefront within the performance budget, and merchants build pages and sales pages without code.

The storefront is `apps/storefront`: Astro server-side rendering with Preact islands ([architecture.md](../architecture.md), Decision 2). The guiding rule: **zero JavaScript unless the shopper needs to interact**, and every page is cacheable unless it's personal.

---

## Phase 12 — Storefront foundation

| | |
|---|---|
| Milestone | M3 |
| Delivers | Storefront in Bangla and English (P0); SEO title/description, clean URLs, sitemap (P0); static pages and menus (P0); WhatsApp/Messenger/call button (P0) |
| Depends on | 02, 09 |
| Size | L |

**Goal.** A fast storefront that renders the catalogue and pages in Bangla and English, with SEO done right from the first page.

### Decide at start

- **GraphQL client and typing:** gql.tada or graphql-codegen. Optionally an allowlist (persisted queries), so only the storefront's own queries reach the Shop API from outside.
- **URL scheme.** Recommended: WooCommerce-style URLs as the canonical scheme for **every** store (`/product/{slug}/`, `/product-category/{slug}/`, with a trailing slash). Migrated stores then need no product or category redirects, and one scheme keeps the code simple.
- **Locale URLs:** the default language without a prefix, the second under `/en/` or `/bn/`.

### Build

1. **App setup:**
   - Astro (current major), standalone Node adapter, Preact integration, strict TypeScript
   - health endpoint, graceful shutdown, structured logs
2. **Data layer:**
   - Typed Shop API client calling the core over localhost with keep-alive and timeouts.
   - Errors map to friendly pages.
   - A two-level cache for store settings, menus and collections: in-process LRU plus Redis, both invalidated by tags the core purges (wired fully in phase 17).
3. **Routes:**
   - home, `/product/{slug}/`, `/product-category/{slug}/` (nested categories supported)
   - pages `/{slug}/`, search `/search/`, cart `/cart/`, checkout `/checkout/`, tracking `/track/` and `/t/{token}`
   - account `/account/` (phase 34)
   - 404 and **410** (permanently removed products)
   - trailing-slash redirects (301) and lowercase normalization
4. **Slug history** (core plugin): when a product, category or page slug changes, the old slug 301-redirects to the new one.
5. **i18n:**
   - UI strings in Bangla and English with plurals
   - language switcher, `hreflang` alternates
   - Bangla digits for prices and dates when the store setting is on
   - fallback to the default language when content is missing
6. **Layout:**
   - header: logo, menu, search box, cart button (the cart count loads client-side in phase 14, so pages stay cacheable)
   - footer: menus, contact, social links, accepted payment logos
   - **floating WhatsApp/Messenger/call buttons** from store settings, built as plain links with no third-party widget script
7. **SEO:**
   - title and meta description from product SEO fields (custom fields added here), with sensible fallbacks
   - canonical URLs, Open Graph and Twitter cards
   - **JSON-LD:** Organization, WebSite with SearchAction, Product with Offer (BDT price, availability, condition), BreadcrumbList
   - sitemaps: an index plus products, categories and pages, with `lastmod`
   - `robots.txt`: disallow cart, checkout, account, search and filter URLs
   - `noindex` on search results and filtered pages
8. **Image component:**
   - uses phase 09's WebP sizes with `srcset`, `sizes`, width and height
   - lazy loading below the fold
   - preload plus `fetchpriority="high"` for the main product image
9. **Content plugin** for simple pages and menus (Vendure has neither):
   - **Page:** title, slug, rich text body (sanitized), SEO fields, per language. Policy pages are prefilled from phase 02.
   - **Menu:** a tree of links to a page, category, product or URL; header and footer menus.
   - Simple Dashboard editors for both. Section-based pages come in phase 15.
10. **Security headers:** CSP (self plus each store's allowed analytics domains), `nosniff`, Referrer-Policy, Permissions-Policy. HSTS is added at Nginx in phase 23.
11. **Rich text sanitizing** (server-side allowlist) for product descriptions and pages, on save and on render. This matters even though staff write the content: an admin account can be compromised, and imported WooCommerce HTML can contain anything.
12. **Maintenance and suspended pages** (used in phases 24 and 39), served when the store is suspended.

### Edge cases

- **Product display:**
  - A product with no images: neutral placeholder, and the JSON-LD omits `image`, not an empty value.
  - All variants out of stock: shown as "Out of stock" and still indexable, with the Offer's availability `OutOfStock`.
  - Price ranges across variants (`৳500 – ৳900`) and sale prices (strike-through).
  - Very long product names and descriptions: layout holds.
- **URLs and slugs:**
  - A deleted product returns 410 with suggestions; a disabled product returns 404.
  - Bangla slugs (from migration) are percent-encoded and NFC-normalized, so two encodings of the same slug resolve to one canonical URL.
  - Changed slug: 301 through slug history, no redirect chains (A→B→C collapses to A→C).
- **Content:**
  - Imported WooCommerce HTML with leftover shortcodes (`[vc_row]`): stripped by the sanitizer, and listed in the migration report (phase 21).
  - Missing Bangla translation: falls back to English, with `hreflang` still correct.
- **Store state:**
  - The core is unreachable: friendly error page with a 503. Varnish later serves stale pages in this case (phase 17).
  - A suspended store: maintenance page, `noindex`, 503 with `Retry-After`.

### Security

- No secrets in client bundles: public environment variables only, enforced by a CI check on built bundles.
- `set:html` only with sanitized content; a lint rule enforces it.
- Server-side fetches go only to the local core; no URL comes from user input, so there's no SSRF.
- JSON-LD output escapes `</script>` sequences.

### Tests

- Playwright in Bangla and English:
  - home, category, product, page, 404, 410, trailing-slash and slug-change redirects
  - language switching and `hreflang`
- SEO snapshot tests (titles, canonicals, OG tags); JSON-LD validated against schema.org expectations; sitemap XML validated.
- Unit: URL and slug utilities, including Bangla encodings.
- Lighthouse run (local, throttled mobile) recorded in the PR. CI enforcement starts in phase 17.

### Done when

- [x] A store with 50 products renders home, category, product and policy pages in Bangla and English. (Playwright `storefront.spec.ts` with a 50-product seed, desktop and phone.)
- [x] Product pages ship **no JavaScript** before the cart island exists. (No `<script>` except JSON-LD, checked on every page type.)
- [x] Lighthouse mobile performance ≥ 95 on a throttled profile. (Lighthouse 13.5, mobile, simulated throttling, 2026-10-21, on the home, product, category and content pages: **100** for performance, accessibility, best practices and SEO; LCP 0.9–1.1 s, CLS 0, TBT 0 ms. The first run found a missing favicon, a missing home description, two colours below 4.5:1 contrast and a skipped heading level; all fixed.)
- [x] JSON-LD and sitemaps validate; old slugs redirect. (JSON-LD shape checked in unit and browser tests; sitemaps parsed as XML in the browser; A→B→C slug changes redirect in one hop; a deleted product answers 410.)

**Notes for phase 05 (Imtiaz):** the SEO fields (`seoTitle`, `seoDescription`, translatable) already exist on products and categories, for the form's "More" part. The storefront's price component shows a struck-through old price when given one: once the old-price field exists, add it to the `PRODUCT` and `ProductCardFields` queries in `apps/storefront/src/lib/queries.ts`. Descriptions can stay plain text: the storefront turns line breaks into paragraphs.

**Not done here:** the core doesn't send cache purges yet (phase 17), so a change shows on the storefront within a minute; there is no "low stock" level, because Vendure's default stock display only says in or out of stock.

### Not in this phase

Search and filters (13), cart and checkout (14), sections and themes (15), Varnish (17).

---

## Phase 13 — Catalog browsing, search and filters

| | |
|---|---|
| Milestone | M3 |
| Delivers | Categories and tags (P0), search and filters (P0) |
| Depends on | 12 |
| Size | M |

**Goal.** Shoppers find products fast, typing in Bangla, English or a misspelling.

### Decide at start

- **Search engine for Bangla.** Test Vendure's default search (PostgreSQL) against a Bangla/English test catalogue. If relevance or partial matching is poor, write a custom search strategy using PostgreSQL full-text search with the `simple` configuration (no stemming, which suits Bangla) plus `pg_trgm` for partial and typo matches. Record the measurements in the ADR.
- **Synonyms** per store (`panjabi` ⇄ `পাঞ্জাবি`, `tshirt` ⇄ `t-shirt` ⇄ `টি-শার্ট`): maintained by the merchant. Automatic Banglish transliteration comes in phase 50.

### Build

1. **Category pages:**
   - collections as categories (nested, ordered), with optional featured products
   - pagination as `?page=N` with a self-referencing canonical
   - sorting: newest, price low→high, price high→low, popular (by delivered orders)
2. **Tags** (facet "tag") shown on products and filterable.
3. **Filters:**
   - price range, product attributes (facets: size, colour…), in-stock only
   - **No JavaScript needed:** filters are plain links and forms, with an island enhancing them when JavaScript loads
   - filter and sort query parameters are normalized (sorted, defaults removed) so caching works (phase 17)
   - filtered pages are `noindex`
4. **Search:**
   - results page with the same filters
   - **suggestions island:** debounced, minimum 2 characters, results cached
   - "did you mean" from trigram similarity
   - synonyms applied at query time
   - stock-aware ordering (out of stock last)
5. **Dashboard:** synonyms editor, and "searches with no results" (last 30 days) so merchants know what shoppers wanted.

### Edge cases

- **Bangla text:**
  - Queries are normalized to NFC (U+09DC `ড়` matches `ড` + `়`).
  - Zero-width joiners inside queries are kept for matching but ignored when they vary.
  - Bangla digits in queries (`৫০০`) match ASCII numbers.
- **Mixed-script queries** (`black পাঞ্জাবি`) match both parts.
- **Query extremes:**
  - One-character queries get no suggestions; full search still runs.
  - Very long queries are capped at 100 characters.
  - Special characters and SQL metacharacters are handled safely (parameterized queries).
- **Result extremes:** huge result sets paginate; no results shows suggestions and popular products.
- **Filter edge cases:**
  - A combination with zero results shows how to remove filters.
  - A price range with min > max is corrected.

### Security

- Rate limits on search and suggestion endpoints per IP and session, since they're the most expensive queries.
- Query length limits, no regex from user input, and parameterized SQL in any custom strategy.

### Tests

- **Relevance:** a Bangla/English corpus of about 200 products with expected top-3 results for 50 queries, including typos, synonyms, mixed scripts and Bangla digits. This is a regression suite.
- Filter combinations; cache-key normalization unit tests.
- Playwright: filters with JavaScript on and off; suggestions keyboard navigation.
- Performance: category and filter pages under 200 ms server time on 500 products.

### Done when

- [x] Searching "পাঞ্জাবি", "panjabi" (synonym) and "punjabi" (typo) all find the product. (End-to-end `bd-search.e2e-spec.ts` on the Bangla and English sites, with phase 05's product form; Playwright `search.spec.ts` on the storefront.)
- [x] Filters work with JavaScript disabled. (Playwright, JavaScript off: the desktop form and the phone panel opened by `#filters`, one 301 to the canonical address, removable chips.)
- [x] The relevance suite passes, and server time is under 200 ms on 500 products. (`search-relevance.spec.ts`: 67 queries on a 200-product Bangla/English catalogue. Playwright on 500+ products, 2026-10-22, local: category and filter pages about 35 ms median, about 110 ms when the core's 3-second catalog cache is cold.)

**Built differently from the plan** (see [decisions.md](../decisions.md)): no PostgreSQL full-text or `pg_trgm`. Matching runs in code over Vendure's search index, because PostgreSQL splits Bangla words differently on glibc (production) and musl (our Docker images). Synonyms and the "searches with no results" list are in our merchant admin (**Online store → Search**), not the Dashboard. The storefront was also restyled to the Shopify-like design standard now in `CLAUDE.md`. Every page now loads a 0.4 KB script (plus Vite's 0.9 KB preload helper) that fetches the suggestions code on the search box's first focus, so phase 12's "no JavaScript" check became the 30 KB product-page budget check.

**Notes for later phases:**
- **Phase 05 (Imtiaz):** tags are Vendure facet values (facet code `tag`). The storefront shows and filters them, but our product form can't set them yet; until it does, support staff add them in the Dashboard.
- **Phase 15:** the filters and suggestions are plain scripts (`src/scripts/`); sections can reuse `Listing.astro` and the `--…` tokens in `global.css`.
- **Phase 17:** filter URLs already have one spelling. Varnish should still sort parameters and drop `utm_*`, `fbclid`, `gclid` and `ttclid` from the key. `/search/suggest/` is cacheable for 60 seconds; `/search/` is `no-store`. Once category pages are cached, cache hits no longer reach the core's rate limit.

**Not done here:** product descriptions aren't searched (long imported HTML would slow every search and blur results; names, variations, SKUs, options, tags and categories are). Search results have no category filter (suggestions show matching categories instead).

### Not in this phase

Banglish transliteration (50), recommendations and "customers also bought" (later).

---

## Phase 14 — Cart, checkout and order tracking

| | |
|---|---|
| Milestone | M3 |
| Delivers | Buy Now and slide-out cart (P0), one-page checkout UI (P0), phone validation UI (P0), payment choice UI (P0), order tracking |
| Depends on | 03, 07, 08, 11, 12 |
| Size | L |

**Goal.** A one-page checkout that's fast on a weak mobile connection, works even when JavaScript fails, and can never create two orders from one tap.

### Build

1. **Cart island** (Preact, within the first-party JS budget):
   - slide-out cart: add, remove, change quantity, stock messages
   - **Buy Now:** add the item, then go to checkout
   - cart count in the header, fetched client-side so pages stay cacheable
   - the Vendure session cookie on the store's own domain (`/shop-api` routed by Nginx), `Secure`, `HttpOnly`, `SameSite=Lax`, with a 30-day lifetime so carts survive
2. **Checkout page** (never cached):
   - **Fields:**
     - name
     - phone (live normalization, operator hint, `inputmode="tel"`)
     - optional alternate phone
     - district → thana selects (searchable, in Bangla and English)
     - address and note
   - **Shipping options:** calculated automatically, plus the "spend ৳X more for free delivery" hint.
   - **Payment options:** COD, advance, manual mobile banking with instructions, and online gateways (phase 18).
   - **Order summary:** totals, COD due.
   - **Place order button:** carries a client-generated **idempotency key**, so the server returns the same order on retries.
   - **Progress capture:** calls `saveCheckoutProgress` (phase 11) once the phone is valid; the consent text sits under the phone field.
   - **OTP step** when the store requires it (phase 11).
   - **Errors:** localized messages from phase 03's typed codes, placed next to the field they concern.
3. **Works without JavaScript:** the checkout form also posts to an Astro server endpoint that runs the same mutations. Flaky networks and old browsers can still order.
4. **Thank-you page:**
   - order number, items, COD due, and next steps ("We'll call you to confirm")
   - store WhatsApp button
   - accessible only to the session that placed the order (Vendure's order-by-code access rules)
5. **Order tracking:**
   - `/track/` takes an order number **and** phone, and shows a status timeline plus the courier tracking link
   - `/t/{token}` (from SMS) shows the same view for that one order
   - Both views show only the first name, district, items and status, never the full address or phone.
6. **Accessibility:** labels, focus order, error announcements, contrast, and keyboard use throughout the checkout.

### Edge cases

- **Cart drift:**
  - Stock changes during checkout: the item becomes unavailable with a clear message, and the cart adjusts.
  - The price changed after the item was added: the new price is shown and must be accepted before placing.
- **Retries and navigation:**
  - Double tap or retry after a timeout: one order (idempotency).
  - Back button after placing: the thank-you page, not an empty checkout.
  - The order was placed from another tab: this tab shows "Order already placed" with a link.
- **Session expired:** the cart persists for 30 days by session; if lost, a polite restart.
- **Input quirks:**
  - Browser autofill mapped through `autocomplete` attributes (`name`, `tel`, `street-address`, `address-level2`).
  - **Bangla keyboards** (Avro, Ridmik, Gboard Bangla): no input masks that break text composition; handle `compositionend` before validating.
- **Network:**
  - Slow 2G/3G: skeleton states, a tiny payload, and nothing blocking the form render.
  - Offline mid-checkout: queue nothing; show "No connection" and keep the form state.

### Security

- **CSRF:** Shop API mutations are sent as JSON (which forces a preflight), same-origin, with `SameSite` cookies. The no-JavaScript form endpoint checks a per-session CSRF token.
- **Rate limits:** place-order per session and per phone; tracking lookups per IP and phone.
- **No order guessing:** tracking needs both order number and phone, every miss gets the same "not found" message, and attempts are rate-limited.
- Tracking tokens are 128-bit random values.
- No personal data in URLs (beyond the token), and none in analytics events.

### Tests

- Playwright matrix: Bangla/English × COD/advance/manual mobile banking × OTP on/off × JavaScript on/off × throttled 3G.
- Double-submit and retry-after-timeout tests produce exactly one order.
- Order-number enumeration on `/track/` hits the rate limit and leaks nothing.
- Accessibility checks (axe) on cart and checkout with no serious violations.
- First-party JS measured on product page and checkout against the budgets.

### Done when

- [ ] On a throttled mid-range Android profile, a shopper completes a COD checkout in under 60 seconds of interaction.
- [ ] First-party JS stays within budget: ≤ 30 KB on product pages, ≤ 45 KB on checkout.
- [ ] Double-submits create one order; checkout works with JavaScript off.
- [ ] Tracking works from the SMS link and by order number + phone.

### Not in this phase

Coupon field (35), customer login and saved addresses (34), online gateway redirects (18).

---

## Phase 15 — Sections, themes and the page editor

| | |
|---|---|
| Milestone | M3 |
| Delivers | Themes with settings (P0); groundwork for the landing page builder (P0) |
| Depends on | 12, 13, 14 |
| Size | XL (split into 15a schema + rendering and 15b editor if needed) |

**Goal.** Merchants design their home page and other pages without code, as easily as with Elementor but with far fewer choices to get wrong, and the result stays within the performance budget.

**Approach.** Fixed sections with good phone defaults, not free-form layout. See [sales-page-builder.md](../research/sales-page-builder.md) for what merchants use in Elementor and what to avoid.

### Decide at start

- **Where sections are stored:** a JSON document per page and language, or shared structure with translated fields. The second is recommended: images and layout are shared, and only text fields are translated.
- **Fonts:** which two self-hosted Bangla-capable fonts are offered besides system fonts (licences must allow web embedding).

### Build

1. **`packages/sections`** (shared by storefront and editor):
   - A typed schema format for sections:
     - id, Bangla/English name, icon
     - fields: text, rich text, image, product, product list, collection, link, colour (from the theme palette), select, toggle, number range
     - repeatable blocks with a maximum count
     - defaults and presets
   - **Schema versions with data migrations:** a release can change a section's fields and migrate stored data safely.
2. **About 20 starter sections** as Astro components:
   - hero, hero slider, product grid, collection list, featured product, image with text, banner
   - rich text, image grid, testimonials, FAQ, trust badges, delivery info, contact, newsletter/WhatsApp CTA, video (lite), divider
   - Each emits its cache tags (the products and collections it shows) for phase 17.
   - **Style options for every section,** deliberately few and preset:
     - background: colour from the palette, a preset or an image
     - light or dark text; spacing S / M / L; narrow or full width; alignment
     - hide on phone or on desktop (no other per-screen settings)
     - anchor ID, so buttons can jump to it
     - one entrance-animation switch, CSS only, off when the visitor prefers reduced motion
3. **Content model** (core plugin `sections`):
   - **`PageLayout`:** type (home, page, landing, product template), slug, section data.
   - **Drafts and history:** draft and published versions, plus the last 20 published versions with one-click restore.
   - **Version stamp** for concurrent editing.
4. **Two themes** (for example "Bazaar", product-dense and bold; and "Minimal"):
   - **Theme settings:**
     - logo, colour palette (with a contrast check)
     - font (system or the two hosted ones)
     - button style, header layout, product card style
   - **Switching themes** keeps all section data, because sections are shared.
5. **Editor** (admin screen):
   - **Sidebar:** the page's sections with drag or up/down arrows to reorder, add from a library with previews, duplicate, hide without deleting, and remove.
   - **Form:** generated from the selected section's schema, with validation. Click a section in the preview to open its form.
   - **Live preview:** an iframe of the real storefront in **preview mode**, showing draft content and never cached. It uses a signed, short-lived preview token. It **opens in phone view**, because most shoppers are on phones.
   - **Controls:** phone/desktop toggle, undo and redo, autosave of drafts.
   - **Saved sections:** save a styled section and reuse it on other pages.
   - **Share preview:** a short-lived link so a partner can check the page on their own phone before it goes live.
   - **Publish:** publishes the page and purges its cache.
   - **Duplicate page.**
6. **Starter layouts** for common Bangladeshi niches: fashion, food, gadgets, cosmetics. Merchants apply one, then edit.

### Edge cases

- **Dangling references:**
  - A section references a deleted or disabled product or collection: it renders nothing on the storefront, and the editor shows a warning on that section.
  - Its image was deleted: placeholder plus an editor warning.
- **Schema changes:**
  - A release changes a section's fields: stored data is migrated; unknown fields are ignored; missing required fields take defaults.
  - Old drafts open fine after an upgrade.
- **Concurrent edits:** two staff edit the same page. The second publish sees "A newer version was published by Rahim", with options to reload or overwrite.
- **Page limits:**
  - A page with too many sections is capped at 40, with a performance warning above 25.
  - Large images in sections still use phase 09's sizes; never the original.
- **Preview token leaked:** it expires in minutes, only shows drafts read-only, and is bound to the store.
- **Locale gaps:** missing Bangla text in a section falls back to the English field.

### Security

- **Rich text** in sections is sanitized on save and on render.
- **No raw HTML or JavaScript section.** Custom scripts are a separate feature with CSP controls (phase 35).
- **Colour fields** accept validated hex values only, which prevents CSS injection.
- The iframe preview uses `sandbox`, and editor ↔ preview `postMessage` calls check the origin.
- The editor requires `EditStorefront` permission.

### Tests

- Unit: schema validation and every data migration.
- Visual regression snapshots of each section in both themes, in Bangla and English, at mobile and desktop widths.
- Playwright: add, reorder, edit, preview, publish, restore a version, and the concurrent-publish conflict.
- Performance: each starter layout passes the product-page budget.

### Done when

- [ ] A merchant builds a home page with 6 sections, previews it on mobile, publishes it, and the live page updates within seconds.
- [ ] Both themes render every section correctly in both languages.
- [ ] Every starter layout stays within the performance budget.

### Not in this phase

Sales-page sections and the embedded checkout (16), custom CSS (later, P2), free-form drag-anywhere layout (not planned), theme marketplace (not planned).

---

## Phase 16 — Sales pages: landing pages, funnels and attribution

| | |
|---|---|
| Milestone | M3 |
| Delivers | Sales page builder with embedded checkout (P0); order bump (P1, built here because it lives inside the embedded checkout) |
| Depends on | 14, 15 |
| Size | L |

**Goal.** Replace Elementor plus CartFlows for Facebook-ad sales pages. A merchant who has never built a page picks a template and a product, edits the text, and publishes in about 5 minutes. Each page has the story and the order form together, and every order is traced back to the campaign that brought it.

**Inputs.** The "Sales pages" menu in [reference-bd-admin.md](../research/reference-bd-admin.md#sales-pages-landing-page-builder) (our partner's model) and [sales-page-builder.md](../research/sales-page-builder.md) (what BD sales pages contain and what beginners need).

### Build

1. **"Sales pages" in the admin** (a menu of its own, not hidden under Appearance):
   - **List:** title, link, template, product, price, active or inactive, and orders from this page (from attribution). Actions: preview, duplicate, open, edit, delete.
   - **Create:** title, link (slug), **template** (picked by category, with previews), **product**. The page fills itself from the product: name, images, price, old price, video, stock and packs.
   - **Edit** in phase 15's editor: switch sections on or off, reorder, edit texts, live phone preview.
2. **Page settings:**
   - header: a slim bar with logo and phone (default), the normal store header, or none; a small footer
   - main colour and sale colour; a Bangla font pair; page width (phone-width column by default, or full width)
   - SEO title, description and share image; **"hide from Google"** on by default, because ad pages shouldn't compete with product pages
   - tracking comes from the store's settings (phases 20 and 36); nothing to set up per page
3. **Sales sections** (on top of phase 15's), each with phase 15's style options plus a **"show order button below"** switch that jumps to the order form, as BD sales pages repeat it after almost every section:
   - **hero** with headline, second line in the accent colour, badge ("১৫% ছাড়"), image or lite video, offer box, button
   - **benefits** checklist ("what you get"), with icons, as a list or grid
   - **story or problem** ("did you know"), with image left or right
   - **trust:** "why buy from us" with preset items (cash on delivery, check before paying, delivery across Bangladesh, returns), editable
   - **how to use** or **specifications** (label and value)
   - **reviews:** screenshots (BD merchants use these most), cards with name, text and stars, or a review video
   - **price and packs:** old price crossed out, offer price, % off, packs with a "popular" badge
   - **comparison:** "without ❌ / with ✅" rows (in our partner's model)
   - **countdown:** a fixed deadline in Dhaka time, or evergreen per visitor
   - **guarantee**, **FAQ** (with FAQPage JSON-LD), **call and WhatsApp** card (number and prefilled message), **CTA banner**
   - **sticky order bar** on phones: price and "অর্ডার করুন"
   - **lite video** everywhere: a thumbnail until tapped, so no YouTube script loads with the page
   - **no custom HTML section** (unsafe); merchant scripts stay a separate, controlled feature (phase 35)
4. **Embedded order form** (the key section):
   - one product, or a choice of several
   - **quantity packs** ("1 pack ৳550 / 2 packs ৳990 / 3 packs ৳1,400"), modelled as variants or as price rules (decide during the phase), and − / + quantity
   - product line with image, price, old price and % off
   - name and phone required, address with district → thana (or just inside/outside Dhaka, following the store's checkout setting), a note; **no email field by default**
   - delivery charge from the store's shipping rules (phase 07), payment methods the store has on (COD first)
   - live summary, a button that shows the total, and "পণ্য হাতে পেয়ে টাকা দিন" (pay when you receive)
   - the same validation, OTP, fake-order checks and duplicate-order block as phases 11 and 14
   - at most one order form per page
5. **Order bump:** a checkbox for an add-on product at a special price, shown inside the order form. It's hidden when the add-on is out of stock.
6. **Thank-you page** per sales page: a custom message, a WhatsApp follow-up button, the store's support phone, and optionally a same-site redirect.
7. **Attribution:**
   - On the first visit, store `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `ttclid`, the sales page ID and the referrer in a first-party cookie for 30 days (last non-direct touch wins).
   - Capture happens in a tiny client script or an edge beacon, because cached pages can't vary by query string.
   - Saved on the order as custom fields.
   - Order list filter by campaign or sales page, plus a simple "orders by campaign" view. Full reports come in phase 41.
8. **Twelve Bangla templates**, each a set of sections with sample text and a category tag:

   | Category | Templates |
   |---|---|
   | Food | ghee and honey, oil and spices, dates and dry food |
   | Health and herbal | herbal product (with a reminder about honest claims) |
   | Beauty | skin care, perfume/attar |
   | Fashion | single item (panjabi, borka), several items with size chart |
   | Gadgets | gadget with specs, demo video and warranty |
   | Baby and kids | baby product with safety points |
   | Other | seasonal combo (Eid, winter) with countdown, general |

9. **Duplicate page**, so merchants can make campaign variants quickly.

### Edge cases

- **Stock and pricing:**
  - The sales page product is out of stock or disabled: the order form shows "Currently unavailable", hides the form, and offers a WhatsApp contact.
  - Quantity packs larger than available stock: unavailable packs are disabled.
  - The price changed while the page was open: the form shows the current price before placing (phase 14 behaviour).
  - The linked product is deleted: the page goes inactive and the admin list shows a warning.
- **Countdown:** an expired fixed countdown shows a merchant-chosen message, or hides.
- **Two pages with the same link:** the second save is refused with a suggestion ("chia-seed-2").
- **Attribution:**
  - UTM parameters on cached pages: the cache key ignores them (phase 17), and attribution is still recorded client-side.
  - Very long click IDs or UTM values are truncated to safe lengths.
  - A shopper who arrives from an ad, leaves, and returns directly days later keeps the ad attribution (last non-direct touch).

### Security

- The thank-you redirect allows same-site paths only (no open redirect).
- UTM and click-ID values are length-limited and stored as plain text. They're escaped wherever the admin shows them, which prevents stored XSS through crafted links.
- The embedded order form has the same rate limits, CSRF and idempotency as phase 14.
- No section renders raw HTML; rich text is sanitized (phase 15).

### Tests

- Playwright: create a sales page from a template and a product, edit the hero, publish, then order with a pack choice, bump on and off, COD, and reach the thank-you page.
- Attribution saved correctly from UTM, fbclid and gclid links; last non-direct touch logic.
- Out-of-stock behaviours for main product, packs and bump.
- Performance: each template within the 45 KB first-party JS budget and LCP ≤ 1.5 s (throttled, local).

### Done when

- [ ] A merchant who has never built a page makes a sales page from a template and a product, and publishes it, in about 5 minutes.
- [ ] A shopper orders with a pack and an order bump on the sales page.
- [ ] The order shows its campaign and sales page.
- [ ] All twelve templates meet the sales page performance budget.

### Not in this phase

A/B testing (later), one-click post-purchase upsell (44), full campaign reports (41), "someone just ordered" pop-ups, before/after slider, multi-step funnels and lead forms (later, if merchants ask).

---

## Phase 17 — Speed layer: Varnish, purging and performance budgets

| | |
|---|---|
| Milestone | M3 |
| Delivers | The storefront speed success criterion; architecture Decision 2 |
| Depends on | 12–16 |
| Size | M |

**Goal.** Pages are served from memory, updated within seconds of a change, and the performance budget is enforced on every pull request.

### Decide at start

- **Fresh stock and prices on cached product pages.** Rely on purges when something changes (recommended), or add a tiny live-check island. Purges keep pages at zero JavaScript; decide with a staleness analysis.
- **Default TTLs:** HTML 7 days with purges, grace 24 hours, 404s 60 seconds.

### Build

1. **Varnish locally** (docker compose service) and **VCL in `infra/varnish/`**, the same file used in production (phase 23):
   - **Cache key normalization:** sort query parameters; remove `utm_*`, `fbclid`, `gclid`, `ttclid` and other tracking parameters from the key.
   - **Cookies:** strip all cookies on cacheable routes; bypass the cache for `/cart`, `/checkout`, `/account`, `/track`, `/t/`, `/shop-api`, preview mode, and any request with an admin or session marker.
   - **Tagging:** `xkey` tags from the response header.
   - **Grace mode:** serve the old page while fetching a new one; serve stale pages if the storefront is down.
   - **Purge endpoint** restricted to localhost through an ACL.
   - **Store separation:** the cache key includes the Host, and every object is tagged with the store ID.
   - **Health probes** for the storefront.
2. **Storefront emits `xkey` tags:** store ID, page type, product IDs, collection IDs, page/section IDs, a theme/settings tag, and a menu tag.
3. **Core plugin `cache-purge`:**
   - **Purge triggers:**
     - products, variants, collections and facets
     - page publishes, settings or theme changes, menu changes
     - promotions starting or ending
     - **stock status crossing** in-stock ⇄ out-of-stock (not every sale)
   - **Batching:** purges are batched and de-duplicated over a 2-second window and sent through the job queue with retries.
   - **Scheduled purges** at promotion start and end times (Vendure scheduled tasks).
   - **Purge-all** for bulk operations (imports) and theme switches.
4. **Cache warm-up job** after purge-all or a Varnish restart: crawl the home page, top categories and top 50 products.
5. **CI performance budgets:**
   - `size-limit` for every island bundle
   - Lighthouse CI against a production build with a throttled mobile profile, using the budgets from architecture.md (JS, LCP, CLS, INP proxy)
   - **The pull request fails** if any budget is exceeded
6. **Real-user speed measurement:** a tiny `web-vitals` beacon (no personal data, sampled) posts to the core; daily per-store p75 LCP, INP and CLS. This backs the "fastest in BD" claim with real numbers (shown in reports in phase 41).

### Edge cases

- **Purge storms** during bulk imports or bulk edits: purging pauses during the bulk job, then runs one purge-all and warm-up at the end.
- **Scheduled promotions:** a clock skew of a few seconds is tolerated; the purge runs at or just after the boundary.
- **Cache poisoning:**
  - `X-Forwarded-Host` and similar headers are ignored unless set by our own Nginx.
  - Responses vary only on what's needed.
  - Cache deception (`/account/x.css`): bypass rules match on path prefixes, not file extensions.
- **Personal content must never be cached:** a test fetches cart, checkout and account pages with two different sessions and checks nothing leaks.
- **Bangla and encoded URLs** normalize to one cache key.
- **Header size:** pages with many products could exceed `xkey` header limits. Cap the tags per page, falling back to page-type tags.
- **HEAD requests and conditional requests** (`If-Modified-Since`) behave correctly.

### Security

- The purge endpoint isn't reachable from outside; it's localhost-only with an ACL (tested).
- `Set-Cookie` is stripped from cached responses; responses to requests with `Authorization` are never cached.
- No personal data is written into cached HTML. Cart count and greetings load client-side.

### Tests

- Integration tests with the Varnish container:
  - a tag purge refreshes a product page and its category page
  - UTM variants share one cache entry
  - cart, checkout and account are never cached
  - cookies are stripped on cacheable pages
  - grace mode serves stale pages when the storefront is stopped
- A crawl test measures the hit ratio.
- Lighthouse CI runs on every pull request.

### Done when

- [ ] A product edit appears on cached product and category pages within 3 seconds.
- [ ] A crawl test shows a Varnish hit ratio above 90%.
- [ ] Lighthouse CI budgets block pull requests that exceed them.
- [ ] No personal content is ever served from cache (proved by the two-session test).

### Not in this phase

Production Varnish install and per-store backends (23, 24), CDN/BDIX decisions (29).
