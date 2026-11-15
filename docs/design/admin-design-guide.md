# Merchant admin design guide

> Written 2026-11-14 for [phase 63](../roadmap/m12-services-redesign.md#phase-63--admin-redesign).
> Background: [Boneek competitor check, section 7](../research/competitor-boneek.md#7-admin-redesign-suggestions-from-what-works-in-boneek).

**Who reads this**

- **The session that builds phase 63a** (Claude Opus or Fable). Follow sections 1–9 step by step.
- **Every later session that adds an admin screen** (Grok in Cursor, or anyone). Read sections 1, 5, 6 and 10, then copy the reference screen named in section 5.

**What phase 63a is, and is not**

- It changes the **look**, the **menu** and **how much each screen shows at once**.
- It does **not** change URLs, GraphQL calls, permissions or what any button does.
- Every string still goes in `src/messages/en.ts` and `bn.ts`.
- One new npm package: `motion`, in its light form (section 3.7). Icons stay `lucide-react`.

**Status:** 63a, 63b and most of 63c were built on 2026-11-14. Where the build differs from the first plan, this guide says what was built.

---

## 1. The five rules

1. **Essentials in one click, the rest behind "More".** A merchant sees only what they use every week. Everything else is one click away, never gone. Section 6 says exactly how to decide.
2. **One main button per screen.** It is the next step ("Save", "Confirm order", "Add product"). Other actions are plain buttons or sit in a "More" menu.
3. **Calm and neutral.** Light grey page, white cards, near-black text and main buttons. Colour means something: a status, a warning, a link. Nothing is coloured for decoration.
4. **Bangla first, phone first.** Design each screen at 360 px in Bangla, then widen. Labels wrap; they are never cut off.
5. **Same parts everywhere.** A screen is built only from the components in section 4 and one of the four templates in section 5. If a screen needs something new, add it to the component set and the UI kit page first.

---

## 2. Tokens

Today the admin uses Tailwind's raw `slate-*` and `teal-*` classes about 860 times. Phase 63a replaces them with named tokens, so the look can change in one file and later sessions can't pick a wrong shade.

### 2.1 Colours

Add these to the `@theme` block in `apps/admin/src/styles.css`. Tailwind 4 turns each one into classes (`bg-page`, `text-ink`, `border-line`…).

| Token | Value | Used for |
|---|---|---|
| `--color-page` | `#f4f4f3` | page background |
| `--color-surface` | `#ffffff` | cards, inputs, sidebar items when active |
| `--color-surface-muted` | `#f8f8f7` | table header, row hover, read-only boxes |
| `--color-line` | `#e4e4e2` | card borders, dividers |
| `--color-line-strong` | `#c9c9c5` | input borders |
| `--color-ink` | `#1a1a19` | main text, headings |
| `--color-ink-muted` | `#5c5c58` | hints, secondary text, table headers |
| `--color-ink-faint` | `#9b9b96` | placeholders and disabled text only |
| `--color-primary` | `#1a1a19` | the main button |
| `--color-primary-hover` | `#3a3a37` | its hover |
| `--color-bar` | `#1a1a19` | the top bar |
| `--color-accent` | `#0f766e` | links, focus rings, selected tab, checked switch |
| `--color-accent-soft` | `#effaf8` | selected row, active filter |
| `--color-ok` / `--color-ok-soft` | `#17663a` / `#e6f4ea` | success, paid, delivered |
| `--color-warn` / `--color-warn-soft` | `#8a5300` / `#fdf1d8` | needs attention |
| `--color-danger` / `--color-danger-soft` | `#b42318` / `#fde8e6` | errors, cancelled, delete |
| `--color-info` / `--color-info-soft` | `#1d5fa8` / `#e6f0fb` | neutral notices |

Rules:
- After 63a, **no file under `apps/admin/src` uses a raw palette class** (`slate-`, `teal-`, `red-`, `amber-`…), except inside `components/ui/misc.tsx` where `Badge` maps its tones. Add a small test that greps for them.
- Text on a soft background uses the matching strong colour (`text-warn` on `bg-warn-soft`). All pairs above pass 4.5:1.
- The print templates (`components/print/*`) are black on white paper. Leave them alone.

### 2.2 Type

Font: Hind Siliguri, weights 400 and 600 (already self-hosted). Do not add weights.

| Use | Class | Size |
|---|---|---|
| Page title | `text-xl font-semibold` | 20 px |
| Card title | `text-[15px] font-semibold` | 15 px |
| Body, table cells, labels | `text-sm` | 14 px |
| Hints, meta | `text-[13px] text-ink-muted` | 13 px |
| Badges, counts | `text-xs` | 12 px |
| Inputs | `text-base sm:text-sm` | 16 px on phones (stops iOS zooming), 14 px above |

Line height stays 1.6 for Bangla. Numbers in tables use `tabular-nums`.

### 2.3 Space, corners, shadows

- **Grid:** multiples of 4 px. Gap between cards 16 px. Gap between fields 16 px. Card padding 16 px on phones, 20 px from `sm`.
- **Corners:** cards `rounded-lg` (8 px); buttons, inputs and badges `rounded-md` (6 px). Only switches and avatars are fully round.
- **Shadows:** none on cards (border only). `shadow-lg` only on things that float: menus, dialogs, the search box, toasts.
- **Touch size:** anything tappable is at least 40 px tall, 44 px on phones.
- **Motion:** short and quiet (120–200 ms, ease-out), through `lib/motion.tsx` (section 3.7). Off under `prefers-reduced-motion`.

---

## 3. The shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▣ Store name        [ 🔍 Search…            Ctrl K ]   বাং|EN  ↗  (N) │  top bar, 56 px, --color-bar
├──────────────┬───────────────────────────────────────────────────────┤
│ Home         │  Page title                         [Secondary] [Main] │
│ Orders     ▾ │  ┌───────────────────────────────┐ ┌────────────────┐ │
│   All orders │  │ card                          │ │ side card      │ │
│   Confirm  3 │  └───────────────────────────────┘ └────────────────┘ │
│   Incomplete │                                                       │
│   Payments 1 │                                                       │
│   More     ▸ │                                                       │
│ Products     │                                                       │
│ Customers    │                                                       │
│ Sales pages  │                                                       │
│ Marketing    │                                                       │
│ ──────────── │                                                       │
│ Online store │                                                       │
│ Settings     │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
  sidebar 240 px, --color-page (no white panel), 1 px line on its right
```

### 3.1 Top bar

- 56 px tall, `bg-bar`, white text, sticky.
- **Left:** the store's name in the admin's language, truncated ("Store admin" until a name is set). On phones, the menu button comes first.
- **Middle:** a search button that looks like an input ("Search… Ctrl K"). On phones it is an icon. See 3.4.
- **Right:** "View store" (when the server knows the storefront's address, `STOREFRONT_URL`), the language switch, the bell (below), then an avatar button with the person's initial. Its menu has "Take the tour" and "Sign out".
- **The bell** lists the work that is waiting, each line going to the screen where it is done: orders to confirm, payments to check, confirmed orders to pack, addresses the courier can't place, unfinished checkouts, products low on stock. A dot shows when a count has grown since the list was last opened on this device. It is a to-do list, not a message feed: nothing is stored on the server, and it refreshes once a minute with the rest of the shell (`layout/use-shell.ts`).
- The notifications bell is **not** in 63a (it needs server work: phase 63c). Don't show a bell that does nothing.

### 3.2 Sidebar

- 240 px, same colour as the page, with a 1 px `border-line` on its right. The collapse-to-icons button is removed: it saved little and made a second layout to maintain.
- **About 10 top-level items**, each with an 18 px icon and a label.
- **One group open at a time.** Clicking a group opens it and goes to its first screen. The group holding the current page is always open.
- **Active item:** `bg-surface` with a 1 px `border-line` and `font-semibold`. No teal block.
- **Counts:** a screen that is a to-do list shows a small count when it is above zero (`count` on its link in `menu.ts`): Confirm orders, Incomplete orders, Verify payments and Unmapped addresses. They come from the shell's one request (`layout/use-shell.ts`), which asks only for what the role may read. A "More" item with a count above zero is shown outside "More".
- **"More" inside a group:** a last row that opens the less-used screens in place. It remembers open or closed in `localStorage`.

**The main menu:**

| Top-level | Always shown | Under "More" |
|---|---|---|
| Home | (one link) | |
| Orders | All orders · Confirm orders · Incomplete orders · Verify payments | Payment reviews · Orders by campaign · Unmapped addresses · WooCommerce orders |
| Products | All products · Categories · Stock | (Reviews, when phase 35 ships) |
| Customers | Customer list · Block list | |
| Sales pages | (one link) | |
| Marketing | Tracking | (Coupons, when phase 35 ships) |
| *divider* | | |
| Online store | opens the store area (3.3) | |
| Settings | opens the settings area (3.3) | |

"Phone order" leaves the menu and becomes the **"Create order"** main button on the orders list. Its URL `/orders/phone` does not change.

### 3.3 Areas: Online store and Settings

These two have many screens. Each becomes its own **area**: the sidebar is replaced by that area's own list, with **"← Back"** at the top (it returns to Home). The top bar stays.

**Settings area:**

| Heading | Screens (label → existing route) |
|---|---|
| Store | Store details → `/settings/store` · Staff → `/settings/staff` (phase 32) |
| Orders | Order settings → `/settings/orders` · Fake-order protection → `/settings/fraud` · Invoices and stickers → `/settings/invoice` |
| Delivery | Delivery charges → `/settings/delivery` · Couriers → `/settings/couriers` |
| Payments | Payment methods → `/settings/payments` · Online payments → `/settings/online-payments` |
| Messages | SMS → `/settings/sms` |
| Moving in | WooCommerce migration → `/settings/woocommerce` |

**Online store area:** Theme · Home page · Product page · Menus · Pages · Search. (Theme and the page designs already open as full-screen editors; that stays.)

**How to build it:** in `layout/menu.ts`, give each group an `area: 'main' | 'store' | 'settings'` and each link an optional `more: true`. The area is read from the URL: paths under `/settings` are the settings area, paths under `/store` the store area, everything else main. `visibleMenu` keeps filtering by `ready` and permission exactly as now. Update `menu.spec.ts`.

### 3.4 Search

- Opens with Ctrl K / ⌘ K or the top bar button. A `Dialog` near the top of the screen with one input and a result list. Arrow keys move, Enter opens, Escape closes.
- It searches **screens** (every menu link, in both languages, including ones under "More") and a short list of **actions** ("Create order", "Add product", "Add sales page") at once, in the browser.
- From two letters on, it also asks the server for **orders** (by number, phone or name), **products** and **customers**, five of each, and lists them first.
- It only lists what the person's role may open; the server checks each kind's permission again.
- Why it's in 63a: hiding things under "More" is only safe when search can find them.

### 3.5 On phones (below `lg`)

- The top bar keeps: menu button, store name, search icon, avatar.
- The sidebar is the existing drawer (`Dialog variant="drawer"`), showing the current area's list.
- The language switch moves to the bottom of the drawer.

### 3.6 The guided tour

A first visit to the home screen starts a short tour of the menu (`layout/tour.tsx`):

- **Seven steps:** a welcome, then Orders, Products, Customers, Online store, Settings and Search. A step is left out when the role can't see that menu item.
- **A spotlight glides** from one menu item to the next, and the menu opens the group it points at, so the merchant sees what is inside. A small card explains the item in two sentences.
- **Always skippable:** a "Skip the tour" link, the ✕ button and Escape all end it. Arrow keys move between steps.
- **Shown once per device** (`localStorage`), and never to automated browsers, so the browser tests are not blocked. It can be started again from the avatar menu or from search ("Take the tour again").
- **On phones** the menu is in a drawer, so the card shows alone in the middle of the screen.
- **To add a step:** add its name to `TOUR_STEPS`, its title and body to `tour.steps` in both message files, and `data-tour="<name>"` to the element it points at.

Keep it at seven steps or fewer. A tour for one screen (the page editor has its own, phase 62) is a separate tour, not more steps here.

### 3.7 Motion

The admin uses **Motion** (the `motion` package, Framer Motion's successor) in its light form: `LazyMotion` with the `domAnimation` features and the small `m` components.

- **Import only from `lib/motion.tsx`:** `m`, `AnimatePresence`, and the presets `rise` (fade in and rise 6 px), `expand` (open by height), `EASE` and `GLIDE`. `LazyMotion` runs in `strict` mode, so importing the full `motion` component fails at once.
- **What moves, and why:**
  - a page fades in and rises 6 px when it opens
  - a menu group, a "More" row, a collapsed card and the list filters open by height, so the merchant sees where the new content came from
  - the sidebar slides sideways when entering or leaving Settings and Online store
  - menus fade and scale from their button; the save bar slides up from the bottom
  - the tour's spotlight and card glide between steps
- **What doesn't:** nothing loops, bounces or animates for decoration. No layout animations (`layout`, `layoutId`): they need the larger `domMax` feature set.
- **Reduced motion** is respected everywhere (`MotionConfig reducedMotion="user"`, plus a CSS rule for CSS transitions).
- The storefront's rule is different: it uses `motion/mini` only (see `CLAUDE.md`).

### 3.8 Page width

`<main>` no longer has `max-w-5xl`. Each page picks a width through the `Page` component (section 4). A screen that doesn't use `Page` yet (before 63b reaches it) gets the `wide` width.

| Width | Value | For |
|---|---|---|
| `full` | up to 1440 px | lists and tables, the dashboard |
| `wide` | up to 1120 px | detail and form pages with a side column |
| `narrow` | up to 760 px | settings pages, simple forms |

Padding: 16 px on phones, 24 px from `sm`.

---

## 4. Components

All live in `apps/admin/src/components/ui/` (form parts in `components/form/`). **`/admin/ui-kit` shows every one of them** and is the living reference: update it in the same commit as the component.

### 4.1 Existing: restyle, keep the props

| Component | Change |
|---|---|
| `Button` | `primary` becomes `bg-primary` (near-black). `secondary`: white with `border-line-strong`. `ghost` and `danger` keep their meaning. `rounded-md`. Focus ring `outline-accent`. Sizes: `sm` 36 px, `md` 40 px (44 px below `sm`). |
| `Card`, `CardHeader`, `CardBody` | Token colours. `CardHeader` loses its bottom border: title and body sit in one padded box. |
| `Badge` | Keep the `tone` names so no caller changes. Inside, map them to the token pairs. `rounded-md`, not `rounded-full`. |
| `Alert`, `Skeleton`, `EmptyState` | Token colours. `EmptyState`'s icon circle becomes `bg-surface-muted text-ink-muted`. |
| `Input`, `Textarea`, `Select` | `border-line-strong`, `rounded-md`, 40 px tall (44 px on phones). |
| `Switch` | Checked colour `bg-accent`. |
| `Dialog`, toast, confirm | Token colours only. |
| `Field` | No change beyond tokens. |
| `ListPage` | New in 63c: `tabs.more` (rarely used tabs under one "Others" menu), `columnPicker` (each person chooses their columns, remembered on the device) and `pagination.sizes` (a per-page choice in the footer). Token colours. The search and filters sit in one row above the table. Rows are 48 px. Selected tab: `border-ink text-ink`. New prop `moreFilters={{ content, active }}`: the rarely used filters open under one "Filters" button that shows how many are set. |
| `PageHeader` | Gains `back` (a link with a left arrow above the title), `badges` (beside the title) and `menu` (items for a "More" button). `actions` keeps working. |

### 4.2 New

| Component | What it is | Props (target) |
|---|---|---|
| `Page` | The width wrapper every page starts with. | `width: 'full' \| 'wide' \| 'narrow'`, `children` |
| `TwoColumn` | Main column plus a 320 px side column; one column below `lg` (side goes under main). | `main`, `side` |
| `Tabs` | A row of tabs for parts of one page. Selected tab is kept in the URL (`?tab=`). | `items: {key, label, count?}[]`, `active`, `onChange` |
| `MoreFields` | A "More options" row at the bottom of a card that opens extra fields in place. | `label?`, `summary?: string`, `forceOpen?: boolean`, `children` |
| `CollapsibleCard` | A whole card that starts closed and shows a one-line summary of what's inside. | `title`, `summary: string`, `forceOpen?`, `children` |
| `ActionMenu` | A "More" button with a drop-down list of actions. | `label?`, `items: {label, onSelect, tone?: 'danger', disabled?}[]` |
| `SaveBar` | The bar that appears when a form has unsaved changes: "Unsaved changes · Discard · Save". Sticks to the bottom of the screen. | `dirty`, `saving`, `onSave`, `onDiscard` |
| `StatTile` | A number with a label, optionally a link. | `label`, `value`, `to?`, `tone?` |
| `KeyValue` | A two-column list of label and value for read-only details. | `rows: {label, value}[]` |
| `CopyButton` | Copies a value (phone, address, order number) and shows "Copied". | `value`, `label` |
| `AppLayout`, `Sidebar`, `CommandSearch`, `Tour` | The shell parts from section 3, in `layout/`. | |

Build notes:
- `MoreFields` and `CollapsibleCard` use a real `<button aria-expanded>` and keep their children mounted while closed (height 0 and `inert`), so form state and validation still work.
- `ActionMenu` draws its list in a portal at a fixed position under its button, so a card or table never cuts it off. It closes on Escape, an outside click, a scroll or a resize. Arrow keys move between items.
- `SaveBar` needs to know whether the form changed. Use `useDraft` (`lib/use-draft.ts`): it gives `draft`, `setDraft` (the merchant's edits), `load` (call it with what the server returned, on first load and after each save), `dirty` and `discard`. Inside a `<form>`, leave out `onSave`: the bar's button then submits the form. See `pages/order-settings.tsx` for the shortest example.
- Several pages already have their own sticky save row. Replace each with `SaveBar`.

---

## 5. The four page templates

Every screen is one of these. After 63a, one screen of each kind is the **reference screen**: later sessions copy it.

### A. List page — reference: `pages/orders.tsx`

```
Page width="full"
  PageHeader  title · [Export] [Create order ◀ main]
  ListPage    tabs with counts → search + filters row → table → pagination
```

- At most **6 columns** on desktop and **3 on phones** (`hideOnMobile` for the rest). The first column is what the row is (order number, product name) and links to the detail page.
- Filters that are rarely used go behind one "Filters" button.
- Bulk actions appear only when rows are ticked.
- An empty list shows `EmptyState` with one action.

### B. Detail or form page — reference: `pages/product-form.tsx` (form) and `pages/order-detail.tsx` (detail)

```
Page width="wide"
  PageHeader  ← back · title · badges · [More ▾] [Main button]
  TwoColumn
    main:  the cards a merchant fills or reads top to bottom
    side:  status, organisation, short facts
  SaveBar (forms only)
```

- **Main column order = the order of work.** For a product: name and description, photos, price and stock, variations.
- **Side column** holds small things: status, category, tags, a customer card.
- Each card shows its essential fields. The rest sit in `MoreFields` at the bottom of the same card (section 6).

### C. Settings page — reference: `pages/delivery-settings.tsx`

```
Page width="narrow"
  PageHeader  title · one-line description
  (Tabs, only if section 6.3 says so)
  Card  the settings most stores change
  CollapsibleCard  "Weight-based charges — Off"
  CollapsibleCard  "COD fee — ৳0"
  SaveBar
```

- One card per decision the merchant makes, with a plain title ("Delivery charges", not "Shipping configuration").
- A setting that is off by default and most stores never touch is a `CollapsibleCard` whose summary shows its current value.

### D. Dashboard — `pages/home.tsx`

```
Page width="full"
  PageHeader  greeting
  Row of StatTile (the to-do counts that exist today, each linking to its list)
  Setup checklist card (until finished)
  TwoColumn-style grid of the existing widgets
```

- Under today's tiles sits the **sales overview** (`components/dashboard.tsx`): a range (Today, 7 days, 30 days, This month), four tiles (order value, orders, items sold, average order), a bar per day, the orders per status (each row opens that list) and the latest five orders.
- Staff without the `ReadSalesFigures` permission see counts only, and the chart shows orders per day.
- The chart is `components/ui/bar-chart.tsx`: one series, one colour, the value on hover, and the same numbers in a table for screen readers. Use it for any "one number per day" chart; a chart with several series needs its own design first.

**Screens that keep their own layout:** the confirmation queue, the phone-order screen, the WooCommerce migration steps, the theme and page editors, login and print. In 63a they get tokens and the new components, nothing more.

---

## 6. What to show and what to hide

This is the heart of the redesign. Apply it the same way on every screen.

### 6.1 Is a field essential?

A field or action is **essential** (always visible) if any one is true:
1. It is **required** to save.
2. **Most merchants change it** in a normal week, or set it for nearly every item (price, stock, photo, delivery charge).
3. A wrong value **loses money or orders** right away, so it must be seen (COD on or off, a payment number, "store is closed").

Everything else goes behind "More". When unsure, hide it: search and one click still reach it.

### 6.2 Limits

- **5 visible fields per card**, 7 at most. More than that means some belong under "More" or in another card.
- **1 main button** per screen, plus at most **2 other visible buttons**. Further actions go in an `ActionMenu`.
- **Destructive actions** (delete, cancel order, block customer) are always in the `ActionMenu`, in the danger tone, and always confirm.

### 6.3 Which control to use

| Situation | Use |
|---|---|
| A card has up to 6 extra fields of the same kind | `MoreFields` at the bottom of that card |
| A whole group of settings is optional | `CollapsibleCard` with a summary |
| A page has 3 or more groups aimed at different jobs (for example Profile / Policies / Language) | `Tabs`. Name tabs by what's in them. Use "Advanced" as a tab name only as a last tab, for things with no better home. |
| Extra actions | `ActionMenu` labelled "More" |
| Extra table columns | hidden on phones; a column picker is phase 63c |

Never nest them (no "More" inside a collapsed card inside a tab).

### 6.4 Hidden never means lost

- **Always say what's inside.** The "More" label names it ("More options: SKU, weight, barcode") or the collapsed card shows a summary of the current value ("COD fee — ৳20").
- **Open automatically** (`forceOpen`) when a field inside has a validation error, or when it holds a value the merchant set themselves (not the default). A merchant who filled in a meta description must see it next time without hunting.
- **Search finds it** (3.4 lists every screen).
- Closed parts stay mounted, so saving the form saves them too.

### 6.5 Wording

- The row reads **"More options"** / **"আরও অপশন"**, and when open **"Fewer options"** / **"কম দেখান"**. Add both to `messages` under `common`. Check the Bangla against [the glossary](../glossary.md).
- Card titles are things a shopkeeper says: "Price and stock", not "Inventory configuration".
- A hint is one short sentence under the field. If a field needs three sentences, the design is wrong.

---

## 7. Screen by screen

A starting point for each existing screen. **Before changing a screen, read it, list its fields, and apply 6.1.** If the list below disagrees with what you find, follow 6.1 and note the change in the commit.

| Screen (`pages/…`) | Template | Always visible | Behind "More" or collapsed |
|---|---|---|---|
| `home` | D | to-do tiles, setup checklist, order and courier widgets | — (remove "coming soon") |
| `orders` | A | tabs by status, search, columns: order, customer, total, profit (ReadCost only, hidden on phones), payment, status, date. Main button "Create order" | date range, source and courier filters behind "Filters"; export in the header menu |
| `order-detail` | B | main: items, profit breakdown (ReadCost only), **one "next step" button** from the status table (`packages/shared/src/order-status.ts`), payment, courier, history. Side: customer with copy buttons, address, risk | other status moves, edit, print choices, SMS, cancel → `ActionMenu`; attribution as a collapsed side card |
| `confirm-orders`, `phone-order` | own | as today | — |
| `incomplete-orders`, `verify-payments`, `payment-reviews`, `unmapped-addresses`, `order-campaigns`, `woo-orders` | A | as today, in the new `ListPage` look | — |
| `products` | A | photo, name, price, stock, status. Main button "Add product". Cost and margin (ReadCost only, hidden on phones) | "Cost missing" filter |
| `cost-settings` | C | courier charge fallback | COD charge we pay, gateway fee (collapsed, summary shows the current value or "not set") |
| `product-form` | B | main: name, description, photos, price, sale price, stock, cost (ReadCost only), variations. Side: status (shown or hidden), category. "Same cost for every variation" when there are variations | SKU, weight and per-product delivery rules, slug and other search fields → `MoreFields` in their card or a collapsed "Delivery" card |
| `categories`, `stock` | A | as today | — |
| `customers` | A | name, phone, orders, total spent, last order | — |
| `customer-detail` | B | main: recent orders, notes. Side: contact, block status | SMS opt-out as a collapsed side card |
| `block-list` | A | as today | — |
| `sales-pages` | A | title, product, status, orders. Main button "Add sales page" | — |
| `content-pages`, `content-menus`, `content-page-edit`, `search-settings` | A / B / C | as today | synonyms and "searches with no result" on the search screen as two tabs |
| `meta-tracking` | C | pixel ID, access token, on/off, the Purchase trigger | test-event code, event log, per-event switches → collapsed cards |
| `store-settings` | C with `Tabs` (it already has tabs) | Profile tab: name, logo, phone, address | social links, about text → collapsed cards |
| `order-settings` | C | order number format, packing options | unanswered-call rules → collapsed |
| `fraud-settings` | C | on/off switches with their main number | fine limits → `MoreFields` |
| `delivery-settings` | C | charges inside and outside Dhaka, free-delivery rule | delivery methods, weight charges, COD fee, coverage → collapsed cards with summaries |
| `payment-settings` | C | COD on/off, bKash/Nagad/Rocket numbers | advance-payment rules → collapsed |
| `online-payment-settings` | C | one card per gateway: on/off, credentials | sandbox switch, extra options → `MoreFields` |
| `courier-settings` | C | one card per courier: on/off, credentials | default parcel values → collapsed |
| `sms-settings` | C | balance and usage, on/off per message | quiet hours, limits → collapsed; message text editors open per message |
| `print-settings` | C | invoice options most used, sticker size | language and fine layout → collapsed |
| `woo-migration` | own | the step list as today | — |
| `ui-kit` | — | every component in section 4, in every state | — |

---

## 8. Build order for phase 63a

One commit per step. After each: `npm run lint && npm run typecheck && npm test`, then look at the screens named in the step at **360 px and 1280 px, in Bangla and English**.

1. **Tokens.** Add section 2.1 to `styles.css`; set `body` to `bg-page text-ink`.
2. **Restyle the existing components** (4.1). The app now looks different everywhere but works the same.
3. **Swap raw colours for tokens** across `pages/` and `components/` with a script, using the table below, then read the whole diff: a few uses need a different token than the table gives. Add the grep test from 2.1.

   | From | To |
   |---|---|
   | `text-slate-900`, `-800` | `text-ink` |
   | `text-slate-700`, `-600`, `-500` | `text-ink-muted` |
   | `text-slate-400` | `text-ink-faint` |
   | `border-slate-200`, `-100`, `divide-slate-*` | `border-line` / `divide-line` |
   | `border-slate-300` | `border-line-strong` |
   | `bg-slate-50`, `-100` | `bg-surface-muted` |
   | `bg-slate-200` | `bg-line` |
   | `text-teal-*` | `text-accent` |
   | `bg-teal-50`, `border-teal-100` | `bg-accent-soft`, `border-line` |
   | `bg-teal-600`, `-700` | `bg-primary` on buttons, `bg-accent` elsewhere |
   | `outline-teal-*`, `ring-teal-*`, `accent-teal-*` | `outline-accent`, `ring-accent`, `accent-accent` |
   | `red-*`, `amber-*`, `green-*`, `sky-*` | `danger`, `warn`, `ok`, `info` (strong for text, `-soft` for backgrounds) |

4. **New components** (4.2), each added to `/admin/ui-kit` with its states, and unit tests for `MoreFields`, `CollapsibleCard`, `Tabs` and `ActionMenu` (open, close, keyboard, `forceOpen`).
5. **The shell** (section 3): `menu.ts` areas and "More", `TopBar`, `Sidebar`, `AreaNav`, the phone drawer, page widths. Update `menu.spec.ts`.
6. **Search** for screens and actions (3.4).
7. **The reference screens**, fully redone to their template with section 6 applied:
   - `orders.tsx` (A)
   - `product-form.tsx` (B, form)
   - `order-detail.tsx` (B, detail)
   - `delivery-settings.tsx` (C)
   - `home.tsx` (D)
8. **Browser tests.** Fix `tests/browser/*.spec.ts` where a selector moved (menu items under "More", buttons inside an `ActionMenu`). Tests should find things by role and name, so most keep passing.
9. **Docs.** Update this guide where the build differed from it, set phase 63a to Review in the roadmap, add a `CHANGELOG.md` line.

**Phase 63b** then moved every other screen in section 7 to its template (built 2026-11-14):

- every screen sets its width with `Page`
- every settings form, the menus screen and the content page editor use `useDraft` and `SaveBar`
- collapsed by default: courier default parcel values, unanswered-call rules, advance payment, SMS quiet hours and limits, print language, the Meta event log, store social links, a customer's SMS opt-out
- the customer page and the content page editor follow template B (back link in the header, side column, delete under "More")

**Left as they were, on purpose:** the list screens already matched template A. Customers and Sales pages still show seven columns on desktop (one over the limit). Store settings and the confirmation queue keep their own tab rows. Small "details" rows inside logs (Meta events, settings history) stay native.

---

## 9. Done when (63a)

- [ ] No raw palette classes left in `apps/admin/src` (the grep test passes).
- [ ] Every existing URL opens, and every browser test passes.
- [ ] The sidebar shows about 10 top-level items; Settings and Online store open as their own areas with "← Back".
- [ ] Ctrl K finds every screen, in Bangla and English, and respects permissions.
- [ ] The five reference screens follow their templates, with no more than 7 visible fields per card and one main button.
- [ ] At 360 px in Bangla, nothing is cut off or scrolls sideways (except tables inside their own scroll box).
- [ ] `/admin/ui-kit` shows every component.
- [ ] Keyboard: every menu, tab and "More" row works with Tab, Enter, Escape and the arrow keys.

---

## 10. Rules for any session adding an admin screen

Paste this section into the task when handing work to another model.

1. Pick the template (section 5) and **open its reference screen first**. Copy its structure.
2. Use only components from `components/ui/`, `components/form/` and `components/list-page.tsx`. Don't write a new button, card, table, tab or dialog. If something is missing, stop and say so.
3. Colours come only from the tokens (`bg-surface`, `text-ink-muted`, `border-line`…). Never `slate-`, `teal-`, `gray-` or a hex value.
4. Apply section 6: at most 7 visible fields per card, one main button, the rest behind `MoreFields`, `CollapsibleCard` or `ActionMenu`.
5. Every string goes in `messages/en.ts` **and** `bn.ts`. No English text in a `.tsx` file.
6. Add the screen to `layout/menu.ts` (with its `area`, `permission`, and `more: true` if it is not used weekly) and the route to `main.tsx`.
7. Import shared helpers by path (`@ecommbd/shared/phone`), never the package root.
8. Money through the taka formatters in `lib/format.ts`; phones as E.164; dates in Dhaka time.
9. Hiding a button is not security: the server method needs `@Allow(...)`.
10. Animate only with `m`, `AnimatePresence` and the presets from `lib/motion.tsx`. Most screens need none: the components already move.
11. Check at 360 px and 1280 px, in Bangla and English, before saying it's done.
