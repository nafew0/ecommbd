# Competitor check: Boneek's page builder

**Checked:** 14 November 2026, in the merchant's Boneek account (`/store/page-builder`).
**Companion to:** [competitor-boneek.md](competitor-boneek.md).
**Our side:** the section editor built in phases 15–16 (`packages/sections`, `apps/admin/src/pages/page-editor.tsx`).

**How it was checked.**
- We opened every panel, tab and dialog.
- To see the container and element settings, we added one Container and one Heading to the home-page **draft**, read their settings, then removed them with Undo. The draft went back to its original two sections, and the Undo button was greyed out again.
- This store's builder has never been published ("Builder off"), so shoppers never saw any of it.
- Nothing was saved or published.

---

## 1. Summary

Boneek's builder is a **real Elementor-style builder**:
- nested containers (flex or grid)
- 70 elements
- separate design settings for desktop, tablet and mobile
- a layer tree (Navigator)
- on-canvas text editing
- a library of reusable pieces

It sits on top of **templates**: 62 ready sections and 54 page designs, filtered by store type. A merchant can start from a template and still change any single heading's letter spacing on mobile.

**Ours today:**
- template-first: 27 section types, 4 starters, 12 sales-page templates
- strong safety features: version history, share-preview link, draft and publish, a strict speed budget
- granular control is limited to one "Custom" section: fixed column presets, 13 flat elements, styles mostly for desktop plus a few phone sizes
- no nesting, no tablet view, no canvas editing
- the header, footer, category, cart and checkout pages can't be edited with sections

**What we recommend:** keep templates as the front door, but rebuild the inside of every section as a tree of elements that the merchant can open up. Add containers (flex and grid) and a full responsive style panel.
- **Render the result as plain HTML and CSS with no JavaScript**, as we do now.
- That gives "Elementor-level control at Shopify speed".
- Boneek can't offer this: its product page already ships about 307 KB of its own JavaScript, against our 30 KB budget.

Section 6 maps every Boneek capability to a planned phase, so that no client can say "Boneek has this and you don't".

---

## 2. How Boneek's builder is put together

### 2.1 Editor shell

**Top bar:**
- back arrow
- "store · page name"
- draft status ("Draft saved · Original design is still showing to shoppers")
- **Desktop / Tablet / Mobile** switch
- **Undo / Redo**
- **"Builder off/on"** switch (builder pages replace the theme pages only after the first publish)
- **Preview (P)**
- **⋯** menu, **Save**, **Publish**

**Under the top bar:** **Expand canvas** and a **zoom readout** ("Fit · 81%").

**Left rail** (icons with labels):
- Add content
- Edit
- Design tools
- Sections (the Navigator)
- Pages
- Templates
- My library
- Edit active header, Edit active footer
- Preview

**Canvas:**
- the real storefront in a browser frame
- **"+ Add section"** buttons between sections
- a name tag on the selected item and a **floating toolbar** (move, up, down, duplicate, delete)
- **double-click any text to edit it in place** (Enter to finish, Esc to cancel)
- an empty container shows **"Add component inside"**

**⋯ menu:**
- Switch pages
- Copy selected widget (⌘C)
- Paste widget (⌘V, also across pages)
- Start from a template
- Restore published design to draft
- Open live page
- Keyboard shortcuts

**Keyboard shortcuts:**
- undo and redo
- save (⌘S)
- copy and paste a widget or layout
- duplicate a section (⌘D)
- Delete
- ↑/↓ to select the previous or next section
- P for preview, Esc
- ? to show the list

The shortcut sheet also teaches the workflow in four steps: choose a template or drag widgets → select to edit content, style and responsive settings → arrange in the Navigator and save reusable pieces → preview and publish.

### 2.2 Add content: three tabs

**Ready sections (62).**
- **Filter by store type:** Electronics, Grocery, General ecommerce, Food store, Footwear, Fashion, Beauty.
- **Filter by category:** Basic, Promotion, Products, Media, Trust.
- **Examples:**
  - per store type: welcome banner, product collection and brand story for each type
  - grocery: campaign slider, offer banner, category cards, best sellers, brand strip
  - heroes: campaign hero, compact hero, two-slide collection hero, centred or editorial banner
  - products: latest-products grid, best-sellers carousel, round categories, new-arrivals carousel, large product cards, three-column collection
  - info bars and tickers: delivery and support, delivery information bar, shopping-benefits ticker, collection ticker
  - FAQs and stories: helpful questions, size & care FAQ, ordering FAQ, how to shop, customer story spotlight, brand facts
  - looks and calls to action: square and portrait lookbooks, dark, soft and inline calls to action
  - a location map, and a long-form brand story
- **Copy on each card:** "Your actual store products. Hand-pick a collection…". Ready sections use the store's own colours and real products.

**Elements (70, searchable).**

| Group | Elements |
|---|---|
| **Basic (20)** | Container, Section, Grid, Spacer, Divider, Heading, Paragraph, Button, Image, Icon, Badge, List, Quote, Icon box, Icon list, Counter, Notice box, Call button, Email button, WhatsApp button |
| **Promotion (19)** | Navbar, Menu, Hero, Features, Bento feature grid, Cost comparison, How it works, Stats/counter, Testimonials, FAQ, CTA banner, Countdown, Form widget, Contact info, Social links, Logo strip, Footer, Accordion, Toggle |
| **Products (23)** | Pricing/package, Product card, Product carousel, Image product card, Order form, Category grid, Brand strip, Floating cart, Announcement bar, Store header, Hero banner, Section title, **live** product card, grid, carousel and gallery, Add-to-cart button, **Landing checkout (live)**, **Product detail (live)**, Cart drawer, Checkout page, Thank-you page, Store footer |
| **Media (5)** | Video, Gallery, Map, HTML embed, Image carousel |
| **Trust (3)** | Star rating, Testimonial card, Social icons |

"(live)" means the element is wired to real catalogue data and the real cart.

**Structure.**
- Choose **Grid** ("structured columns") or **Flexbox** ("flexible rows").
- Then pick a column preset: 1, 2, 3 or 4 columns, 2:1, 1:2, or (flex only) vertical.
- "Columns stack on mobile. You can adjust this in layout settings."

### 2.3 Settings for one element: Content / Design / Advanced

**Every element has:**
- a **"Search all settings"** box and a **Reset** button
- a header that says where the settings are saved ("Selected widget · saved with this layout")
- **Hide**, **Duplicate** and **Delete**

**Content tab** (differs per element):
- **Container:**
  - Layout mode: Flexbox or Grid
  - Flex direction: row, column, row-reverse, column-reverse
  - Grid columns, gap
  - Justify content: start, centre, end, space-between, space-around, space-evenly
  - Align items: stretch, start, centre, end
  - Wrap items, **Stack on mobile**
- **Heading:** text and HTML tag (H1–H6).
- **Hero slider:**
  - content alignment
  - up to 8 slides (image, heading, sub-heading, button label and link)
  - height (small, medium or large, with separate desktop and mobile presets)
  - autoplay and slide duration

**Design tab** (the same groups on every element):
- **Device switch:** Desktop, Tablet, Mobile. "Desktop styles are the base for every screen." There is a counter of explicit settings per device, a reset per device, and **Copy design / Paste design**.
- **"From template / Inherited from your store"** label on every property, so the merchant can see what they've overridden. Colours are chosen from **the store palette swatches** or set freely.
- **Images:** fit (cover, contain, fill, original, scale down) and focus position (9 points).
- **Typography:**
  - font size, weight (300–900), line height, letter spacing
  - **font family**: Inherit, Inter, **Hind Siliguri (Bangla)**, **Noto Sans Bengali**, Georgia, Courier New
  - text transform, colour, alignment
- **Buttons** (on sections):
  - background, text and border colour
  - hover background and hover text colour
  - text size and weight, corner radius, horizontal and vertical padding
- **Spacing:**
  - padding on all 4 sides, top and bottom margin
  - sections also have margin on all 4 sides, content width, horizontal and vertical padding, and minimum height
- **Background:** solid or **gradient**, background image, size (cover, contain, auto), position.
- **Border:**
  - width, style (solid, dashed, dotted), colour, radius
  - **shadow** (none, small to extra large)
  - section opacity
- **Sizing:**
  - block width, block alignment, minimum height
  - **width % inside a flex row**, **flex grow ratio**

**Advanced tab:**
- **Move component.** Pick a destination (the page, or a container) and a position from lists. This is a way to move things without dragging.
- **Effects:** opacity and a **custom CSS class**.
- **Visibility:** hide on desktop, tablet or mobile.
- **Anchor ID**, with in-app help ("set a button link to #order").

### 2.4 Navigator ("Sections")

- A tree of the page with **nested elements** and drag handles.
- **Rename** a row: the label is shown in the editor only.
- **Search names or content** (the search covers nested elements), plus expand all and collapse all.
- Hide, duplicate or delete per row.
- The shared header and footer are pinned at the top and bottom with an "Edit" link.

### 2.5 Pages the builder can edit

| Page | How it works |
|---|---|
| Home, content pages (About, Privacy, Terms…), landing pages | Fully free layout |
| Header, Footer | Builder pages shared by the whole store ("Edit active header/footer") |
| Product details | One layout for all products. The real product area is a **"Connected page content"** block: you can move it and add sections around it, but there must be exactly one visible copy. Its settings: product-card buttons, Buy now and WhatsApp buttons and their labels, the Details and Related headings. **"Preview data"** switches between a single and a variable product; "Arrange sections" reorders. 3 product-page templates |
| All products, Category page, Brand page | Free layout around the live listing (filters, sorting, pagination or infinite scroll) |
| Cart drawer | Free layout around the live items, quantities, totals and checkout link |
| Checkout | "Keep the existing delivery, payment and order form. Add supporting sections around it." |
| Thank-you page | The real receipt and confirmation, with sections around it |

### 2.6 Templates ("Choose a design")

- **Store designs (11).** 5 "store collection" designs, one per store type, plus Grocery market, Fashion & lifestyle, Electronics & gadgets, Grocery & daily needs, Beauty & cosmetics and "Any store". Each uses 3–13 widgets.
- **Landing pages (33):**
  - Six full landing pages "adapted from your previous builder": fresh mango, fashion, gadget, beauty/skincare, Islamic store, SaaS.
  - About 27 "original designs":
    - full pages: grocery campaign, fashion, gadget, beauty and Islamic landing pages
    - building blocks: single product offer, product detail, product cards, image cards, hero, feature cards, testimonials, order form, category strip, image and review carousels, brand strip, a 4-column footer
    - system pages: checkout, thank-you
- **Page designs (10):** About us, Contact us, Help & FAQ, Privacy policy, Terms & conditions, Shipping & delivery, and others.
- **Preview** each design at desktop, tablet and mobile, then "Replace page with this design". The replace can be undone, and the page settings and product choice stay.
- The labels "adapted from your previous builder" and "your original builder" show that Boneek **rebuilt its builder once and migrated the old designs**.

### 2.7 My library, design tools, global pieces

- **My library:** saved designs of three kinds:
  - **page templates**
  - **reusable sections**
  - **global widgets**: linked copies, so editing one updates every page that uses it

  Sort by recent, name or favourites; favourites are saved in the browser.
- **Design tools:**
  - **Pre-publish checklist**: missing content, link format problems, possible **mobile layout problems** and **accessibility** suggestions
  - **Screen sizes & spacing**
  - **Saved styles**
  - **Copy & paste**
  - a **guided tour**

### 2.8 Two systems side by side

The simple theme forms still exist (Online store → Website design → Header, Home page, Footer, Product page). The builder only replaces them after its first publish. Merchants therefore see two ways to edit the same header, which is confusing. Our single editor is cleaner; keep it that way.

---

## 3. Our editor today, briefly

| Area | What we have |
|---|---|
| Model | Flat list of sections; each has settings plus one level of blocks. Up to 40 sections. Stored as draft and published JSON, with the last 20 versions |
| Section types | 27: hero, slideshow, banner, product grid, collection list, featured product, image with text, rich text, multicolumn, FAQ, image grid, video, testimonials, trust badges, delivery info, contact, WhatsApp CTA, divider, sales hero, benefits, specs, price packs, comparison, countdown, guarantee, order form, custom |
| Granular layout | Only in the **Custom** section: column presets (1, 1-1, 1-2, 2-1, 1-1-1, 1-2-1, 1-1-1-1), gap, vertical alignment, reverse order on phones. 13 flat elements: heading, text, image, button, checklist, icon box, video, countdown, price, badge, stars, spacer, divider. No nesting |
| Style per section | Style tab: background preset or image, text tone, spacing S/M/L, width, alignment, hide on phone or desktop, anchor, one fade-in switch. Design tab: colours, top and bottom padding (with phone values), content width, radius, border, heading size and weight (with a phone size), text size, image shade |
| Style per element (Custom only) | Colour, background, size (with a phone size), weight, alignment, width %, padding, radius, border, space below |
| Editor | Section list on the left, live preview in the middle, settings on the right. Click a section in the preview to select it. Drag to reorder sections; blocks move with arrow buttons. Undo/redo (100 steps), autosave, phone and desktop preview, draft and publish, **20-version history with restore**, **30-minute share-preview link**, saved sections, starter templates, duplicate page |
| Pages | Home; product page (sections *below* the fixed product area); content pages (sections below the text); sales pages (same editor plus their own settings: header and footer, colours, font, packs, order bump, thank-you page) |
| Not editable | Header and footer (theme settings and menus only), category pages, all-products and search, cart, checkout, thank-you page |
| Templates | 4 home starters (fashion, food, gadgets, cosmetics) and 12 sales-page templates filled from the chosen product |
| Speed | Zero JavaScript by default; CSS generated per page. Starters weigh 1.4–2.3 KB of JS and sales templates 3.4–4.1 KB, against budgets of 30 and 45 KB |

---

## 4. Side-by-side

| Capability | Boneek | Ecomm BD now | Gap? |
|---|---|---|---|
| Template-first start | 11 store, 33 landing, 10 page designs, 62 ready sections, filtered by store type | 4 starters, 12 sales templates, 27 section types | **Yes: fewer templates and no store-type filter** |
| Nested containers (flex or grid) | Yes, any depth seen | No (Custom section only, one level) | **Yes** |
| Structure presets | Grid or flex × 1/2/3/4, 2:1, 1:2, vertical | 7 column presets in Custom | Partly |
| Element count | 70 | 27 sections plus 13 Custom elements | **Yes** |
| Live commerce elements you can place anywhere | Product card, grid, carousel, gallery, add-to-cart, landing checkout, product detail, floating cart | Product grid, featured product and order form as whole sections | **Yes** |
| Text editing on the canvas | Double-click | Form fields only | **Yes** |
| Drag from the panel onto the canvas, drop inside containers | Yes | No (add from a dialog; reorder in the list) | **Yes** |
| Layer tree with rename and search | Yes | Flat section list | **Yes** |
| Content / Design / Advanced tabs | Yes | Content / Style / Design | Even |
| Device views | Desktop, **tablet**, mobile | Phone and desktop | **Yes (no tablet)** |
| Styles per device | Every style property, for each device | Padding and some sizes on phones only | **Yes** |
| Typography controls | Size, weight, line height, letter spacing, **font family per element** (including Bangla fonts), transform | Heading size and weight, text size | **Yes** |
| Margins and padding on 4 sides | Yes | Top and bottom padding only | **Yes** |
| Gradient background, shadow, border style, opacity | Yes | No | **Yes** |
| Button hover colours and padding | Yes | No | **Yes** |
| Flex sizing (width %, grow) | Yes | Width % on Custom elements only | Partly |
| Copy/paste design, reset per device, "inherited" markers | Yes | No | **Yes** |
| Move component without dragging (accessible) | Yes | Arrow keys in the section list | Partly |
| Custom CSS class | Yes | No (custom CSS is a P2 item) | Small |
| Hide per device | Desktop, tablet, mobile | Phone or desktop | Partly |
| Anchors | Yes | Yes | Even |
| Saved sections | Yes, plus page templates and **global (linked) widgets** | Saved sections | **Yes (no global widgets or page templates)** |
| Cross-page copy and paste | Yes | No | **Yes** |
| Header and footer in the builder | Yes | No | **Yes** |
| Category, all-products, brand, cart, checkout and thank-you pages in the builder | Yes | No | **Yes** |
| Product page layout | Connected block that can be moved, sections around it, preview single or variable product | Sections below the fixed product area | **Yes** |
| Pre-publish checklist (mobile, accessibility, links) | Yes | Publish checks only for broken links, duplicate anchors and order forms | Partly |
| Keyboard shortcuts sheet, guided tour | Yes | Undo/redo only | Small |
| Version history | Only "restore published to draft" | **20 versions with restore** | **We're ahead** |
| Share preview link | Not seen | **Yes** | **We're ahead** |
| Draft conflict handling (two editors) | Not seen | **Yes** | **We're ahead** |
| Sales-page specifics (packs, order bump, sticky bar, thank-you redirect) | Order form and pricing package elements | **Built in** | **We're ahead** |
| Speed | ~307 KB of Boneek's own JS on a product page | ≤30 KB budget; sections add 1–4 KB | **We're ahead** |
| One system | Theme forms *and* builder (confusing) | One editor | **We're ahead** |

---

## 5. Recommended design: "templates first, every element unlockable"

The user's goal: mostly template-based, with Boneek-level control when wanted.

**1. Same entry points as now.** Merchants start from a store design, a page design or a ready section, filtered by store type and category. Most merchants never go further.

**2. Every section becomes a tree inside.** Today a section is "settings plus a flat list of blocks". The new model is:

```
Section (template-made, still a "smart" unit)
 └── Container (flex | grid, per-device settings)
      ├── Heading / Text / Button / Image / … (elements)
      └── Container (nested, depth limit 3)
           └── …
```

- **Node:** `{ id, type, props, style: { base, tablet?, phone? }, children? }`.
- **Hero, product grid and the rest are presets of nodes**, not black boxes. Clicking the hero's button selects the Button element, with its own design tab.
- **Data-driven parts are "live" elements:** product grid, product card, collection list, order form, countdown. Their data comes from the catalogue; their styling is open.
- **Existing pages migrate automatically.** Each current section type gets a migration to its node preset. The Custom section's columns become a grid container.

**3. Our edge: zero JavaScript output.**
- **Containers and styles compile to plain HTML and one CSS file per page.** Each node gets a class, with media queries for tablet and phone, in the CSP-hashed `<style>` we already generate.
- **Script loads only for the few elements that need it:** carousel, countdown, accordion, cart drawer. Each element declares its script; the page loads only those.
- **The budget test in CI stays the gate:** a page made of containers must still pass ≤30 KB.

**4. Guardrails that Boneek lacks.** These answer the documented worry that free layouts break on phones:
- Containers **stack on phones by default**.
- Nesting is limited to 3 levels, and a page to about 400 nodes.
- The pre-publish checklist flags horizontal overflow at 360 px, tap targets under 44 px, low contrast, and missing alt text and links.
- Bangla line-height and font checks.

**5. Keep what we do better:** version history, share-preview links, draft conflict handling, sales-page settings, and a single editor (no second "theme forms" system).

---

## 6. Feature map: Boneek capability → our plan

This is a proposal. It suggests a new **"M11 · Page builder v2"** milestone. B1–B7 are proposed phases 56–62 in [competitor-boneek.md](competitor-boneek.md), section 6, and can be renumbered when added to the roadmap.

| Phase | Covers (Boneek parity) | Notes |
|---|---|---|
| **B1 · Element tree and containers** | Container, Section, Grid; flex or grid layout mode, direction, gap, justify, align, wrap, stack on mobile; structure presets (1–4 columns, 2:1, 1:2, vertical); basic elements (heading H1–H6, paragraph, button, image, icon, spacer, divider, list, badge, quote, icon box, icon list); migration of all 27 section types and Custom into node presets | The model change. Render with no JS; CSS per node |
| **B2 · Full responsive style system** | Desktop, tablet, phone values for every style; typography (size, weight, line height, letter spacing, font family including Hind Siliguri and Noto Sans Bengali, transform, colour, alignment); image fit and focus; padding and margin on 4 sides; content width and minimum height; background solid, gradient, image, size and position; border width, style, colour and radius; shadow; opacity; sizing (width, alignment, width % in a flex row, flex grow); button colours including hover, size, weight, corners and padding; "inherited from theme" markers; reset per device; copy and paste design; search all settings | Add a tablet preview (768 px) |
| **B3 · Canvas editing** | Click to select any node on the canvas; **double-click inline text editing**; drag elements from the panel onto the canvas and into containers; drop zones and "Add component inside"; floating toolbar (move, up, down, duplicate, delete); **Navigator tree** with rename, search including nested content, expand and collapse; Move component (destination and position lists, the accessible alternative); copy and paste across pages; keyboard shortcuts sheet; expand canvas and zoom; Advanced tab (custom CSS class, hide on desktop, tablet or phone, anchor) | The preview iframe becomes editable through postMessage, as now |
| **B4 · Library and templates** | Ready-section catalogue with **store-type filter** (aim for at least 60, in Bangla and English); store designs (aim for at least 11), page designs (About, Contact, FAQ, Privacy, Terms, Shipping & delivery, Returns…), more sales-page templates (we have 12; aim for at least 30, including building blocks); preview each design at 3 sizes before applying; **My library** with page templates, reusable sections and **global (linked) widgets**; favourites | Mostly content work and can run in parallel with B1–B3 |
| **B5 · System pages in the builder** | Header and footer as shared builder pages; product page with a movable "connected product" block and live product widgets (gallery, title, price, variant picker, buy-now and WhatsApp buttons) arranged freely; **preview data** (single or variable product); category, all-products, brand and search pages around the live listing; cart drawer; checkout and thank-you pages with sections around the locked form and receipt | Keep checkout's form locked so payments and fraud checks can't break |
| **B6 · Element library to 70+** | Promotion: hero, features, bento grid, cost comparison, how it works, stats and counter, testimonials, FAQ, CTA banner, countdown, contact info, social links, logo strip, accordion and toggle, tabs, notice box, announcement bar, marquee/ticker. Products: pricing/package, product card, image product card, product carousel, category grid, brand strip, floating cart, add-to-cart button, landing checkout. Media: video, gallery, image carousel, map. Trust: star rating, testimonial card, social icons. Buttons: call, email, WhatsApp. A simple form (lead or contact) | Each interactive element declares its own small script; measure it against the budget |
| **B7 · Publish quality** | Pre-publish checklist (missing content, link formats, phone layout problems, accessibility, contrast, Bangla font coverage); guided tour; saved styles | Builds on the publish checks we already have |

**Deliberately not copied:**
- **HTML embed element.** Our decision is no raw HTML or JS in sections. Merchant scripts stay in phase 35's "custom scripts", and a map uses a safe embed element.
- **The "Builder off" double system.** We keep one editor.

**Order of work:** B1 → B2 → B3 is the core, and each step can ship on its own. B4 can start straight away because it is content. B5 needs B1. B6 grows over time. B7 comes last.
