# M8 · Public launch

> Phases 32–43 · [Roadmap overview](README.md)
> **Exit criteria:** every P1 feature in the spec is done, a new merchant goes from signup to first order without our help, and the launch decision (phase 43) passes.

The pilot (M7) will reshuffle priorities. Re-read each phase against the pilot retrospective before starting it.

---

## Phase 32 — Staff roles, two-factor, sessions and activity log

| | |
|---|---|
| Milestone | M8 |
| Delivers | Staff accounts with roles (P1), activity log (P1), staff two-factor (architecture) |
| Depends on | 30 |
| Size | L |

**Goal.** Owners give each staff member exactly the access they need. Every account is protected by a second factor, and every action is recorded.

### Build

1. **Roles** (defined in phase 02, now assignable), each a set of our permissions plus Vendure's:
   - **Owner:** everything, including billing, staff management, exports and dangerous settings.
   - **Manager:** all operations except billing, staff and exports.
   - **Order staff:**
     - orders, confirmation, printing, courier booking, incomplete orders
     - customer contact details (needed to call)
     - no sales totals, no settings, no exports
   - **Packer:** packed state, packing slips and stickers only; phone numbers partly masked.
   - **Marketing:** storefront editor, pages, landing pages, coupons, tracking settings and campaign reports. No customer contact details.
   - A **custom role** option for advanced owners.
2. **Staff management:**
   - invite by email or phone (single-use, 48-hour link), deactivate
   - **ownership transfer:** current owner re-authenticates, the new owner accepts, and there's an SMS confirmation and a 24-hour cancellation window
3. **Two-factor (TOTP):**
   - mandatory for owners and optional per store for other roles (a store setting can make it mandatory)
   - recovery codes (shown once, stored hashed)
   - "remember this device for 30 days" using a signed cookie
   - built with the Dashboard's **login extension point** plus a custom authentication strategy step
4. **Sessions:**
   - list of active sessions per user with device and approximate location; revoke one or all
   - idle timeout 12 hours, absolute 7 days
   - **new-device login alert** by SMS to the owner
5. **Brute-force protection:** limits per account and per IP, increasing delays, a temporary lock with notification. Error messages never reveal whether an account exists.
6. **Activity log** (Dashboard page):
   - **What's recorded:**
     - order transitions, price and stock changes, product edits
     - settings changes, staff changes
     - exports, logins, two-factor changes
   - who, what, before and after, when, from which IP and device
   - filters and export; retention 1 year
   - **Append-only**, even for the owner. Optionally, each entry stores a hash of the previous one, so tampering is detectable.

### Edge cases

- **An owner loses their 2FA device without recovery codes:** support-assisted recovery through central with identity checks (registered phone OTP plus business documents). It's a slow, logged process, because this is the classic social-engineering target.
- **A staff member leaves:** deactivation revokes all their sessions immediately.
- **Permissions changed while someone is logged in:** applied on their next request.
- **The last owner can't be removed or demoted** without a completed transfer.
- **Shared accounts:** discouraged in the UI, and new-device alerts make them visible.

### Security

- TOTP secrets are encrypted; recovery codes hashed; comparisons in constant time.
- Hidden UI never stands in for permissions: every API call checks permissions server-side, tested for each role.
- Activity log entries can't be edited or deleted through any API.

### Tests

- **Permission matrix:** an end-to-end test for every role × key action (about 60 combinations), allowed or denied.
- **Two-factor:** enrol, login, wrong code, recovery code use, remember-device expiry.
- Lockout and unlock; session revoke takes effect immediately.
- Activity log completeness for every recorded action type.

### Done when

- [ ] An owner invites order staff who can confirm and print orders, but can't see sales totals or export customers.
- [ ] Owners can't log in without two-factor.
- [ ] Every recorded action appears in the activity log, and nobody can delete it.

### Not in this phase

Single sign-on (not planned); our own staff's support access (43).

---

## Phase 33 — WooCommerce-style Dashboard and Bangla translation

| | |
|---|---|
| Milestone | M8 |
| Delivers | Dashboard in Bangla (P1); an admin that feels familiar to WooCommerce users; merchant-friendly navigation and onboarding |
| Depends on | 32 |
| Size | XL (split into 33a WooCommerce-style layout and lists, and 33b Bangla, mobile and onboarding) |

**Goal.** A merchant moving from WooCommerce finds their way around without training, because the menus, words, lists and workflows match what they know. A merchant who reads only Bangla can run their whole business from the Dashboard, on a phone.

**Timing option.** Part 33a only needs Vendure's Dashboard extension points, not phase 32's roles. Consider building it **before the pilot**, right after phase 22, because the pilot merchant's staff come straight from WooCommerce. Decide when planning the pilot.

### Decide at start

- **How close to go:** match WooCommerce's menu structure, terms, list columns and workflows, plus a dark WordPress-style sidebar. Don't attempt a pixel-identical copy of the WordPress admin, which would need our own admin app and lose Vendure's Dashboard updates.
- **Branding:** "WooCommerce" and its logo are Automattic's trademarks. Copy the layout and vocabulary, but never use their name, logo or exact brand colours in our UI.
- **Pages to replace, if any:** start by extending Vendure's own pages. Replace a page with our own only when it can't be bent far enough, with an ADR for each, because replaced pages don't receive Vendure's improvements.

### Build: WooCommerce-style layout (33a)

All of this uses Dashboard extension points, with **no edits to Vendure's code**:

- theme tokens and an additional stylesheet for the look
- the navigation function for menus
- data table extensions (`extendListDocument`, display components, default view options, bulk actions) for lists
- detail form and page block extensions for editors
- extra routes for replacement pages

1. **Look:** a dark left sidebar with a highlighted active section and white content area, similar to WordPress. Built from theme colour tokens plus a small, scoped stylesheet; keep the CSS minimal so Vendure upgrades rarely break it.
2. **Menu structure and words** that mirror WooCommerce's (in Bangla and English), each item pointing to a Vendure page, one of ours, or a later phase:

   | Menu | Items | Built on |
   |---|---|---|
   | Dashboard | Home widgets | Phases 04, 19 |
   | Orders | All orders, Add order, Confirm orders, Incomplete orders, Verify payments, Returns | Vendure orders + phases 04, 05, 08, 11, 37 |
   | Products | All products, Add new product, Categories, Tags, Attributes, Brands (if adopted), Reviews, Stock | Vendure products, collections ("Categories"), facets ("Tags", "Brands"), option groups ("Attributes") + phase 35 |
   | Customers | All customers, Blocked phones | Vendure customers + phases 03, 11 |
   | Payments | Methods and gateways | Phases 08, 18 |
   | Delivery | Couriers, Delivery charges | Phases 07, 19 (BD merchants need this top-level; WooCommerce hides shipping under Settings) |
   | Analytics | Overview, Revenue, Orders, Products, Categories, Coupons, Stock, Campaigns | Phase 41, structured like WooCommerce Analytics |
   | Marketing | Coupons, Pixel and tracking, Product feeds, SMS | Phases 10, 20, 35, 36 |
   | Appearance | Themes, Pages, Landing pages, Menus | Phases 12, 15, 16 |
   | Settings | Store, Checkout, Staff, Domains, Billing | Phases 02, 03, 32, 39, 40 |

   Vendure's own terms are renamed in the merchant view: Collections → Categories, Facets → Tags/Brands, Option groups → Attributes, Administrators → Staff, Promotions → Coupons.
3. **"All products" list** with WooCommerce's columns:
   - checkbox, thumbnail, **name with row actions** (Edit · Quick edit · Duplicate · Delete · View)
   - SKU, **stock status** ("In stock" in green, "Out of stock", "On backorder", with quantity)
   - **price with the regular price struck through and the sale price** (`৳1,500.00` struck, `৳1,350.00`), and price ranges for variable products
   - categories, tags, brand, a **featured star** toggle (a product custom field), and **date** ("Published" / "Last modified")
   - **filters:** category, stock status, product type
   - **bulk actions:** edit price and stock, publish or draft, delete
   - **Quick edit:** change price, sale price, stock and status inline, without opening the product
4. **"All orders" list** like WooCommerce's:
   - order number with customer name, date, status chip, total
   - **status tabs with counts** ("All (120) | New (12) | Confirmed (5) | …")
   - a quick-view preview of the order
   - our BD columns: phone, district, payment type, courier
5. **Product editor grouping** familiar to WooCommerce users: General (price, sale price), Inventory (SKU, stock), Shipping (weight), Attributes, Variations, Linked products. Use page block and form extensions to group Vendure's fields; don't replace the editor.

### Build: Bangla, mobile and onboarding (33b)

1. **Bangla translation of Vendure's Dashboard:**
   - Vendure ships Lingui `.po` files for many languages, but **no Bangla**, so we create `bn.po` for every Dashboard string
   - add our own extensions' strings
   - follow the glossary (`docs/glossary.md`)
   - **contribute `bn.po` upstream to Vendure**: this saves us maintaining it, and it's good for the community
2. **Language switch** per staff user (Bangla or English).
3. **Simplified navigation for merchants:**
   - Using the Dashboard's navigation extension function, **hide advanced Vendure areas**: channels, sellers, zones and countries, tax rates, job queue, system settings, raw promotions.
   - Merchant roles see BD-friendly section names; our own support role sees everything.
4. **Mobile layouts** for what owners do on their phones: confirmation queue, order detail, incomplete orders, payment verification, home widgets.
5. **Onboarding checklist** widget on the home page, with progress:
   - add logo
   - add first product
   - set delivery charges
   - choose payment methods
   - connect a courier
   - connect the Pixel
   - connect a domain
   - place a test order
6. **Help links** next to each page (pointing to the Bangla help center, phase 43), and "What's new" from phase 26.
7. **Bangla number display** option in tables and charts.

### Edge cases

- Missing translations fall back to English, never to a blank or a raw key.
- Long Bangla strings in buttons, tabs and table headers: layouts checked at mobile and desktop widths.
- Bangla digits in tables, money and dates when chosen, while inputs still accept both.
- A Vendure upgrade adds new strings: a CI report lists untranslated strings.
- **A Vendure Dashboard upgrade changes its markup or class names** and breaks our styling: overrides stay token-based and minimal, and visual regression snapshots of the key pages run on every Vendure upgrade.
- **Concepts that don't map one-to-one:** Vendure collections can be automatic (rule-based), while WooCommerce categories are manual. The Categories page shows manual collections; automatic ones are listed separately as "Smart categories".
- **Big catalogues:** extra list columns add query cost. Test the products list with 5,000 products and 50 variants on some, at page sizes 20, 50 and 100.
- **Quick edit conflicts:** two staff edit the same product at once. The second save sees "changed by Rahim just now" instead of silently overwriting.
- **Variable products** in the list: show a price range and a combined stock status ("In stock (3 of 4 variants)").

### Security

- Hiding navigation isn't security. The backend permission checks from phase 32 already block hidden areas for merchant roles; tests confirm it.
- Quick edit and bulk actions use the same permissions as the full editor, and are recorded in the activity log.

### Tests

- Translation coverage report: at least 95% of visible strings, enforced in CI.
- Playwright at phone width for the key pages, in Bangla.
- Layout overflow checks with long strings.
- Visual regression snapshots of the menu, products list, orders list and product editor, in both languages.
- **WooCommerce familiarity test:** 5 people who use WooCommerce daily each complete 10 common tasks without training, timed. The tasks include: find a product, change its sale price with quick edit, filter out-of-stock products, see New orders, add a category.

### Done when

- [ ] The menu, products list, orders list and product editor follow the WooCommerce structure above, with no changes to Vendure's own code.
- [ ] In the familiarity test, WooCommerce users complete at least 9 of 10 tasks without help.
- [ ] A Bangla-only tester completes a day of operations from a phone without English: confirm, print, book, verify payment and recover incomplete orders.
- [ ] Translation coverage is at least 95%, and the `bn.po` contribution is submitted upstream.

### Not in this phase

The help center content (43), the native mobile app (48).

---

## Phase 34 — Customer accounts: phone OTP login and shopper privacy

| | |
|---|---|
| Milestone | M8 |
| Delivers | Customer login with phone OTP or password (P1); migrated customers keep passwords (P1) |
| Depends on | 10, 14, 22 |
| Size | M |

**Goal.** Shoppers log in with their phone number, or their old WordPress password, to see their orders and reuse addresses, and can delete their data.

### Decide at start

- **Recycled phone numbers:** Bangladeshi operators reassign inactive numbers. When a phone's account has history but hasn't logged in for a long time (for example 12 months), require an extra check before showing old orders (the last order number, or the name on it), or show only orders placed after this login. Record the choice in an ADR.

### Build

1. **Authentication strategy `phone-otp`** (Shop API):
   - request an OTP (phase 10's SMS with phase 11's limits)
   - verify it, which starts a session (rotated after login)
   - optionally set a password
2. **Password login,** including migrated WordPress hashes (phase 22), which are re-hashed on first use.
3. **Guest records are claimed by phone:** past guest orders with that phone appear in the new account's history, following the recycled-number rule.
4. **Account pages** (storefront):
   - **Orders**, including legacy imported orders, each with status and tracking.
   - **Saved addresses** with the district/thana picker. **Checkout prefills them only after login**, the privacy rule from phase 03.
   - **Profile,** logout, and "log out everywhere".
5. **Data requests:**
   - **"Delete my account":** confirmed by OTP. It anonymizes personal fields on orders (name, phone, address and email replaced, financial records kept) and deletes saved addresses.
   - **"Download my data"** as JSON.

   Both are recorded and shown to the merchant.
6. **Legacy email-only accounts** (migrated without a phone): email + password login, with a prompt to add a phone.

### Edge cases

- **OTP problems:** delays (resend after cooldown), wrong code limits, the daily cap reached (a clear message with the store's WhatsApp as a fallback).
- **Account takeover risks:**
  - **SIM swap or recycled number:** the recycled-number rule; sensitive changes (phone change) need the old phone, or support.
  - **Shared family phone:** one account per phone; the help text explains it.
- **Duplicate customers from migration** with the same phone: merged by phase 21's rules before login is enabled.
- **Session security:** a fresh session after login (no session fixation); logout everywhere revokes all tokens.

### Security

- **OTP handling:** stored hashed, limited attempts, generic responses that never reveal whether an account exists.
- **SMS pumping limits:** Bangladeshi numbers only, per phone and per IP, with a daily cap per store.
- **Passwords:** minimum length, a check against common-password lists, no maximum below 64 characters.
- **Anonymization** really removes the data, and is tested.

### Tests

- End-to-end: OTP login, password login, a migrated login for each WordPress hash format, claiming guest history, the recycled-number rule.
- Rate limits and enumeration resistance.
- Anonymization: after deletion, no personal data about that customer remains anywhere in the store's database.

### Done when

- [ ] A migrated customer logs in with their old WordPress password or by phone OTP and sees their full order history.
- [ ] Checkout prefills saved addresses only after login.
- [ ] A deletion request anonymizes the customer completely while keeping financial records.

### Not in this phase

Social login (later), wishlists and loyalty (later).

---

## Phase 35 — Merchandising extras: coupons, reviews, bulk edit, alerts and custom scripts

| | |
|---|---|
| Milestone | M8 |
| Delivers | Coupons (P1), product reviews (P1), bulk edit and CSV import/export (P1), low-stock alerts (P1), custom head/footer scripts (P1) |
| Depends on | 10, 14, 22 |
| Size | L |

**Goal.** The everyday tools merchants expect, without breaking the speed budget or opening security holes.

### Build

1. **Coupons and automatic promotions:** a simplified UI on top of Vendure promotions.
   - **Types:** fixed amount or percentage off the order, free delivery, and buy X get ৳Y off.
   - **Conditions:** minimum order, specific products or collections, first order only.
   - **Usage limits:** total and **per customer, by phone**.
   - **Dates** in Dhaka time.
   - **Stacking rule:** at most one coupon, plus automatic promotions.
   - **Rounding** to whole taka per the money rules.
   - A coupon field at checkout and in manual orders. Imported WooCommerce coupons appear here.
2. **Reviews:**
   - **What a review holds:** rating, text, optional photos (through the image pipeline), display name, and the phone (never shown).
   - **"Verified purchase" badge** only when linked to a delivered order.
   - **Collection:** an SMS link after delivery (phase 10 template) opens a short review form; no login needed, using a single-use token.
   - **Moderation queue:** approve, reject, spam; and auto-hold for links or profanity (Bangla and English lists).
   - **Display** on product pages, plus **AggregateRating** in JSON-LD (only from approved real reviews).
   - Imported WooCommerce reviews shown with their original date.
3. **Bulk edit:** a spreadsheet-like grid for price, compare-at price, stock and status across many variants, with an undo of the last bulk change.
4. **CSV import and export** for products, using Vendure's importer:
   - Imports run as background jobs with a dry-run preview.
   - Exports are UTF-8 with BOM and protected against CSV injection.
5. **Low-stock alerts:**
   - a threshold per variant or a store default
   - a daily digest to the owner by SMS or email
   - a home widget
6. **Custom head/footer scripts:**
   - **What's allowed:** `<script>`, `<noscript>` and `<meta>` tags only.
   - **Speed:** loaded **after the page is interactive**, and the Dashboard shows an estimated speed cost.
   - **CSP:** the merchant lists the domains their scripts need, and the storefront's CSP allows exactly those.
   - **Safe mode:** one switch disables all custom scripts instantly.
   - **Where scripts run:** never in the Dashboard. On checkout only if the merchant explicitly allows it, with a warning.

### Edge cases

- **Coupons:**
  - **Brute-force guessing of codes:** rate limit `applyCouponCode` per session and per phone; responses don't reveal near-misses.
  - **Percentage discounts producing paisa:** rounded to whole taka.
  - **Overlapping promotions:** priority rules, written down and tested.
- **Reviews:** spam and abuse in Bangla (moderation lists); a merchant writing fake reviews (allowed but never marked verified); photos with personal data (EXIF stripped by phase 09).
- **CSV:** Bangla text with commas, quotes and line breaks; very large imports run as background jobs with progress.
- **Custom scripts:** a broken script (the storefront still renders, and the Dashboard shows a console-error count from real-user reporting); a script trying to read checkout fields (warned about, and checkout is excluded by default).

### Security

- **XSS:** reviews are plain text only, with photos through the image pipeline.
- **CSP:** custom scripts get nonce- or hash-based CSP entries and are never injected into the Dashboard.
- **CSV import:** validated per field; imports need `ImportProducts` permission.
- **Coupons:** codes are never listed publicly or enumerable.

### Tests

- Promotion calculation matrix, covering rounding and stacking.
- Review flow from SMS link to moderation to display, plus JSON-LD.
- CSV round trip with Bangla, opened in Excel; CSV injection test.
- CSP behaviour with and without custom scripts; safe mode.
- Budgets: custom scripts are excluded from the first-party JS budget but measured and shown.

### Done when

- [ ] Every P1 merchandising feature above works end to end.
- [ ] Performance budgets still pass with custom scripts off; with them on, the Dashboard shows the speed cost.

### Not in this phase

Loyalty points, gift cards (later).

---

## Phase 36 — Marketing integrations and product feeds

| | |
|---|---|
| Milestone | M8 |
| Delivers | GA4, TikTok Pixel + Events API, Google Tag Manager (P1); Meta catalog feed (P1) |
| Depends on | 20 |
| Size | M |

**Goal.** The other ad and analytics platforms merchants use, with the same deduplicated server-side approach as Meta, plus product feeds for dynamic ads.

### Decide at start

- Whether Meta's catalog accepts WebP images today. If not, generate a JPEG size for feeds only.
- Feed refresh method: regenerated on change and cached, or on a schedule.

### Build

1. **GA4:** the gtag script loaded after the page is interactive (optional), plus **Measurement Protocol** server events for purchases, deduplicated, using the same Purchase trigger as Meta.
2. **TikTok Pixel + Events API:** server-side events with `event_id` deduplication and normalization like Meta's; the same trigger setting.
3. **Google Tag Manager:** container ID field, loaded after interaction, with a clear speed warning (GTM often loads many scripts).
4. **Product feeds:**
   - **Meta catalog** (XML or CSV):
     - **Identity:** `id` matching `content_ids` from phase 20, `item_group_id` for variants.
     - **Listing:** title, plain-text description, link, image link, brand.
     - **Stock and price:** availability, condition, price in BDT, sale price.
   - **Google Merchant Center** feed with the required fields.
   - **Feed URLs** contain a secret token (or are public, per merchant choice); regenerated on product changes and cached.
5. **Campaign data** is ready for phase 41's reports.

### Edge cases

- Products without images (excluded, and listed in the Dashboard); Bangla titles (allowed); very large catalogues (streamed generation).
- Out-of-stock items, discounted items, and disabled products (excluded).
- Feed fetches by platforms during a release: always served from the last good copy.

### Security

- Tokens for GA4 and TikTok are encrypted per store.
- Feeds contain no personal data; private feed URLs are unguessable.

### Tests

- Feed validation against each platform's spec (XML schema and required fields).
- Deduplication tests for TikTok and GA4, matching phase 20's.

### Done when

- [ ] Meta's catalog ingests the feed without errors.
- [ ] TikTok and GA4 purchases are deduplicated and respect the Purchase trigger.

### Not in this phase

More ad networks (later, on demand).

---

## Phase 37 — Couriers II: RedX, courier fraud check, returns and COD reconciliation

| | |
|---|---|
| Milestone | M8 |
| Delivers | RedX (P1); COD fraud check from courier data (P1); returns workflow and COD reconciliation (not in the spec, but every COD merchant needs them) |
| Depends on | 19 |
| Size | L |

**Goal.** Cover the third major courier, catch fake orders with courier history, handle returns properly, and show merchants whether couriers paid them everything they collected.

### Decide at start

- Which couriers offer a "customer success rate" (fraud check) API today, and its terms of use.
- Courier payout statement formats (API or CSV) for Steadfast, Pathao and RedX.

### Build

1. **RedX driver:** location IDs mapped like Pathao's (sync, automatic match, manual mapping queue), booking, status sync, bulk.
2. **Courier fraud check:**
   - query courier success-rate APIs where available, cached per phone for 24 hours
   - combined with phase 11's own-store score (and phase 38's network score) in **one risk panel** in the confirmation queue
3. **Returns workflow:**
   - **Receiving:** a "returned parcels" screen; scan the barcode to receive.
   - **Per item:** restock or mark damaged, with a return reason and the courier's return charge recorded.
   - **Partial deliveries:** the customer kept some items; the amount collected is recorded.
   - **Exchanges:** a new order linked to the original, with delivery charge rules.
4. **COD reconciliation:**
   - Courier payout statements imported by API or CSV upload, and matched to orders by consignment ID.
   - **For each order:** expected COD vs collected vs paid out, minus courier charges (delivery fee, COD fee, return fee).
   - **A discrepancies queue:** missing payouts, short payments, unknown consignments.
   - **COD payments are settled when the payout is received** (or on delivery, per store setting).
   - Net revenue per order goes to reports (41).
5. **Default courier per zone** using simple rules (cheapest, or best delivery rate for that district from history). Full smart assignment is phase 46.

### Edge cases

- Statements with IDs that don't match any order (unknown consignment, listed for review).
- Partial payouts, several payouts for one order, and rounding differences of a taka.
- Disputes with the courier: an order is marked disputed, with notes.
- A parcel returned after it was marked delivered (rare): the order is reversed with staff confirmation.
- **Lost parcels:** a claim workflow with status.

### Security

- Payout files are validated strictly (types, sizes, formats), and uploads go through the same checks as other imports.
- Financial screens need `ReadFinance` (owner and manager by default). Every reconciliation action is recorded.
- Courier fraud data is shown only to staff and never to shoppers.

### Tests

- Reconciliation matching unit tests with real (anonymized) statement samples from each courier.
- Returns end to end: scan, restock and damaged, partial delivery, exchange.
- RedX contract tests and mapping coverage, as in phase 19.

### Done when

- [ ] A month of courier payouts reconciles automatically, with discrepancies listed.
- [ ] Returned parcels are received by barcode and restocked correctly.
- [ ] RedX bookings work; the risk panel shows courier history.

### Not in this phase

More couriers and smart assignment (46).

---

## Phase 38 — Central SMS gateway and fraud network

| | |
|---|---|
| Milestone | M8 |
| Delivers | SMS through the platform with per-store credits (P0 note and P1); cross-store COD fraud score (P1) |
| Depends on | 10, 11, 25 |
| Size | L |

**Goal.** SMS go through the platform with accurate per-store credits and a failover provider. Merchants also benefit from a privacy-preserving shared signal about phones that repeatedly refuse COD deliveries.

### Build

1. **Central SMS service:**
   - a primary and a **failover** provider
   - sender ID management (each store's own masking ID if approved, otherwise the platform's)
   - delivery reports, plus a **credit ledger** per store (purchase through phase 39; consumption by segment)
   - an "SMS log" page per store in the Dashboard
2. **Store driver switch:** phase 10's interface gets a "central" driver. Stores move to it with a setting, and no caller changes.
3. **Fraud network:**
   - **Reporting:** stores report outcomes (delivered, returned, cancelled as fake) with the phone over the signed store API (phase 25).
   - **Central never stores raw phones.** It stores an **HMAC-SHA256 of the phone with a secret key ("pepper")** held only by central. Plain hashes wouldn't be enough: Bangladesh's phone-number space is small enough to brute-force every number.
   - **Aggregation:** counts with time decay (recent behaviour matters more).
   - **Anti-poisoning:** outcomes confirmed by a courier count fully; manual "fake" flags count less; stores reporting unusually high return rates are down-weighted and reviewed.
   - **Score API:** a 0–100 score with counts (delivered, returned, refused) and **no store names**.
   - **Data retention** (for example 24 months), plus a dispute process so a shopper can ask for review or removal.
4. **Risk panel:** the confirmation queue (phase 04) and phase 37's panel show the network score alongside the own-store and courier data.
5. **Privacy assessment** documented, and terms updated (phase 42) to describe the network to merchants and shoppers.

### Edge cases

- **Central is down:** SMS waits in each store's outbox; fraud scores are skipped, with "network score unavailable" shown, and never block an order.
- **Failover duplicates:** idempotency keys stop the same SMS going through both providers.
- **Pepper rotation:** hashes can't be recomputed without raw phones, so peppers are versioned. New reports use the new pepper while lookups check both during a transition window.
- **Recycled numbers:** time decay limits the effect of an old owner's history.
- **Malicious store poisoning a competitor's customers:** anti-poisoning weighting and anomaly review.

### Security

- No raw phones in central's database or logs.
- Score responses reveal no store identities and no order details.
- Strict per-store authentication, rate limits and quotas on both services.
- Credit ledger changes are append-only and audited.

### Tests

- Credit ledger accounting under concurrency (no negative balances, no double spending).
- Score aggregation with time decay; a poisoning simulation stays within bounds.
- SMS failover with duplicate suppression.
- A test confirming central never stores a raw phone.

### Done when

- [ ] Stores send SMS through central with accurate per-store credits, and failover works.
- [ ] A phone with returns at other stores shows a network score in the confirmation queue.
- [ ] The privacy assessment is written.

### Not in this phase

Buying credits with real money (39).

---

## Phase 39 — Plans, billing and limits

| | |
|---|---|
| Milestone | M8 |
| Delivers | Subscription billing with bKash or card (P1); SMS credit purchase |
| Depends on | 25, 38 |
| Size | L |
| Needs | Accountant advice on VAT and invoicing (lead-time item); your pricing decision (spec section 8) |

**Goal.** Merchants subscribe, pay and buy SMS credits in Bangladeshi ways. Limits are enforced gently (never blocking a shopper's checkout), and unpaid stores are suspended without losing data.

### Decide at start

- **Plans and limits** (spec section 8): products, orders per month, staff, storage, features (custom domain, two Pixels…).
- **Recurring payments:** check whether bKash's agreement-based tokenized payments can charge automatically. If not, send a payment link each cycle.
- **Proration policy:** keep it simple, for example charging the difference immediately on upgrade.

### Build

1. **Plans and entitlements** (central): plan definitions, entitlements sent to stores (cached for 7 days), plus soft-limit behaviour:
   - **Never block checkout.**
   - Over a limit, the merchant gets a warning, then a grace period, then an upgrade prompt. Adding products is blocked when over the product limit; orders always flow.
2. **Billing** (central):
   - **Invoices:** monthly or annual, in BDT, with VAT handled per the accountant's advice, as HTML/PDF in Bangla and English, plus receipts.
   - **Payment:** **bKash** (automatic where possible, otherwise a link) and **SSLCommerz cards**, with the platform's own gateway accounts.
   - **Trials, launch coupons**, and a "free migration" flag.
3. **SMS credit purchase:** packs bought through the same payment flow, credited to phase 38's ledger.
4. **Dunning:**
   - reminders by SMS and email at 7 and 3 days before, on the day, and 3 and 7 days after
   - a **14-day grace period**
   - then **suspension** (phase 24: storefront shows the suspended page, and the Dashboard keeps billing and export)
   - **instant reactivation** on payment
   - **never deletes data** because of non-payment, except after a long, clearly communicated period (stated in the terms)
5. **Merchant billing page** (Dashboard): current plan, usage against limits, invoices, payment methods, buy SMS credits, change plan.
6. **Finance admin** (central): revenue, MRR, failed payments, refunds, and manual adjustments (two-person approval for large ones, all audited).

### Edge cases

- **Payment confirmation:** succeeded but the webhook was lost (reconcile, as in phase 18); double charge (refund).
- **Plan changes:** a downgrade while over the new limits is refused with what to reduce, or allowed read-only for the extras (decide); a mid-cycle upgrade follows the proration rule.
- **Store lifecycle:** a store deleted with unpaid invoices; a suspension during an active sale (warnings well ahead, never a surprise).
- **Rounding and dates:** BDT whole amounts; billing day boundaries in Dhaka time.

### Security

- The platform's own gateway credentials live in central's secret store.
- Only the finance role sees billing data. Invoices can't be changed after issue; corrections are credit notes.
- No card data on our servers (hosted gateway pages).

### Tests

- Billing state machine (trial, active, past due, suspended, reactivated, cancelled) with every transition.
- Dunning schedule timing in Dhaka time.
- Entitlement enforcement in a store: soft limits behave; checkout is never blocked.
- Payment reconciliation and duplicate-payment refunds.

### Done when

- [ ] A store subscribes by bKash, receives invoices, buys SMS credits, gets suspended after the grace period, and reactivates instantly on payment.
- [ ] Hitting a plan limit never blocks a shopper's checkout.

### Not in this phase

Platform-level payments for merchants' own sales (49).

---

## Phase 40 — Self-serve signup, custom domains and onboarding

| | |
|---|---|
| Milestone | M8 |
| Delivers | Sign up and free subdomain (self-serve), custom domains (self-serve), self-serve migration wizard (P1); the public launch criterion |
| Depends on | 22, 24, 25, 26, 33, 39 |
| Size | XL (split into 40a signup + domains and 40b migration wizard if needed) |

**Goal.** A merchant finds Ecomm BD, signs up, connects a domain (or migrates from WooCommerce), and takes a first order **without talking to us**.

### Build

1. **Marketing site** at `ecomm.bd` (Astro, static, Bangla first, very fast):
   - features, pricing, the published speed comparison, the migration offer, the pilot case study
   - help and docs links, and signup
2. **Signup:**
   - phone OTP, email, store name and slug
   - slug availability with the reserved list, an offensive-words list (Bangla and English) and a homoglyph check
   - plan choice, and terms acceptance (recorded with version and time)
   - **Then:**
     - central triggers provisioning (phase 24) through the agent
     - the owner lands in the Dashboard with the onboarding checklist (phase 33)
     - a welcome SMS and email are sent
   - **Bot protection** only when signals suggest abuse.
3. **Custom domain connection:**
   - step-by-step instructions per common registrar (including BTCL for `.bd` domains)
   - **DNS verification:** CNAME for `www` and subdomains; an A record (or ALIAS) for the apex domain; plus a **TXT ownership token**
   - automatic SSL issuance and renewal monitoring
   - the choice of `www` or apex as primary (the other redirects)
   - domain removal with certificate cleanup
4. **Self-serve migration wizard**, the merchant-facing version of phases 21–22:
   - plugin installation guide with a video
   - pairing, then the dry-run report explained in plain Bangla
   - review of open orders, and the cutover scheduled with the checklist
   - a "Talk to us" escape hatch at every step
5. **Abuse prevention:**
   - signup rate limits, a disposable-email blocklist
   - a **review queue** for suspicious stores (names or content mimicking banks, bKash or Nagad login pages)
   - a takedown process and ToS enforcement tools in central

### Edge cases

- **Signup:**
  - slug taken, reserved or offensive (suggest alternatives)
  - provisioning fails (retry automatically; tell the merchant honestly what's happening)
  - duplicate signups with the same phone (resume the existing one)
- **Custom domains:**
  - the domain is already connected to another store (TXT ownership proof decides)
  - **DNS propagation delays:** polling with backoff for up to 48 hours, with status shown
  - **CAA records** blocking Let's Encrypt (detected and explained)
  - **domain behind Cloudflare's proxy** (the HTTP check fails; explain, or switch to a DNS challenge)
  - international domain names (punycode)
  - apex domains at registrars without ALIAS records (A record to our IP)

### Security

- **Signup flood protection:** phone OTP, rate limits, and bot checks on suspicion.
- **Phishing store detection** and a fast takedown process: our reputation depends on it.
- **Subdomain takeover prevention:** custom domains are re-verified periodically; deleted stores' domain mappings are removed immediately.
- **Terms acceptance** recorded for every merchant.

### Tests

- Playwright: signup → store live → first product → test order, with no manual steps.
- Domain connection on staging with real test domains (subdomain, apex, `www`).
- Abuse rules: a phishing-style name goes to review.

### Done when

- [ ] A new merchant goes from signup to first order with no help (the public launch criterion).
- [ ] Custom domains connect with automatic SSL.
- [ ] A WooCommerce merchant migrates through the wizard without our team.

### Not in this phase

Paid ads and growth marketing (outside the product), a partner/agency programme (later).

---

## Phase 41 — Reports and analytics

| | |
|---|---|
| Milestone | M8 |
| Delivers | Reports: sales by day/product, delivery success rate, returns (P1) |
| Depends on | 16, 19, 37 |
| Size | M |

**Goal.** Owners see the numbers that matter for a COD business, instantly, including the one that changes ad spending: **revenue from delivered orders by campaign**.

### Build

1. **Pre-aggregated daily tables**, updated by jobs (and backfilled), so reports stay instant on large stores.
2. **Reports** (Dashboard, Dhaka time, CSV export):
   - **Sales:** by day, week and month; by product, variant and collection; average order value; COD vs prepaid.
   - **Orders:** by status; cancellations by reason (the fake-order rate).
   - **Delivery:** success rate overall, by **district** and by **courier**; return rate and reasons.
   - **Campaigns:** UTM and landing page → orders, delivered orders and **delivered revenue** (true return on ad spend for COD).
   - **Customers:** repeat-customer rate; incomplete-order recovery rate.
   - **Staff:** confirmations per person and time to confirm (owners and managers only).
   - **Usage:** SMS by day and type.
   - **Speed:** the real-user speed data from phase 17 (p75 LCP, INP, CLS) per page type.
   - **Finance:** net COD after courier charges (from phase 37).
3. **Light charts,** loaded only on report pages.
4. **Toggle** to include or exclude imported legacy orders.

### Edge cases

- **Timezone boundaries:** all aggregation in Dhaka time.
- **Late status changes** altering past days (an order delivered a week later): affected days are recomputed in a rolling window.
- **Adjustments:** refunds, partial deliveries and returns change revenue figures correctly.
- **Scale:** stores with 100,000+ orders still load reports in under a second.

### Security

- Reports need `ReadReports`; the staff report is owner and manager only; exports are recorded.

### Tests

- Aggregation correctness against fixture stores with known answers.
- Backfill after a deploy produces identical numbers.
- Performance on a 100,000-order fixture.

### Done when

- [ ] An owner sees "delivered revenue by campaign, last 30 days" and "delivery success by district" in under a second on a store with 20,000 orders.
- [ ] Every report matches the fixture answers.

### Not in this phase

Custom report builder and data warehouse (later).

---

## Phase 42 — Security hardening II: penetration test, legal and disaster recovery

| | |
|---|---|
| Milestone | M8 |
| Delivers | Launch-grade security and compliance |
| Depends on | 32–41 |
| Size | L |
| Needs | A penetration testing firm; a Bangladeshi lawyer (lead-time items) |

**Goal.** An independent security test, the legal documents a platform needs in Bangladesh, and proof that we can survive losing a whole server.

### Build

1. **External penetration test** covering:
   - storefront, Shop and Admin APIs, Dashboard
   - central, agent and the WordPress plugin
   - the signup flow

   Fix every high and critical finding, then get a retest.
2. **Bug bounty or disclosure programme:** private first, public later.
3. **Legal documents** (drafted with the lawyer, in Bangla and English):
   - Terms of Service and Acceptable Use Policy for merchants
   - a merchant data processing agreement
   - the platform privacy policy
   - a **privacy policy template** for each store
   - cookie and tracking notice
   - fraud network disclosure (phase 38)
4. **Compliance review** with the lawyer:
   - Bangladesh's data protection and cyber security laws in force at the time
   - the **Digital Commerce Operation Guidelines 2021**, which contain rules about advance payments, delivery times and refunds that may require product features
   - consumer protection, and SMS sending rules

   Required product changes go into the backlog with priorities.
5. **Disaster recovery exercise:**
   - "lose" a staging server completely and restore all its stores onto a new one from backups
   - measure against the RTO and RPO targets
6. **Data retention enforcement** jobs verified: incomplete checkouts, IPs, logs, legacy password hashes.
7. **Secret rotation drill** in production, during a maintenance window.
8. **Security runbooks** updated after the penetration test.

### Edge cases

- **Legal requirements that conflict with product design** (for example advance-payment rules): handled through feature flags and settings, not one-off code.
- **Penetration findings in third-party code** (Vendure or its dependencies): reported upstream, with patch-package used only if urgent (setup guide in the root `README.md`, section 9).

### Security

This whole phase is security and compliance.

### Done when

- [ ] Penetration test high and critical findings are fixed and retested.
- [ ] Legal documents are published, and the store privacy template is available to merchants.
- [ ] The disaster recovery exercise meets the RTO and RPO targets.
- [ ] The compliance review is written, with required changes scheduled.

### Not in this phase

Formal certifications (for example ISO 27001; later, if customers require them).

---

## Phase 43 — Launch readiness: help center, support and launch decision

| | |
|---|---|
| Milestone | M8 |
| Delivers | The public launch |
| Depends on | 42 |
| Size | M |

**Goal.** Everything a merchant needs when we're not in the room, a support operation that can handle many merchants at once, and an explicit decision on whether to launch.

### Build

1. **Bangla help center** (`help.ecomm.bd`, static and fast), linked from the Dashboard (phase 33):
   - an article per feature, from the help drafts written in each phase, with screenshots
   - short videos for the top 10 tasks
   - searchable, in Bangla and English
2. **Support tooling** (central):
   - **Support view per store:** health, recent errors, recent failed jobs, version, plan.
   - **Time-limited, audited support access** to a store's Dashboard:
     - needs merchant consent (a setting, or a one-time approval) and expires automatically
     - every action is recorded in both the store's activity log and central's audit log
   - **Ticketing:** a shared inbox or helpdesk, with a WhatsApp Business connection; canned replies in Bangla.
3. **Support levels per plan** (response times), and an escalation path to engineering.
4. **Runbooks:** incidents, restores, gateway outages, courier outages, mass SMS failure, a suspicious store, and a merchant locked out of their account.
5. **On-call rota** and a weekly operations review.
6. **Status page** in use (phase 28) with templates for common incidents.
7. **Launch decision checklist:**
   - all P1 features done; penetration test clean
   - backups and disaster recovery proven; capacity for the first N merchants confirmed
   - support staffed and trained
   - pricing final; legal documents live
   - help center complete for every feature
8. **Launch communication:** the marketing site, the pilot case study, and announcement channels.

### Edge cases

- A launch spike in signups beyond provisioning capacity: a waitlist with automatic invites as capacity frees up (central controls the rate).
- Support access requested by someone impersonating our team: merchants can see every active support session and revoke it.

### Security

- Support access is the most sensitive operation we perform on a merchant's store: consent, time limits, full recording, visible to the merchant.

### Done when

- [ ] The launch decision checklist passes.
- [ ] The first 10 public merchants onboard with a small, measured number of support tickets each, used as the baseline for improvement.

### Not in this phase

Growth features (M9).
