# MVP Feature Spec

> Working name: **ecommbd** · Status: draft · Last updated: 2026-10-20
> Motto: *Fastest ecommerce website in BD. All in one web.*

## 1. What we're building

A hosted ecommerce platform for Bangladesh. Merchants sign up, get a fast store, and never install, update or secure anything themselves. Everything a typical BD WooCommerce store bolts on with 10–15 plugins is built in.

**Hosting model:** every store runs as its own isolated site with its own database on our CloudPanel servers. Merchants own their data and can export all of it at any time. The software stays with us, and we update every store ourselves.

**Target merchant (validate in interviews):** runs WooCommerce today, gets most orders from Facebook ads, mostly cash on delivery (COD), 1–500 products, a few to a few hundred orders a day, confirms orders by phone, ships with Steadfast / Pathao / RedX.

**Why they switch:**

- **Hacks, nulled plugins, broken updates** → we host one version for every store and patch it ourselves.
- **Slow sites, even with Redis + Varnish** → speed is built in, measured and published.
- **A plugin pile for basic BD needs** → couriers, bKash, fraud check, Meta Conversions API and landing pages are native.
- **Fear of moving** → WooCommerce migration that keeps URLs, customers and order history.
- **Not wanting to be locked into a platform like Shopify** → each store is its own isolated site with its own database, and merchants can export all their data at any time.

## 2. MVP success criteria

The MVP is done when a pilot merchant has been migrated from WooCommerce and has taken real orders on the platform for 30 days, and:

| Area | Target |
|---|---|
| Storefront speed | LCP ≤ 1.5 s at p75 on mobile; first-party JS ≤ 30 KB gzipped on product pages |
| Migration | A store with ≤ 500 products and ≤ 20,000 orders imports unattended in under 1 hour |
| Tracking | Meta Event Match Quality "Good" or better on Purchase |
| Updates | One command rolls a release to every store; a store that fails its health check rolls back automatically |
| Operations | The merchant never touches a server, plugin or update |

## 3. Users

- **Owner** — often non-technical, Bangla-first, works from a phone.
- **Order staff** — confirms orders by phone, books couriers, prints invoices and stickers.
- **Shopper** — arrives from a Facebook ad on a mid-range Android phone, checks out with name, phone and address, pays cash on delivery.

## 4. Features

**P0** = needed for the pilot store · **P1** = needed before public launch · **P2** = after launch

### 4.1 Store setup & platform

| Feature | Priority | Notes |
|---|---|---|
| Sign up, create store, free subdomain | P0 | `{store}.<platform-domain>` |
| Custom domain with automatic SSL | P0 | Merchant adds one CNAME record |
| Storefront in Bangla and English | P0 | |
| Bangladesh defaults for every new store: BDT currency, Bangladesh as the country, Bangla + English, inside/outside Dhaka shipping zones, tax setup | P0 | Vendure's default store starts in USD and English with no countries, zones or tax |
| Merchant dashboard: Vendure's Dashboard, extended with our BD pages (order confirmation, couriers, incomplete orders) | P0 | English for the pilot |
| Dashboard in Bangla: translation of Vendure's Dashboard and our pages | P1 | |
| Staff accounts with roles (owner, manager, order staff) | P1 | Owner only in P0 |
| Subscription billing (bKash / card) | P1 | |
| Merchant data export (CSV / JSON) | P1 | Answers the lock-in fear |
| Backups, uptime, security patches | P0 | Platform responsibility, not a merchant setting |

### 4.2 Catalog

| Feature | Priority | Notes |
|---|---|---|
| Simple and variable products (size, colour, weight…), SKU, stock, sale price, gallery, rich description | P0 | |
| Automatic image compression: every upload converted to WebP in several sizes | P0 | Also applied to migrated images |
| Categories and tags | P0 | |
| Search and filters (category, price, attributes) | P0 | Replaces product-filter |
| SEO title/description, clean URLs, sitemap | P0 | |
| Bulk edit, CSV import/export | P1 | |
| Product reviews | P1 | Imported from WooCommerce |

### 4.3 Storefront & landing pages

| Feature | Priority | Notes |
|---|---|---|
| Fast mobile-first themes (2 to start) with settings: logo, colours, fonts, menus | P0 | No code editing |
| Landing page builder with sections: hero, benefits, video, testimonials, FAQ, countdown, **embedded checkout** | P0 | Replaces Elementor + CartFlows |
| Buy Now (straight to checkout) and slide-out cart | P0 | Replaces Buy-Now button, modern-cart |
| WhatsApp / Messenger / call floating button | P0 | Replaces chaty |
| Static pages (about, policies) and menus | P0 | |
| Custom head/footer scripts | P1 | Loaded deferred; dashboard warns about speed cost |
| Blog | P2 | |

### 4.4 Checkout

| Feature | Priority | Notes |
|---|---|---|
| One-page checkout: name, phone, address (district → thana), note; no account needed | P0 | |
| BD phone number validation | P0 | |
| Shipping rates: inside/outside Dhaka, per district, free-shipping threshold | P0 | Replaces custom-shipping-methods |
| Incomplete orders: save name, phone and cart as soon as the phone is typed; list with call / SMS / convert-to-order | P0 | Replaces woo-cart-abandonment-recovery |
| Coupons (fixed, %, free shipping, minimum order) | P1 | |
| Order bump (checkbox add-on at checkout) | P1 | CartFlows Pro feature |
| Optional OTP verification for COD orders | P1 | Per-store setting; costs SMS |
| One-click post-purchase upsell | P2 | |

### 4.5 Payments

Every gateway follows the same setup: paste credentials → **Test connection** → toggle on.

| Feature | Priority | Notes |
|---|---|---|
| Cash on delivery | P0 | |
| SSLCommerz (cards, bKash, Nagad, Rocket, net banking through one integration) | P0 | Covers most methods with one integration |
| Manual bKash / Nagad: shopper sends money to the merchant's number and enters the TrxID; staff verifies | P0 | For merchants without a gateway account |
| Partial advance: delivery charge or fixed amount online, rest COD | P1 | Cuts fake orders |
| bKash tokenized checkout (direct) | P1 | Better checkout and fees than via an aggregator |
| Nagad direct, aamarPay, ShurjoPay | P2 | |
| Refunds through gateway APIs | P2 | |
| Platform-level payments (online payments on day one, no gateway paperwork) | Later | Needs a Bangladesh Bank compliance review |

### 4.6 Orders & fulfilment

| Feature | Priority | Notes |
|---|---|---|
| Order list with BD statuses: New → Confirmed → Packed → Shipped → Delivered / Returned / Cancelled; search by phone | P0 | |
| Confirmation workflow: tap to call, confirm/cancel with reason, internal notes | P0 | |
| Manual order entry (orders from Messenger / phone) | P0 | |
| Bulk invoice and sticker printing | P0 | |
| Courier booking with automatic status sync: Steadfast, Pathao | P0 | |
| RedX | P1 | Paperfly, eCourier etc. in P2 |
| COD fraud check: delivery success rate by phone number (courier data + history across our platform) | P1 | Cross-store history shown only as a score |
| Block list (phone / IP) | P1 | |
| Stock deduction | P0 | |
| Low-stock alerts | P1 | |

### 4.7 Customers & notifications

| Feature | Priority | Notes |
|---|---|---|
| Customer list keyed by phone: orders, total spent, returns, notes | P0 | |
| SMS on order received, confirmed, shipped (with tracking link); Bangla templates | P0 | Merchant buys SMS credits |
| Customer login (phone OTP or password) | P1 | Migrated customers keep their WordPress passwords |

### 4.8 Tracking & marketing

| Feature | Priority | Notes |
|---|---|---|
| Meta Pixel + Conversions API built in: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase, deduplicated | P0 | Replaces PixelYourSite |
| **Purchase trigger setting: when placed / when confirmed / when delivered** | P0 | Stops fake COD orders from training the ad algorithm |
| Event log: what was sent to Meta and Meta's response | P1 | |
| Meta catalog product feed (dynamic ads) | P1 | |
| GA4, TikTok Pixel + Events API, Google Tag Manager | P1 | |
| Abandoned checkout SMS | P2 | |

### 4.9 WooCommerce migration

| Feature | Priority | Notes |
|---|---|---|
| Connect via a small WordPress helper plugin (primary) or WooCommerce API keys (fallback) | P0 | |
| Import products (variations, attributes, images), categories, tags, customers, orders | P0 | |
| Import coupons, reviews, Yoast / RankMath SEO fields, Meta Pixel ID | P1 | |
| Keep WooCommerce URLs working (`/product/{slug}/`, `/product-category/{slug}/`), 301 redirects for the rest | P0 | Protects Google rankings |
| Customers keep their passwords (WordPress hashes verified on first login) | P1 | Needs the helper plugin |
| Dry run with report → import → final catch-up sync just before the domain switch | P0 | No lost orders |
| Self-serve migration wizard in the dashboard | P1 | Our team runs pilot migrations by hand |

Not migrated automatically: Elementor / CartFlows page designs, theme customizations, data from other plugins. We offer matching landing page templates instead.

### 4.10 Dashboard & reports

| Feature | Priority | Notes |
|---|---|---|
| Home: today's orders and sales, orders waiting for confirmation, courier status counts | P0 | |
| Reports: sales by day / product, delivery success rate, returns | P1 | |
| Activity log | P1 | |

## 5. Replacing a typical plugin stack

Reference: the plugin folder of a BD food store on WooCommerce.

| Plugin | Replaced by |
|---|---|
| cartflows, cartflows-pro, elementor, pro-elements | Landing page builder with embedded checkout, order bump (4.3, 4.4) |
| Buy-Now-Add-to-Cart-Button-V3, modern-cart | Buy Now, slide-out cart, one-page checkout (4.3, 4.4) |
| woo-cart-abandonment-recovery | Incomplete orders (4.4) |
| pixelyoursite, insert-headers-and-footers | Built-in Pixel + Conversions API, GTM, custom scripts (4.8, 4.3) |
| chaty | Floating chat buttons (4.3) |
| custom-shipping-methods-for-woocommerce | Zone and district shipping rates (4.4) |
| product-filter | Search and filters (4.2) |
| redis-cache, clp-varnish-cache | Not needed: platform caching |
| wpvivid-backuprestore, akismet | Not needed: platform backups and spam protection |
| woocommerce-payments | Not needed: doesn't work in Bangladesh |

## 6. Not in the MVP

- **Plugin / app marketplace** — deliberately; "no plugins" is the pitch. A public API comes later.
- Multi-vendor marketplace, POS, multi-currency, B2B pricing, subscriptions.
- Merchant code editing of themes (custom CSS may come in P2).

## 7. Phases

| Phase | Contents | Done when |
|---|---|---|
| 0 — Foundations | **Done:** engine benchmark, project setup on Vendure (runs locally, on GitHub). **To do:** CI, edge speed test from BD ISPs, server baseline script (PostgreSQL, Redis, Varnish), store provisioning on CloudPanel, release pipeline with rollback, backups | A test store is created, and later updated, with one command each |
| 1 — Pilot | All P0 features | One migrated store live for 30 days |
| 2 — Public launch | All P1 features, self-serve signup and billing | A new merchant goes from signup to first order without our help |
| 3 — Growth | P2 features, platform payments, public API, mobile admin app | — |

## 8. Open questions

- Brand name and domain.
- Pricing and plan limits (orders per month? staff seats?).
- SMS gateway choice and what merchants pay per SMS.
- Hosting and edge: BDIX data center vs Cloudflare vs Singapore — decided by the edge speed test (architecture, Decision 5).
- Platform-level payments: which gateway offers a sub-merchant model, and what Bangladesh Bank requires.
- Privacy terms for the cross-store fraud score.
- Pilot merchants: who are the first 3–5 stores?
- Validating the feature list: collect the plugin folders of 20–30 BD WooCommerce stores (like the reference store in section 5) and interview ~10 merchants about what breaks. Features most stores share stay P0; the rest move down.
