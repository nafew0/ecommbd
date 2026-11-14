# Competitor check: Boneek

**Checked:** 14 November 2026, in a merchant's live Boneek account (Growth plan, signed in by the merchant). This is the merchant who is moving to us.
**Scope:** only what a store owner sees and uses. Boneek's super-admin and internal tools are out of scope.
**Our side:** what is built on `main` today (M1–M5, phases 01–22) and what is planned in [the roadmap](../roadmap/README.md).

**How the check was done.** We opened every menu, submenu and settings page, and opened the forms for new records.
- We saved nothing, installed no add-on and placed no order.
- We never pressed a paid add-on's "Next" step, so its prices are unknown.
- Shopper names and phone numbers seen in the account are left out of this document on purpose.

---

## 1. Summary

Boneek is an **all-in-one back office** for Facebook-driven COD sellers. Alongside the storefront it covers:
- dropshipping from Boneek's own supplier catalogue, with automatic payouts
- purchases from suppliers
- accounts and expenses, with a profit and loss report
- branches and stock transfers
- staff with fine-grained roles, plus "pick an order" task queues for call staff
- an add-on store for paid services (AI calling, call centre, SMS)

**We are stronger** on everything Bangladesh-specific in the selling flow:
- Bangla throughout
- district → thana addresses
- online payments (SSLCommerz, bKash) and manual bKash, Nagad and Rocket with transaction-ID checks
- partial advance payments
- COD OTP and risk scores
- the call-confirmation queue
- delivery-charge rules
- invoice and sticker printing
- sales pages with campaign tracking
- SEO
- a much faster storefront
- a deeper WooCommerce migration

**Their biggest advantages** are the back office (money, stock and staff) and the add-on services.

**Decisions since the first check (14 November 2026):**
- **Dropshipping is out of our business scope** and won't be built. This merchant's account held only dropshipping orders (97 dropshipping, 0 normal, empty inventory), so that part of their business stays with whoever supplies it.
- **The back office is in scope:** purchases, suppliers, accounts, expenses, profit and loss, and branches.
- **Paid services** (AI confirmation calls, a call centre) will be **offered by us, alone or with partners**.
- **No add-on store.** We build each feature ourselves, one by one, as normal settings.
- **The page builder is covered in its own document:** [competitor-boneek-page-builder.md](competitor-boneek-page-builder.md).

| Area | Who's ahead |
|---|---|
| Storefront speed, SEO and Bangla | **Us** (clearly) |
| Checkout, payments and address quality | **Us** |
| Fake-order protection | **Us** (they have phone, IP and device limits; we have OTP, a risk score and advance payment) |
| Order confirmation workflow | **Even**: our call queue against their staff pick queues and Follow-up status |
| Courier booking | **Even**: both have Steadfast and Pathao; they add Forces Courier and "your own courier" |
| Courier success score on an order | **Them** (we plan it in phase 37) |
| Store design tools | **Even**: we have a deeper editor; they have a simpler page builder and a live preview on every settings form |
| Sales and landing pages | **Us** (templates, packs, order bump, campaign tracking) |
| Volume offers on the product page | **Them** |
| Dropshipping catalogue and payouts | Them; **out of our scope** |
| Page builder | **Them** on granular control; **us** on speed, history and safety (see the [page builder report](competitor-boneek-page-builder.md)) |
| Purchases, suppliers, expenses, accounts, profit and loss | **Them** (we have nothing) |
| Staff, roles, activity log | **Them** (we plan it in phase 32) |
| Branches, stock transfers, units, brands | **Them** |
| Add-ons (AI calling, call centre, SMS, PWA, GTM, Google Ads) | **Them** |
| Self-serve signup, plans, domains | **Them** (we plan it in phases 39–40) |
| WooCommerce migration | **Us** (passwords, 301 redirects, helper plugin, verification report against their three "Sync now" buttons) |
| Admin usability (search, notifications, dashboard, help videos) | **Them** |

---

## 2. Boneek's menu, mapped

**Top bar** (dark, full width):
- Boneek logo
- **global search** (Ctrl+K) that jumps to screens and actions such as "Create order" or "Create product"
- **notifications** bell
- **store switcher** (Switch store, Add store)
- account menu (Manage profile, Business preferences, Logout)

**Left sidebar.** Each group opens to show its submenu when you are inside that group.

| Group | Submenu |
|---|---|
| Dashboard | Date range, total sales, orders, items, average order value, a sales chart, 8 status tiles (Pending, Approved, Follow up, Cancelled, Ready to ship, In transit, Delivered, Returned), recent orders and help videos |
| Orders | All orders, Order return, Incomplete orders, Draft orders |
| Products | All products, Inventory, Stock transfers, Variations, Categories, Brands, Units |
| Purchases | Purchases, Purchase returns, Suppliers |
| Customers | All customers, Customer tags (Fraud, New, Regular, VIP) |
| My Tasks | Picked orders, New orders (a staff member "picks" orders to call; there's a pick limit, and unpicking can be allowed) |
| Accounts | All accounts (cash or bank, with balance), Transactions history, Expenses, Expense heads |
| Reports | Profit / loss (sales − purchases − expenses), Staff report (follow-ups done and pending per staff member), Activity log |
| Dropshipping | All orders, Order return, Replacements, Incomplete orders, Find products (supplier catalogue with buying price and suggested selling price, shortlist, "request a product"), Payment (automatic payouts; each order shows selling price, collected, purchase price, shipping, COD charge, processing fee, call-centre charge and profit) |
| Addons | Facebook Pixel, Fake order protection, Google Tag Manager, Google Ads, Instant sales booster, Boneek AI calling, Boneek SMS, Progressive web app (PWA), Boneek call centre, Boneek inbox (Messenger, Instagram and WhatsApp in one place; "coming soon") |
| Online store (opens its own full-screen mode with "Back to dashboard") | Preference, Page, Menu, Website design (Themes, Header, Home page, Footer, Product page, Page builder), Shipping method (Shipping zones, Shipping classes), Payment method, Domain, Media library, Code snippet |
| Learning center | 11 tutorial videos (couriers, orders, inventory, products, domains, dropshipping, Meta Pixel and so on) |
| Settings (its own mode) | Business settings, Branch management, Staff management, Roles & permissions, Prefix settings, Subscriptions, Payments, Packages, Delivery partners, WooCommerce |

A **support chat** bubble shows on every screen.

### Details worth noting

- **Order list:**
  - status tabs with counts (All, Pending, Approved, Ready to ship, In transit, Delivered, and "Others ▾" for Cancelled, Returned and Trashed)
  - filter, search, sort, a column picker and page size
  - a warning icon on risky rows and an eye icon for a quick view
  - "More actions" offers Duplicate order
- **Order detail:**
  - Header: order number, source, payment and status badges, placed time, courier, the shopper's IP address, and previous/next order arrows.
  - Print menu: invoice only.
  - More action: Cancel order, Block phone number, Move to trash.
  - Main column: the items, which you can edit, add to and give a per-line custom discount; a **split primary button** for the next step ("Send to supplier ▾", which also offers Mark as pending, Cancel or Hold); payment details (edit shipping, apply discount, paid, due, VAT).
  - **Timeline** with staff-only comments. It recorded "shipping address was rewritten by AI".
  - Right column: **Courier score** card (total orders and delivery success rate, e.g. 83%), customer info with copy buttons, shipping and billing address, customer tag, note, and order attribution.
- **Order statuses:** Pending, Approved, Follow up, Hold, Send to supplier, Ready to ship, In transit, Delivered, Cancelled, Returned, Trashed. Return window in days is a setting.
- **Product form:**
  - title, URL handle, rich-text description plus a short description, media (upload or pick from the library)
  - selling price, cost per item, discount price
  - "variable product" switch using shared Variations (attributes)
  - inventory, "continue selling when out of stock", stock alert quantity
  - weight, quick weight buttons, shipping class, length, width and height
  - status (Published, Draft, Archived, Trashed), publishing channel
  - category, brand, unit, product code, SKU
- **Create order:** product search or browse, a customer search that can create a new customer, shipping charge, discount, paid and due amounts, VAT, note, source, and "Save as draft".
- **Fake order protection** (add-on): limits orders per phone within X hours, per IP, and **per device**; a phone blocklist.
- **Instant sales booster** (add-on): **volume and quantity-break offers** on the product page.
  - Options like "1 piece ৳789 / 2 pieces ৳1,500 / 4 pieces ৳2,800 / 6 pieces ৳3,900".
  - Each option has a label, a badge ("Hot deal", "Best deal", "Family pack") and a default choice, and can pick a colour per piece.
  - Applies to one product, some categories or all products, with active dates and a **live preview**.
- **AI calling** (add-on): "rings your customer, confirms the order in Bangla, and writes the answer back onto the order."
- **Store preference:**
  - title, tagline, description with a Google result preview
  - primary, secondary and text colours, 14 fonts, favicon, Facebook share image
  - switches for public visibility, search engine visibility, **maintenance mode**, cart sidebar, breadcrumbs and back-to-top
- **Themes:** 2 ("Classic" and "Bazaar").
- **Store design screens:**
  - Header, Home page, Footer and Product page are simple forms with a **live preview** beside them (slider with autoplay, featured products, footer columns, social links).
  - Product page buttons: cart, Buy now, WhatsApp, Call.
  - The page builder offers home designs, landing pages, content pages and **saved designs**.
- **Payment methods:** just named, manual methods (only COD in this store). **We saw no online gateway** (bKash, SSLCommerz and so on) anywhere in the store or settings.
- **Delivery partners:**
  - Steadfast, Pathao, Forces Courier, or Custom
  - a pickup branch for each partner
  - each partner has its own charges for inside Dhaka, outside Dhaka and suburbs, regular and express
- **Prefix settings:** separate number prefixes for products, stock transfers, purchases, purchase returns, orders, order returns and replacements.
- **Business settings:** VAT %, currency precision, quantity precision, return window, staff order pick limit, and a separate invoice logo.
- **Packages:**
  - Growth 1 year: **৳29,900**. Includes 2,500 orders a day, 5,000 a month, 60,000 a year, unlimited products, **5 staff, 1 branch**.
  - Growth 6 months: **৳19,800**. Includes 1,000 orders a day, 2,000 a month, 2 staff, 1 branch.
  - Subscription history and payment receipts are on their own screens.
- **WooCommerce:** three "Sync now" buttons (categories, then products, then orders), API settings and an import history. Nothing for customers, passwords, URLs or redirects.

### Their storefront (the merchant's live store)

- **Home page:** a clean, Shopify-like header and a full-width hero.
- **Product page:**
  - the volume-offer options
  - a black "Buy now" button and a green "Chat on WhatsApp" button
  - a back-to-top button
  - **No cart button** on this store.
- **Checkout:**
  - one page: full name, mobile number, **one free-text address box**, inside/outside Dhaka shipping, COD, Place order
  - labels in **English**, no coupon field
  - the free-text address is why they need "AI address rewrite"
- **Weight.** One visit, measured in the browser: the product page loaded **35 of Boneek's own JavaScript files, about 307 KB compressed**.
  - Built on Next.js (`<meta name="generator" content="Boneek CMS">`).
  - Our product-page budget is **30 KB**, so roughly 10× lighter.
  - The page also loads GTM, Google Ads and Clarity because the merchant added them. Those aren't counted in the 307 KB.

---

## 3. Feature comparison

Key: **Yes** = built. **Partly** = some of it. **Planned (NN)** = in our roadmap at phase NN. **No** = not built and not planned.

### Selling and orders

| Feature | Boneek | Ecomm BD |
|---|---|---|
| Order list with status tabs, filters, bulk actions | Yes | Yes (bulk print and bulk courier booking) |
| Status counts as tabs across the top | Yes | Partly (a status filter, not count tabs) |
| Follow-up and Hold statuses | Yes | Partly ("call later" snooze and "no answer" in the queue; no Hold status) |
| Call-confirmation queue (call, confirm, snooze, duplicate warning) | Partly (staff "pick" orders) | **Yes**, deeper |
| Staff pick limits and per-staff follow-up report | Yes | No |
| Manual / phone order | Yes | Yes (with channel: Messenger, WhatsApp, phone, walk-in) |
| Draft orders | Yes | No |
| Duplicate an order | Yes | No |
| Edit order items, prices, per-line discount | Yes | Yes |
| Staff-only comments on the order timeline | Yes | Partly (internal notes on the customer, history on the order) |
| Previous/next order arrows on detail | Yes | No |
| Incomplete (abandoned) orders | Yes | **Yes**, plus reminder SMS and convert to order |
| Order returns screen, return window | Yes | Planned (37) |
| Replacements | Yes (dropshipping) | No |
| Courier success score on each order | **Yes** | Planned (37) |
| AI fixes a messy address | Yes | Not needed for most orders: we use a district → thana picker. Pathao address matching exists |
| Block a phone from the order | Yes | Yes (block list, phone or IP) |
| Order attribution (ad source) | Yes | **Yes**, plus orders by campaign and sales page |
| Invoice printing | Invoice only | **A4/A5 invoice, packing slip, 80 mm receipt, stickers, barcodes, bulk** |
| Number prefixes | 7 kinds | Order prefix only |
| VAT on orders | Yes (%) | No |

### Fraud and confirmation

| Feature | Boneek | Ecomm BD |
|---|---|---|
| Orders per phone per time window | Yes | Yes |
| Per IP | Yes | Yes (rate limits, IP block) |
| Per device | **Yes** | No |
| Phone blocklist | Yes | Yes |
| COD OTP by SMS | Add-on (Boneek SMS) | **Yes**, built in (off, every order, first-time or risky) |
| Risk score with reasons | No (only a warning icon) | **Yes** |
| Ask risky orders for an advance | No | **Yes** |
| Customer tags (Fraud, VIP…) | Yes | No |
| AI voice call to confirm COD orders | **Add-on** | No |
| Boneek's call centre confirms for you | **Add-on** | No |

### Products and stock

| Feature | Boneek | Ecomm BD |
|---|---|---|
| Products, categories, SEO fields | Yes | Yes (Bangla and English text) |
| Variations | Shared attributes, several per product | One kind of variation per product |
| Cost per item, profit | Yes | No (no cost field anywhere in the code) |
| Discount (old) price | Yes | Yes |
| Stock alert quantity | Yes | Partly (low-stock filter); alerts planned (35) |
| Continue selling when out of stock | Yes | Partly (pre-order per variant) |
| Brands | Yes | Candidate (roadmap "Candidate features") |
| Units (piece, kg…) | Yes | No |
| Shipping classes, dimensions | Yes | Partly (weight surcharge, delivery charge per product, free delivery per category) |
| Media library | Yes | No |
| Branches and stock transfers | Yes | No |
| Product draft, archive, trash | Yes | Partly (hidden flag, delete) |
| Product reviews | Not seen | Planned (35) |
| Bulk edit and CSV import/export | Not seen | Planned (35) |

### Money (back office)

| Feature | Boneek | Ecomm BD |
|---|---|---|
| Purchases from suppliers, purchase returns, suppliers | **Yes** | No |
| Cash and bank accounts with balances and transactions | **Yes** | No |
| Expenses and expense heads | **Yes** | No |
| Profit and loss report | **Yes** | Planned, reports (41) |
| Verify manual bKash/Nagad/Rocket payments | No | **Yes** |
| COD reconciliation with couriers | Not seen | Planned (37) |

### Dropshipping (out of scope)

Boneek has a supplier catalogue with buying and suggested prices, "send to supplier", replacements, and automatic payouts with a per-order breakdown. We decided not to offer dropshipping, so none of this is planned.

### Storefront and checkout

| Feature | Boneek | Ecomm BD |
|---|---|---|
| Themes | 2 | 2 |
| Editing the home page | Simple forms with live preview, plus a page builder | **Section editor**: 27 section types, starter templates, saved sections, undo/redo, phone and computer preview, share-preview link, draft and publish, version history |
| Landing / sales pages | Yes (page builder) | **Yes**: 12 product-type templates, packs, order bump, sticky order bar, thank-you redirect, orders per page |
| Volume / quantity-break offer on the product page | **Yes** | Partly (packs on sales pages only) |
| Buy now, WhatsApp and Call buttons on the product page | Yes | Yes (floating WhatsApp, Messenger and call button) |
| Cart sidebar, breadcrumbs, back to top | Yes (switches) | Yes (slide-out cart, breadcrumbs) |
| Maintenance mode, hide from Google | **Yes** | No |
| Custom head and body code | Yes | Planned (35) |
| Checkout address | Free text | **District → thana** |
| Checkout in Bangla | No (English labels) | **Yes** |
| Online payments (bKash, SSLCommerz) | Not seen | **Yes** |
| Manual MFS with transaction ID | Not seen | **Yes** |
| Partial advance (delivery charge or %) | No | **Yes** |
| Coupon field | No | Planned (35) |
| Order tracking page for shoppers | Not seen | **Yes** (`/track`, tracking link) |
| Customer login | Not seen | Planned (34) |
| SEO: JSON-LD, hreflang, sitemaps, slug history, 301s | Basic (title, description, preview) | **Yes** |
| Install as a phone app (PWA) | Add-on | Planned, mobile admin (48); no storefront PWA |
| JavaScript weight | ~307 KB own JS on a product page | ≤30 KB budget |

### Marketing and integrations

| Feature | Boneek | Ecomm BD |
|---|---|---|
| Meta Pixel | Add-on | **Pixel and Conversions API**: you choose whether Purchase is sent at placed, confirmed or delivered; event log |
| Google Tag Manager, Google Ads | Add-on | Planned (36) |
| SMS to customers | Add-on (Boneek SMS) | Yes, but no provider connected yet; a central gateway is planned (38) |
| Shared inbox (Messenger, Instagram, WhatsApp) | "Coming soon" | No |
| Couriers | Steadfast, Pathao, Forces, Custom | Steadfast, Pathao, "booked by hand"; RedX planned (37) |

### Account, staff, help

| Feature | Boneek | Ecomm BD |
|---|---|---|
| Staff, roles (179 separate permissions), activity log | **Yes** | Planned (32); roles already defined |
| Several stores under one login | **Yes** | No (one isolated site per store) |
| Self-serve plans, renewals, receipts | **Yes** | Planned (39) |
| Free subdomain and custom domain, self-serve | **Yes** | Planned (24, 40) |
| Global search (Ctrl+K) | **Yes** | No |
| Notifications | **Yes** | No |
| Dashboard with chart and date range | **Yes** | Partly (home widgets; dashboard planned) |
| Video learning centre, "How to" next to empty screens | **Yes** | Planned, onboarding (33) |
| Support chat in the admin | **Yes** | No |
| Admin in Bangla | **No** (English only as far as we saw) | **Yes**, with a switch |
| WooCommerce import | Categories, products, orders | **Plus customers, passwords, old URLs with 301s, helper plugin, verification report** |

---

## 4. What Boneek has that we don't (the gaps)

Ranked by how much each one sways a merchant choosing between us. Most already have a home in the roadmap. Section 6 places the rest.

(Dropshipping is left out: it's out of our scope.)

**1. Granular page building.**
- nested flex and grid containers
- 70 elements
- styles for each device (desktop, tablet, phone)
- text editing on the canvas
- a layer tree
- global widgets
- header, footer, category, cart and checkout pages all editable

See [the page builder report](competitor-boneek-page-builder.md).

**2. Back office: purchases, suppliers, accounts, expenses, profit and loss.** Owners want to see "did I make money this month". Their profit and loss report needs:
- cost per item
- purchases
- expenses

**3. Staff and roles.**
- Staff accounts with roles
- An activity log
- Per-staff call queues ("pick" orders, pick limit) and a staff follow-up report

Every store with call staff needs these. Planned in phase 32; the pick queue and staff report are extra.

**4. Courier success score on every order.** Bangladesh sellers check this before confirming. Planned in phase 37; consider pulling it earlier.

**5. Volume offers on the product page.** For example "1 piece / 2 pieces / 4 pieces", with badges, a default choice and a colour per piece. This is how BD Facebook stores lift order value. We have packs only on sales pages.

**6. Paid services to cut fake orders.** AI calling, a call centre and SMS, sold as add-ons. That's revenue for Boneek and saved work for the merchant. **Our plan:** offer these ourselves or with partners, as built-in paid options, without an add-on store.

**7. Admin comforts.**
- global search
- notifications
- a dashboard with a sales chart
- status count tabs
- previous/next order arrows
- duplicate order
- draft orders
- staff comments on the timeline
- customer tags
- a learning centre with videos
- support chat

**8. Product and stock depth.**
- shared variations (several attributes per product)
- cost per item
- units
- brands
- shipping classes and dimensions
- stock alert quantity
- a media library
- draft, archive and trash statuses
- branches and stock transfers

**9. Store controls.**
- maintenance mode
- hide from Google
- custom code snippets
- a live preview beside each settings form

**10. Self-serve platform.**
- signup
- several stores under one login
- plans and receipts
- domains

Planned in phases 24 and 39–40.

**11. Small things:**
- VAT %
- more number prefixes
- a separate invoice logo
- a return window
- a "your own courier" option with its own charges
- Forces Courier
- a device-based order limit

---

## 5. Where we're ahead (use these in sales)

1. **Bangla everywhere.** Their admin and checkout labels are English; ours are Bangla and English, with Bangla digits.
2. **Clean addresses at the source.** Our district → thana picker sends couriers correct addresses. Boneek takes free text and needs AI to tidy it.
3. **Real payments.**
   - bKash and SSLCommerz checkout
   - manual bKash/Nagad/Rocket with transaction-ID checks
   - partial advance for risky or outside-Dhaka orders
   - Boneek showed COD only.
4. **Fake orders stopped before they cost money.** COD OTP, a risk score with reasons, and advance payment for risky orders, all built in. Boneek limits repeat orders and sells SMS OTP as an add-on.
5. **Call-confirmation queue.**
   - tap to call, no-answer, call later
   - a "someone is already calling" marker
   - duplicate warnings
   - auto-cancel of unreachable orders
6. **Delivery-charge rules.**
   - Dhaka, suburbs, Chattogram, outside Dhaka
   - overrides for each district and thana
   - free-delivery threshold, COD fee, express, store pickup
7. **Printing.** Invoice, packing slip, 80 mm receipt and stickers in bulk, with barcodes. Boneek prints an invoice only.
8. **Sales pages built for BD products.** 12 templates (ghee and honey, dates, perfume, fashion sizes, gadgets and so on), packs, order bump, and campaign tracking per page.
9. **Meta Conversions API** with a choice of when Purchase is sent, and an event log. That means better ad results.
10. **Speed.** About 10× less JavaScript on the product page, plus Varnish caching. On slow mobile data that means more completed orders.
11. **SEO.** Structured data, hreflang, sitemaps and slug history. Old WooCommerce URLs keep working through 301 redirects.
12. **WooCommerce migration.** Customers, passwords, old URLs and a verification report. Boneek copies categories, products and orders only.
13. **No order caps.** Boneek's ৳29,900 a year plan stops at 5,000 orders a month, 5 staff and 1 branch. Our pricing isn't set yet (phase 39). Not capping orders is a strong message.
14. **Shopper order tracking page** and a deeper page editor (version history, share preview, undo/redo).

---

## 6. Proposal: where each gap goes

**Added to the roadmap on 2026-11-14:** [M10](../roadmap/m10-back-office.md), [M11](../roadmap/m11-page-builder.md) and [M12](../roadmap/m12-services-redesign.md), plus the extra items in phases 32, 33, 35, 37, 41 and 48. Most gaps already fit an existing phase. The rest need new phases, grouped here as three new milestones after M9, with "pull earlier" suggestions.

**Scope decisions applied:**
- no dropshipping
- the back office is in
- paid services are offered by us or partners
- no add-on store

### Fold into phases we already have

| Gap | Phase | Change |
|---|---|---|
| Staff, roles, activity log | 32 | Add staff "pick" queues with a pick limit and a per-staff follow-up report |
| Learning centre videos, "How to" on empty screens | 33 | Add a video slot to empty states |
| Customer tags, draft orders, duplicate order, stock alert quantity, custom code, product draft/archive | 35 | Add customer tags, draft orders and duplicate order to the list |
| Volume offers on the product page | 35 (or 44) | Reuse sales-page packs as a product-page section with badges and a default option |
| GTM, Google Ads | 36 | Already planned |
| Courier score, returns, return window, replacements, "own courier", Forces Courier | 37 | **Pull the courier score earlier**: it's a selling point in demos |
| Plans, receipts, several stores under one login | 39–40 | Add a store switcher if one owner has several stores |
| Profit and loss | 41 | Needs cost per item (below) |
| Storefront PWA | 48 | Add "install the store" alongside the mobile admin |

### New milestone M10 · Back office (after M8, or before it if pilot merchants need it)

| New phase | What |
|---|---|
| 51 · Cost and profit | Cost per item on products and variants; profit on orders; feeds phase 41 |
| 52 · Purchases and suppliers | Suppliers, purchases (adding stock), purchase returns |
| 53 · Accounts and expenses | Cash and bank accounts, transactions, expenses with expense heads; the profit and loss report |
| 54 · Branches and stock transfers | Several stock locations (Vendure has stock locations built in), transfers, a pickup branch per courier |
| 55 · Product depth | Shared variations (several attributes), units, brands (already a candidate), shipping classes with dimensions, media library |

### New milestone M11 · Page builder v2

Phases 56–62. The full map is in [the page builder report, section 6](competitor-boneek-page-builder.md#6-feature-map-boneek-capability--our-plan).

| New phase | What |
|---|---|
| 56 · Element tree and containers | Sections become trees of elements; flex and grid containers; structure presets; basic elements; all current sections migrated |
| 57 · Responsive style system | Desktop, tablet and phone values for every style; full typography including Bangla fonts; 4-side spacing; gradient, shadow, border; flex sizing; copy and paste design |
| 58 · Canvas editing | Click to select, inline text editing, drag onto the canvas, Navigator tree, move component, shortcuts |
| 59 · Library and templates | 60+ ready sections by store type, store and page designs, 30+ sales templates, page templates, global (linked) widgets |
| 60 · System pages | Header and footer, product page with a movable product block, category, all-products, cart, checkout and thank-you layouts |
| 61 · Element library to 70+ | Promotion, commerce, media and trust elements, each with its own small script only when needed |
| 62 · Publish quality | Pre-publish checklist (phone layout, accessibility, links, Bangla fonts), guided tour, saved styles |

### New milestone M12 · Services and admin redesign

| New phase | What |
|---|---|
| 63 · Admin redesign | Section 7 below: new shell, global search, notifications, dashboard with chart, order list tabs, order detail layout |
| 64 · Store controls | Maintenance mode, hide from Google, live preview beside settings forms, VAT %, more number prefixes, invoice logo |
| 65 · Confirmation services, part 1 | Device-based order limit; AI address cleanup for free-text imports |
| 66 · Confirmation services, part 2 (paid) | **Our own** AI voice confirmation in Bangla, and a call-centre service (ours or a partner's), sold as paid options inside normal settings. Result written back to the order; billed through phase 39 credits |

**Not planned:** dropshipping, and an add-on store or marketplace.

**Suggested order:**
- Pull **63 (admin redesign)** and the **courier score** forward to before the pilot. They are cheap and change how the product feels in a demo.
- Start **59 (templates)** early: it's mostly content.
- Then 32, 51–53, 56–58, and the rest in roadmap order.

---

## 7. Admin redesign suggestions (from what works in Boneek)

Our admin today:
- slate background with a teal accent
- a 256 px sidebar of grouped links
- a white top bar with only the language switch and sign-out
- content in a centred 5xl-wide column

Boneek's admin feels calmer and more "Shopify". What to take:

**Shell**
1. **Dark top bar.** Logo on the left, a **global search** box in the middle (Ctrl+K / ⌘K) that finds screens, actions, orders by number or phone, and products. The **notifications** bell, store name and avatar menu on the right.
2. **Sidebar shows one group open at a time.** Top-level items with small icons; the active group expands to show its submenu with a thin connector line. Our long grouped list becomes about 10 top-level items.
3. **Separate "modes" for the online store and settings.** Each gets its own left nav with "← Back to dashboard". We already do this for the theme editor; extend it to all store and settings screens. That shortens our long Settings group.
4. **Neutral palette.**
   - very light grey page, white cards with a light border, near-black primary buttons
   - colour only for status badges
   - teal stays as the brand accent at most
   - wider content (full width with comfortable padding, not a 5xl column) so tables fit
5. **Plan badge** in the settings nav (plan and days left) once billing exists.

**Screens**

6. **Dashboard.**
   - a date-range button and Refresh
   - 4 KPI tiles: sales, orders, items, average order value
   - a sales line chart
   - 8 status tiles that link to the filtered order list
   - recent orders
   - help videos
   - our "waiting for confirmation" widgets fit straight in
7. **Order list.**
   - status **tabs with counts** across the top, with rarely used statuses under "Others ▾"
   - an icon row for search, sort, columns and page size
   - a risk icon beside the status
   - an eye icon for a quick preview
8. **Order detail.**
   - **Header:** number with source, payment and status badges; placed time, courier and IP; previous/next arrows; Print ▾ and More ▾ menus.
   - **Main column:** items, then **one primary "next step" button** with a split menu (Confirm ▾ / Pack ▾ / Book courier ▾), then payment, then a **timeline with a staff comment box**.
   - **Right column cards:** courier score, risk, customer (copy buttons for phone and address), tags, note, attribution.
9. **Forms with a live preview** beside them, as in their Header, Footer and volume-offer screens.
10. **Empty states** with one clear action and a short "How to" video. Their purchase and courier screens do this well.
11. **Quick-weight buttons and inline "+ add"** beside the category and brand pickers on the product form, so you never leave the form.

**Keep our edge while redesigning:**
- Bangla first; check long Bangla labels in the sidebar and tabs
- phone-friendly (we did not check Boneek on a phone)
- keyboard shortcuts in the confirmation queue

---

## 8. Questions to settle

**Decided (14 November 2026):**
- Dropshipping is out.
- The back office is in.
- Paid services are offered by us or partners.
- No add-on store.

**Still open:**
1. **This merchant.** Their Boneek orders are all dropshipping. What will they sell on our platform: their own stock, or a supplier they deal with directly?
2. **Paid services.** For AI calling, do we build our own voice agent or resell a provider's? Which call-centre partner? How do we price it (per call, or credits)? Boneek's prices weren't visible without starting an install.
3. **Pricing.** Boneek charges ৳29,900 a year with caps (5,000 orders a month, 5 staff, 1 branch). Feed this into the plans decision (phase 39).
4. **Pull earlier?** Should the admin redesign, the courier score and the template catalogue move ahead of the pilot?

---

## 9. How Boneek is built (from outside)

**Question:** did they build it from scratch, or customise someone else's code (for example a CodeCanyon script)?

**Evidence**, from the public JavaScript their pages load and the requests they make. Nothing private was accessed.

| Signal | What it shows |
|---|---|
| Admin and storefront are **Next.js 16.2.12** (Turbopack build); the storefront says `generator: Boneek CMS` | A very recent React front end, built in the last few months. CodeCanyon e-commerce scripts are almost always Laravel Blade with jQuery or Vue, not current Next.js |
| `app.boneek.net/api/broadcasting/auth`, the `laravel-echo` client reading `window.Laravel.csrfToken`, Pusher/Reverb strings | The **back end is Laravel**, using Laravel Reverb or Pusher for live notifications |
| The page builder is one ~258 KB chunk with its own widget names (`studio_widget`, `commerce_content`, `hero_slider`, `card_grid`…) and uses **@dnd-kit** (an open-source drag-and-drop library) | A **custom builder**. There's no trace of GrapesJS, Craft.js, Puck, Builder.io or Elementor |
| Templates labelled "Adapted from your previous builder" / "Your original builder" | They **rebuilt the builder themselves once** and migrated the old designs |
| No Envato, CodeCanyon or ThemeForest licence strings in any loaded file | No sign of a bought script on the front end |
| Every add-on is "By: Boneek" (or a Meta/Google integration) with its own hand-made settings screen (fake-order limits, the sales-booster editor with live preview, AI-calling setup). There's no upload or install of third-party code | The "add-on system" is **feature switches for their own modules**, not a plugin platform or a marketplace |
| Deep Bangladesh-specific pieces: Steadfast, Pathao and Forces Courier, courier score, AI address rewrite, Bangla AI calling | Product work aimed at this market, not a generic script |

**Our read:**
- **The front end, the page builder and the add-ons are almost certainly built in-house.** The code is too new, too consistent and too BD-specific for a reskinned marketplace script.
- **The Laravel back end can't be judged from outside.**
  - One hint: its back-office modules match the usual Laravel POS/inventory module set seen on marketplaces (units, brands, branches, stock transfers, purchase returns, expense heads, number prefixes, currency and quantity precision, subscription packages).
  - That pattern fits a team that **began from an inventory/POS base and built the commerce and builder layers on top**. It's only a pattern, not proof.
  - Only their server code would settle it.

**What it means for us:** they ship fast with a sizeable team and have already rewritten their builder once. Our edges are structural and hard for them to copy quickly:
- speed (their Next.js storefront is about 10× heavier)
- a single editor with version history
- Bangla-first
- district → thana addresses
- online payments
- WooCommerce migration depth
