# Research: sales page builder (Elementor-style, made simple)

**What this is.** What Bangladeshi WooCommerce merchants build with Elementor and CartFlows, what Shopify page builders offer beginners, and what that means for our builder (phases 15 and 16). Researched on 2026-10-21. See also the builder in [reference-bd-admin.md](reference-bd-admin.md#sales-pages-landing-page-builder).

## What BD sales pages look like

- Elementor is the most common page builder on Bangladeshi sites, and CartFlows (sales pages with checkout) runs on thousands of BD stores. Its top categories are apparel, health and beauty.
- Real BD sales pages share one layout: a long Bangla page, phone-width, with an **"অর্ডার করুন" (order now) button after almost every section** that jumps to the order form at the bottom.
- Typical order, top to bottom:
  1. Bangla headline with a hero image or video
  2. Photo gallery
  3. 6–8 benefits with icons
  4. A problem or "did you know" section
  5. "Why buy from us": cash on delivery, check before paying, returns
  6. How to use, or how it's made
  7. Customer reviews as screenshots
  8. Price: old price crossed out, offer price, sizes or packs (500 g / 1 kg)
  9. Countdown, then guarantee, then FAQ
  10. Call and WhatsApp buttons
  11. Order form: name, phone, address, − / + quantity, inside or outside Dhaka, cash on delivery; the button shows the total
- Many pages wrongly ask for email, because the checkout, shipping and field-editor plugins are set up separately.

## Sections

**Must have:**
- hero (headline, subheadline, image or video, button, badge such as "15% off")
- gallery
- video
- benefits list
- story or text with image
- trust ("why buy from us", preset items)
- reviews (screenshots, or cards with name, text, stars and photo)
- price and packs
- countdown (fixed or per visitor)
- FAQ
- order form
- call and WhatsApp buttons
- a sticky order bar on phones

**Plain pages also need:** banner, image with text, product grid, contact, rich text.

**Later:**
- order bump and one-click upsell
- A/B tests
- several variants in one order
- comparison table and before/after slider
- size chart
- "someone just ordered" pop-ups
- tabs and pop-ups
- custom HTML
- multi-step funnels

## Style options (keep them few)

- **Each section:**
  - background colour, preset or image
  - light or dark text
  - spacing S / M / L
  - narrow or full width, and alignment
  - hide on phone or on desktop
  - "show order button below"
  - anchor ID
  - one entrance-animation switch. Elementor has 37 animations, which is far more than needed.
- **Each page:**
  - header and footer on or off (sales pages default to a slim bar with logo and phone)
  - main and sale colour
  - a Bangla font pair (Hind Siliguri, Noto Sans Bengali)
  - SEO title, description and share image, and "hide from Google" for ad pages
  - tracking (Pixel and Conversions API, TikTok, GTM), thank-you page, auto-applied coupon

## Templates for BD

| Category | What makes it different |
|---|---|
| Food (ghee, honey, dates, oil, gur) | Purity story, how to spot the real thing, sizes by weight, seasonal offers |
| Herbal and health | Symptoms, dosage, "call the expert", guarantee, review screenshots (honest claims only) |
| Beauty and skin care | Before/after, ingredients, how to use, proof it's genuine |
| Fashion (panjabi, three-piece, borka) | Several products with colour and size, size chart, lifestyle photos |
| Gadgets | Specs, demo video, warranty |
| Baby and kids | Safety points, age range, reviews from mothers |
| Combos and seasonal (Eid, winter) | What's in the bundle, countdown |

## What beginners need from the editor

- Start from a template: pick a category and a product, and the page fills itself with its photos and price.
- Live preview that opens in phone view and can switch to desktop.
- Undo and redo, autosave, version history with restore.
- Duplicate a section or a whole page; drag or up/down arrows to reorder; hide without deleting.
- Preset choices instead of raw numbers.
- Sections saved for reuse, and site-wide styles.
- A shareable preview link and a test-order mode.

## What to avoid (where Elementor is hard)

1. **Free-form layout** (containers, margins) that breaks on phones. We use fixed sections with good phone defaults.
2. **Separate settings per screen size.** We only offer "hide on phone" and "hide on desktop".
3. **Slow pages** from stacking Elementor, Pro, CartFlows and add-ons. Our pages are rendered on the server and stay light.
4. **The order form spread across plugins.** Ours is built in and ready by default, with no email field.
5. **Key blocks behind paid tiers** (form, countdown, sticky bar). Every block a merchant needs is included.

## Sources

- Usage: [wmtips page builders in BD](https://www.wmtips.com/technologies/page-builders/country/bd/) (figure from a search summary; the page was blocked), [StoreLeads: CartFlows in BD](https://storeleads.app/reports/technology/CartFlows%20-%20Funnel%20Builder%20and%20Checkout%20Plugin%20for%20WooCommerce/country/BD)
- BD sales pages: [starlineit](https://landing.starlineit.com/step/checkout-2-10/), [aesthefy](https://aesthefy.com/step/sales-landing/), [uddoktayon ghee](https://landing.uddoktayon.com/step/ghee/), [uddoktayon panjabi](https://landing.uddoktayon.com/step/panjabi/), [uddoktayon fan](https://landing.uddoktayon.com/step/rechargeable-folding-fan/)
- BD templates and builders: [devpro-bd templates](https://devpro-bd.com/product/100-bangla-landing-page-template/), [itmonjil borka](https://itmonjil.com/landingpage-borka/), [Sellsull](https://sellsull.com/), [FrameX](https://framextech.com/), [Zatiq](https://zatiqeasy.com/), [Funnel Liner](https://funnelliner.com/)
- Elementor: [Pro features](https://elementor.com/pro/), [entrance animations](https://elementor.com/help/entrance-animations/), [show or hide per device](https://elementor.com/help/show-or-hide-columns-per-device/), [Capterra reviews](https://www.capterra.com/p/169468/Elementor/reviews/?page=2)
- Funnels: [CartFlows](https://wordpress.org/plugins/cartflows/), [FunnelKit lite vs pro](https://funnelkit.com/lite-vs-pro/)
- Shopify builders: [GemPages](https://apps.shopify.com/gempages), [GemPages library](https://help.gempages.net/articles/new-library), [PageFly](https://apps.shopify.com/pagefly), [Shogun](https://apps.shopify.com/shogun?page=5)
