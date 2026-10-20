# Reference: a simple Bangladeshi store admin

**What this is.** Notes from a working Bangladeshi store that our partner uses as the model for a simple merchant admin. It's a resold template (built with Lovable: a React app with its own small API, behind Cloudflare). We looked at its public pages, its public code files, and its admin with the owner's existing login. Nothing was saved or changed.

Looked at on 2026-10-21. Use this as a checklist of the **fields and options BD merchants expect**, not as a design to copy.

## Admin menu

| Menu | What it does | Our phase |
|---|---|---|
| Dashboard | Order and revenue counts, low stock, last 5 orders | 33 (home widgets) |
| Products → All products, Categories, Reviews | One-page product form; categories with image and icon; reviews | 05, 13, 35 |
| Orders | List, details, edit, send to courier, fraud check | 04, 05, 19, 37 |
| Abandoned orders | Incomplete orders; turn one into an order | 11 |
| Inventory | Stock list | 05 |
| Sales pages | Landing page builder (below) | 16 |
| Pages | About, policies: title, slug, meta description, content | 12, 15 |
| Blogs | Blog posts | 44 |
| Phone order | Staff enter an order taken by phone | 05 |
| Settings | 16 tabs (below) | many |
| Spin wheel | Spin-to-win offer | **Skipped** (our decision) |

## Fields by screen

### Dashboard
- Orders: total, pending, today, last 7 days, last 30 days, abandoned.
- Revenue: today, last 7 days, last 30 days. Total products. Low stock alert.
- The last 5 orders with name, phone, status and total.

### Product form (one page, opens as a dialog)
- Name in English and in Bangla.
- Main image, gallery up to 10 (drag to reorder, 600×600 recommended).
- **Customer feedback images** up to 20: review screenshots shown on the product page.
- Price (৳), old price (৳), stock, category.
- Short description (2–3 lines under the title) and full description (plain text boxes).
- YouTube video link.
- Switches: Featured, New.
- **Delivery for this product:** free delivery switch, or its own inside-Dhaka and outside-Dhaka charges (blank means the store default, e.g. ৳60 / ৳120).
- **Variations** (after the first save): type (size, colour, pack such as "1 piece, 2 pieces", or custom), option name, price, stock, image, default, active.
- **Not there:** SKU, weight, tags, SEO fields, rich text. The partner sees this as a feature: fewer fields.

### Orders
- **Statuses:** Pending, Hold, Confirmed, Processing, Shipped, Delivered, Cancelled.
- **List columns:** order ID, customer, status, **fraud check** (courier delivery success ratio for that phone), total, date, courier, source.
- **Search:** name, phone, order ID. Filter by status.
- **Details:** name, phone, address, thana, district, area, notes, items, shipping, change log.
- **Actions:** edit order (customer, items, price, quantity, shipping, note), process, cancel, **send to courier** (Steadfast or Pathao), print invoice.

### Phone order and incomplete orders
- **Phone order:** name, phone, address, city, custom delivery charge (optional), note, product search, discount; shows subtotal, delivery and total.
- **Incomplete orders:** customer, phone, fraud ratio, cart items, date; **create an order from it** (same form, prefilled), or delete.

### Block list
- Block by **phone or IP address**, with a reason, a block type and an optional end date. Unblock.

### Settings tabs
| Tab | Fields |
|---|---|
| Site | Site name, tagline, browser tab title, logo (image or text), logo height |
| Header | Colour presets, top bar colours or gradient, main header, search bar, category bar, cart badge, scrolling top-bar messages, menu items (Bangla/English label and link, reorder), live desktop and mobile preview |
| Bottom nav | Links in the phone's bottom bar (Home, WhatsApp, Offers, Account) |
| Footer | Phone, email, address, description, social links (Facebook, Instagram, YouTube, TikTok), newsletter text, copyright, developer credit |
| Shipping | Default inside-Dhaka and outside-Dhaka charges; bKash, Nagad and Rocket numbers shown at checkout to copy |
| Duplicate block | On/off; **minutes before the same customer can order again** (1–1,440); message shown; WhatsApp number for blocked customers; support phone on the thank-you page |
| Courier API | Steadfast keys; Pathao keys and store ID; BD Courier key (delivery success ratio) |
| Custom code | Scripts for head and body |
| Users | Roles: admin, moderator, user |
| Block list | As above |
| Product page | Buttons: Add to cart, Order now, WhatsApp (own number), Call (own number); text and colours |
| Home page | Hero slider; product sections (title and category: new, popular, offers, trending, best selling, hot deals); category card colours |
| Invoice | Invoice layout: logo, number, customer, totals, signature |
| Tracking | Meta Pixel + Conversions API (Pixel ID, access token, test code); TikTok Pixel + Events API; send a cancel event to the data layer for GTM |
| Checkout | Show thana and district fields; show coupon field; terms checkbox with two links; page title and subtitle; colours |
| Account | Owner's email and password |

## Sales pages (landing page builder)

### List
Title, link (`/lp/<slug>`), template, product, price, active or inactive. Actions: preview, **duplicate**, open, edit, delete. Counts of total, active and inactive pages.

### Create or edit (one form)
1. Page title and link (slug).
2. **Template:** 15 to pick from, tagged by category: food (4), health (3), fashion (2), gadget (4), beauty (1, perfume/attar), general (1).
3. **Linked product:** its name, price, old price, images and stock fill the page and the order form.
4. **Sections:** switch each on or off and reorder them by dragging. Hero, video, gallery, features ("what you get" list), specifications (label and value), reviews (images or video), contact (call and WhatsApp), extra sections 1–3, checkout.
5. **Hero fields change per template:** for example a badge line, a two-line headline (second line in the accent colour), an offer box, a discount badge ("35% off"), "limited stock" text, a hero video.
6. **Extra sections** can be any of 18 types: text, image + text, bullet list, image grid, banner, gallery, slider, image, video (YouTube/Vimeo), FAQ, divider, custom HTML, testimonial, pricing (offer price, old price, badge, benefit list), countdown (end date and time), feature grid, CTA banner, **comparison** ("without ❌ / with ✅").
7. **Colours:** primary, accent, background, text, headline, button. CTA button text, subheadline, footer text.
8. **Style panel:** page background, page width (480 px mobile to 1,200 px full width), gap between sections, font (Hind Siliguri, Noto Sans Bengali, Tiro Bangla, Inter, system), and colours, borders and corner radius per section.

### What a published page looks like (top to bottom)
1. Hero: headline, badge ("100% organic"), price with old price crossed and "% off", trust icons (free delivery, cash on delivery, guarantee), **Order now** button that scrolls to the form.
2. "What you get" checklist.
3. Contact card: call and WhatsApp buttons, "24/7 service".
4. **Order form on the page:**
   - product with + / − quantity, price, old price, % off
   - name, mobile number, full address, delivery area (inside / outside Dhaka)
   - payment (cash on delivery or bKash), "Have a coupon?"
   - subtotal, delivery charge, total, then **Confirm order**
   - "Pay when you receive the product"
5. A separate thank-you page for landing page orders.

The page is a narrow, phone-width column even on desktop. All text is Bangla.

## What we take, skip and do better

- **Take:** the field lists above, one-page product form, per-product delivery charges, duplicate-order block with a time window, fraud ratio in the orders list, phone orders, orders from incomplete orders, template + product + sections flow for sales pages, the 18 section types (minus HTML), comparison and pricing sections.
- **Skip:** spin wheel; the raw HTML section (unsafe; custom scripts stay a separate, controlled feature in phase 35); editing staff roles by typing a user ID.
- **Do better:** live preview while editing, WebP images, pages that show before JavaScript loads, campaign tracking (UTM, fbclid) on every order, real payment gateways besides "copy our bKash number", backups and WooCommerce import.
