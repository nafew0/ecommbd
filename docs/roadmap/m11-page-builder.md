# M11 · Page builder v2

> Phases 56–62 · [Roadmap overview](README.md)
> **Exit criteria:** a merchant starts from a template and, when they want to, opens any part of a page and lays it out with nested flex or grid containers. They style any element separately for desktop, tablet and phone, and edit text on the page itself. Every store page can be designed this way, including the header, footer, product, category, cart, checkout and thank-you pages. Pages still meet the speed budgets.

**Why this milestone exists.** It came from the [Boneek page builder check](../research/competitor-boneek-page-builder.md) (2026-11-14). The aim: **no merchant can say "Boneek's builder can do this and yours can't"**, while we keep what we already do better:
- version history
- share-preview links
- one editor instead of two
- sales-page features
- pages that ship almost no JavaScript

**The rule for the whole milestone: templates first, every element can be opened up.**
- Most merchants only pick templates and ready sections.
- Every section is built from elements a merchant *can* open up when they want to.
- The output stays plain HTML and CSS. A page made of containers must still pass the budgets in [architecture.md](../architecture.md), Decision 2 (30 KB on product pages, 45 KB on landing pages with checkout).
- The budget test in CI stays the gate.

This changes the decision recorded in phase 15 ("fixed sections, no free-form layout"). The guardrails below answer that decision's worry that free layouts break on phones.

These phases are planned at a higher level. **Refine each one before starting it**, and update this file first.

---

## Phase 56 — Element tree and containers

| | |
|---|---|
| Milestone | M11 |
| Delivers | Nested flex and grid containers; basic elements; every section rebuilt as a tree of elements; migration of existing pages |
| Depends on | 15, 16 |
| Size | XL (consider 56a model and rendering, 56b migration) |

**Goal.** A page is a tree: sections hold containers, containers hold elements and other containers.

### Decide at start

- **The node shape.** Proposed: `{ id, type, props, style: { base, tablet?, phone? }, children? }`.
- **Limits.** Proposed: nesting up to 3 containers deep, about 400 nodes per page.
- Do "smart" sections (hero, product grid, order form) stay single nodes with settings, or become node presets the merchant can open up? Recommended: **presets that can be opened up**, with live data parts (product list, order form) as locked "live" elements.

### Build

1. **The document model** in `packages/sections`:
   - nodes, a schema per node type, version numbers and migrations, as we already do for sections
   - `readDocument` keeps its "never fails" behaviour
2. **Container node:**
   - layout mode: flex or grid
   - direction (row, column, both reversed)
   - grid columns, gap
   - justify (start, centre, end, space-between, space-around, space-evenly)
   - align (stretch, start, centre, end)
   - wrap
   - **stack on phone (on by default)**
3. **Structure presets:** 1, 2, 3 or 4 columns, 2:1, 1:2, and vertical, for both grid and flex.
4. **Basic elements:** heading (H1–H6), paragraph (rich text), button, image, icon (our `Icon` set), spacer, divider, list, badge, quote, icon box, icon list.
5. **Rendering:**
   - Astro components per node, with no JavaScript
   - one class per node in the page's hashed `<style>` (phase 16's CSS generator, extended)
   - **interactive elements declare their own script**, and a page loads only the scripts its elements need
6. **Migration:**
   - every one of the 27 current section types becomes a node preset
   - the Custom section's columns become a grid container
   - existing pages, drafts, versions and saved sections migrate on read

### Edge cases

- A page saved by the old editor opens in the new one and looks the same, checked by screenshot comparison on the starters and the 12 sales templates.
- Deep nesting over the limit is refused with a clear message.
- An empty container renders nothing on the storefront.

### Done when

- [x] All existing pages render the same after migration. The saved screenshots of every section, the old Custom section in its stored format included, pass unchanged in both themes and languages, on a phone and a computer (`npm run test:visual`).
- [x] A 3-level nested layout renders correctly at 360, 768 and 1280 px (`tests/browser/builder.spec.ts`).
- [x] The budgets still pass (starters 3.0–5.9 KB, sales templates 4.7–8.4 KB of JavaScript; a free section adds none).

### As built (2026-11-19)

The decisions are in [decisions.md](../decisions.md) (2026-11-19, "Phase 56"). In short:

- **Model:** `packages/sections`: `nodes.ts` (the tree), `elements.ts` (17 elements and the container, each with a schema), `node-style.ts` (a look per device), `open.ts` (opening a section up), and the node rules in `css.ts`.
- **Ready-made sections are not rebuilt.** They stay exactly as they were until a merchant chooses "Open up to edit freely" on one. Eleven then become plain elements; sixteen become a live block inside a container.
- **Breakpoints** are the theme's (989 and 749 px), not 1024 and 600.
- **Editor:** the tree is an indented list in the settings panel, with a look per device. Phase 58 moves selecting and dragging onto the canvas.
- **Left for later phases:** a container's own per-device layout and flex sizing (57), background images on containers (57), renaming nodes (58).

### Not in this phase

The style panel for each device (57), editing on the canvas (58).

---

## Phase 57 — Responsive style system

| | |
|---|---|
| Milestone | M11 |
| Delivers | A style for every element on desktop, tablet and phone; the full style groups; copy and paste design |
| Depends on | 56 |
| Size | L |

**Goal.** Any element can be styled in detail, separately for each screen size, without code.

### Build

1. **Device switch:** Desktop (the base), Tablet (≤1024 px) and Phone (≤600 px), each overriding the base. A count of explicit settings per device, and a reset per device.
2. **Style groups** for every element:
   - **Typography:**
     - size, weight (300–900), line height, letter spacing
     - **font family per element**: theme font, Hind Siliguri, Noto Sans Bengali, plus the theme's fonts
     - text transform, colour, alignment
   - **Image:** fit (cover, contain, fill, original, scale down) and focus point (9 positions).
   - **Spacing:** padding and margin on 4 sides, content width, minimum height.
   - **Background:**
     - solid colour, **gradient**, image (size and position)
     - merchants may use gradients; our own templates and ready sections follow the storefront design standard (no gradients)
   - **Border:** width, style (solid, dashed, dotted), colour, radius, shadow (none to extra large), opacity.
   - **Sizing:** width, alignment, width % inside a flex row, flex grow.
   - **Buttons:** background, text and border colour, **hover** colours, size, weight, corners, padding.
3. **Theme inheritance:**
   - each property shows "from theme" or "set here"
   - colours are picked from the theme palette first, or set freely
   - "reset to theme"
4. **Copy design and paste design** between elements and pages.
5. **"Search all settings"** box in the panel.
6. **Tablet preview** (768 px) next to phone and desktop.

### Edge cases

- Bangla text with a Latin-only font falls back to a Bangla font automatically.
- The colour contrast warning (phase 15) works on every text and background pair.

### Done when

- [x] One heading styled differently on desktop, tablet and phone renders correctly at each width (`tests/browser/builder.spec.ts`: 40, 30 and 22 px at 1280, 768 and 360 px), and the CSS stays within the page's limit (a node's whole look is one short rule per screen size, in the page's hashed `<style>`).

### As built (2026-11-19)

The decisions are in [decisions.md](../decisions.md) (2026-11-19, "Phase 57"). In short:

- **One switch** in the top bar sizes the preview and chooses which screen size is styled. Tablet is ≤989 px and phone ≤749 px (phase 56's breakpoints, the theme's own).
- **Seven style groups** (`STYLE_GROUPS` in `packages/sections/src/node-style.ts`); each element is offered only the groups that mean something for it.
- **Inheritance:** a dot marks what is set on this screen size; an unset value shows the wider screen's value; one sentence says the rest follows the theme.
- **Container background image** with a shade, drawn as an `<img>`.
- **Contrast** warns; it doesn't block.
- **Left for later:** saved, named styles (62), a container's own layout per screen size (not in this milestone's list).

### Not in this phase

Raw custom CSS (later, if ever). A **custom CSS class** field ships in 58's Advanced tab.

---

## Phase 58 — Canvas editing

| | |
|---|---|
| Milestone | M11 |
| Delivers | Select on the canvas, inline text editing, drag and drop into containers, a Navigator tree, moving parts without dragging, shortcuts |
| Depends on | 56 |
| Size | L |

**Goal.** Merchants edit the page they see, not a list of forms.

### Build

1. **Canvas:**
   - **click any node in the preview** to select it, with an outline, a name tag and a floating toolbar (move, up, down, duplicate, delete)
   - **double-click text** to edit it in place: Enter to finish, Esc to cancel
   - "+ Add section" between sections, and "Add inside" in empty containers
2. **Drag and drop:**
   - from the elements panel onto the canvas, into containers and between nodes, with drop indicators
   - a small drag library is allowed in the **admin** only (for example dnd-kit); the storefront ships none of it
3. **Navigator tree:**
   - nested layers, drag handles, **rename** (editor-only labels), search (including text in nested elements)
   - expand and collapse all
   - hide, duplicate and delete per row
4. **Advanced tab:**
   - **Move to:** destination and position lists, the keyboard-friendly alternative to dragging
   - hide on desktop, tablet or phone
   - anchor ID
   - custom CSS class
   - opacity
5. **Copy and paste** nodes across pages. **Shortcuts:**
   - undo, redo, save
   - copy, paste, duplicate, delete
   - ↑/↓ to select, P to preview
   - ? to show the list
6. **Expand canvas and zoom.**

### Edge cases

- Editing text inline and in the panel at the same time: the last change wins, and undo covers both.
- Dropping a container inside itself isn't possible.
- Touch devices fall back to tap-to-select plus Move to.

### Done when

- [ ] A merchant builds a 2-column section with a nested container using only the canvas, then rearranges it from the Navigator, all with undo.

### Not in this phase

Several people editing at once; we keep the revision-conflict dialog.

---

## Phase 59 — Library and templates

| | |
|---|---|
| Milestone | M11 |
| Delivers | Ready sections filtered by store type; store, page and sales designs; page templates and global (linked) widgets in My library |
| Depends on | 15, 16 (content can start before 56 and is converted once 56 lands) |
| Size | L (mostly content) |

**Goal.** Most merchants never need the granular tools, because a good starting point already exists.

### Build

1. **Ready sections:**
   - **at least 60**, in Bangla and English
   - filtered by **store type** (fashion, electronics, grocery, food, beauty, footwear, general, Islamic and lifestyle) and by **category** (basic, promotion, products, media, trust)
   - each uses the store's palette and real products
2. **Store designs:** at least 11 home pages, one or more per store type, plus "any store".
3. **Page designs:** About, Contact, Help & FAQ, Privacy, Terms, Shipping & delivery, Returns, and a size guide.
4. **Sales-page templates:** grow from 12 to **at least 30**, including building blocks (single product offer, product cards, review carousel, order form block).
5. **Preview before applying**, at desktop, tablet and phone. "Replace page with this design" can be undone, and the page settings and product choice stay.
6. **My library:**
   - **page templates**
   - reusable sections (extends today's saved sections)
   - **global widgets**: linked copies, so editing one updates every page that uses it, with an "unlink" option
   - search, sort, favourites

### Edge cases

- A global widget used on a page that is then deleted is still kept in the library.
- Deleting a global widget converts its uses into normal copies.

### Done when

- [ ] Template counts meet the targets.
- [ ] Each template passes the budgets and has Bangla text.
- [ ] A global widget edit shows up on every page that uses it.

### Not in this phase

A template marketplace; templates made by merchants and shared between stores.

---

## Phase 60 — System pages in the builder

| | |
|---|---|
| Milestone | M11 |
| Delivers | Header, footer, product page, category, all-products, brand and search pages, cart drawer, checkout and thank-you page, all designed in the builder |
| Depends on | 56, 13, 14 (55 for brand pages) |
| Size | XL |

**Goal.** Every page a shopper sees can be designed, while the parts that handle money and orders stay safe.

### Build

1. **Header and footer** become shared builder layouts (store menu, logo, search, cart and account elements). Sales pages keep their own header and footer options.
2. **Product page:**
   - live product elements that can be placed freely: gallery, title, price, variation picker, quantity, Buy now, add to cart, WhatsApp button, description, specs, delivery info, related products
   - or a single "product block" (movable, exactly one per page)
   - **preview data:** a single or a variable product, chosen from the catalogue
3. **Category, all-products, brand and search pages:** layouts around the live listing (filters, sorting, pagination).
4. **Cart drawer:** layout around the live items, totals and checkout button.
5. **Checkout and thank-you:**
   - sections may surround the **locked** checkout form and receipt
   - payment, address, OTP and fraud steps can't be removed or reordered
6. **One editor:** theme settings keep only the global choices (palette, fonts, buttons). There is no second set of "header/footer forms".

### Edge cases

- A merchant deletes the product block: publish is blocked with "Your product page needs a product block".
- Checkout layout changes never change the order data sent to the server.

### Done when

- [ ] Every listed page can be designed and published, and stays within its budget.
- [ ] The checkout end-to-end tests (14, 18, 11) still pass with a custom layout.

### Not in this phase

A checkout made of several steps, and fields on the checkout form that merchants define themselves.

---

## Phase 61 — Element library to 70+

| | |
|---|---|
| Milestone | M11 |
| Delivers | Promotion, product, media and trust elements, to match and pass Boneek's 70 |
| Depends on | 56, 57 |
| Size | L |

**Goal.** Whatever a merchant wants on a page, an element for it exists.

### Build

**Elements by group:**

| Group | Elements |
|---|---|
| Promotion | hero, features, bento grid, cost comparison, how it works, stats and counter, testimonials, FAQ, CTA banner, countdown, contact info, social links, logo strip, accordion and toggle, **tabs**, notice box, announcement bar, ticker (marquee) |
| Products | pricing package, product card, image product card, product carousel, category grid, brand strip, **floating cart**, add-to-cart button, landing checkout, **volume offer** (quantity breaks, from phase 35) |
| Media | video (click to load), gallery, image carousel, map (a safe embed, no raw HTML) |
| Trust | star rating, testimonial card, social icons |
| Buttons | call, email, WhatsApp |
| Forms | a simple lead or contact form, saved to the admin, with no third-party scripts |

**Script budget.** Each interactive element (carousel, tabs, accordion, countdown, floating cart) gets a small script measured on its own and listed in the budget report. Accordions use `<details>`, so they need no script.

### Done when

- [ ] At least 70 elements, each with Bangla and English labels.
- [ ] A page using every element at once still passes the landing-page budget.

### Not in this phase

An HTML embed element (our decision: no raw HTML; merchant scripts live in phase 35).

---

## Phase 62 — Publish quality

| | |
|---|---|
| Milestone | M11 |
| Delivers | Pre-publish checklist, guided tour, saved styles |
| Depends on | 57, 58 |
| Size | M |

**Goal.** Freedom without broken pages.

### Build

1. **Pre-publish checklist** (warnings, plus blockers where marked):
   - missing content or images
   - broken or badly formatted links
   - **horizontal overflow at 360 px**
   - tap targets under 44 px
   - low contrast
   - missing alt text
   - a Latin-only font used on Bangla text
   - more than one H1
   - the budget would be exceeded (**blocker**)
2. **Guided tour** of the editor, in Bangla and English, at first use.
3. **Saved styles:** named text and button styles that can be reused and updated store-wide.
4. **Help:** a keyboard shortcut sheet and short help videos inside the editor (videos shared with phase 33).

### Done when

- [ ] The checklist catches each listed problem on a test page.
- [ ] A new merchant finishes the tour and publishes a page without help.

### Not in this phase

A/B testing (later).
