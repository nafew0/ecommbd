# M12 · Services and admin redesign

> Phases 63–66 · [Roadmap overview](README.md)
> **Exit criteria:**
> - The merchant admin has a calmer layout, with global search, notifications, a real dashboard and a faster order workflow.
> - Store controls match the competition.
> - Merchants can pay us to confirm COD orders by AI voice call or through a call centre.

**Why this milestone exists.** It came from the [Boneek competitor check](../research/competitor-boneek.md) (2026-11-14). We offer paid services **ourselves or with partners**, as normal paid settings. **There is no add-on store or marketplace.**

**Order:** 63a (the new look, menu and reference screens) is built **next, before any other new admin screen**, so that every later screen copies it. 63b follows. 63c can wait for its place in the milestone.

These phases are planned at a higher level. **Refine each one before starting it**, and update this file first.

---

## Phase 63 — Admin redesign

| | |
|---|---|
| Milestone | M12 |
| Delivers | A new admin look, menu and "essentials first" screens (63a, 63b); then global search, notifications, a dashboard and a faster order workflow (63c) |
| Depends on | 02b, 04 |
| Size | L (63a, 63b, 63c) |

**Goal.** The admin feels like Shopify: calm, fast to scan, and in Bangla first. A merchant sees the essentials in one click; everything else is behind "More".

**The design is fixed in the [merchant admin design guide](../design/admin-design-guide.md).** Read it before any of the three parts.

**Order (changed 2026-11-14): 63a is built next, before any other new admin screen.** Later phases, some built by other AI models, copy its patterns, so it has to exist first.

### 63a — Design system, shell and reference screens (M)

No URL, API or permission changes. Follow the guide's [build order](../design/admin-design-guide.md#8-build-order-for-phase-63a):

1. Colour, type and spacing tokens; no raw Tailwind palette classes left.
2. The existing components restyled; new ones added (`Page`, `TwoColumn`, `Tabs`, `MoreFields`, `CollapsibleCard`, `ActionMenu`, `SaveBar`, `StatTile`…), all shown on `/admin/ui-kit`.
3. **The shell:**
   - a dark top bar with search, language, "View store" and an avatar menu
   - a sidebar of about 10 top-level items, one group open at a time, less-used screens under "More"
   - **Online store** and **Settings** as their own areas with "← Back"
4. **Search (Ctrl/⌘+K)** for screens and actions, so nothing hidden under "More" is lost.
5. **Five reference screens** rebuilt to the four page templates: order list, product form, order page, delivery settings, home.

Done when: the checklist in the guide's [section 9](../design/admin-design-guide.md#9-done-when-63a) passes.

**Built 2026-11-14 (status: Review).** Also added, at the owner's request: **Motion** in its light `LazyMotion` form for the menu, cards and pages, and a **skippable guided tour** of the menu on a first visit. Left for 63c: the store's name and a "View store" link in the top bar, and menu counts beyond Confirm orders. Checked: lint, types, unit tests, and the admin browser tests on an empty database (shell, orders, products, delivery, customers, print, page editor, sales pages). Not yet checked: the order page by eye with real orders, the WooCommerce migration browser test (it needs import keys), and the screens 63b has not reached, which only have the new colours.

### 63b — Every other screen (M)

Each remaining screen in the guide's [screen table](../design/admin-design-guide.md#7-screen-by-screen) moves to its template, with the "essentials first" rules applied. One small task per screen, copying a reference screen. Suitable for a second AI model, reviewed afterwards.

Done when: every existing screen follows its template, and no screen shows more than 7 fields in a card or more than one main button.

**Built 2026-11-14 (status: Review).** What changed and what was left alone is listed in the guide's [build order section](../design/admin-design-guide.md#8-build-order-for-phase-63a). Not done: a field-by-field count on every card, so a few cards may still show more than 7 fields.

### 63c — New functions (L)

These need server work.

1. **Global search:** orders by number or phone, products and customers, added to 63a's search. It respects permissions.
2. **Notifications:**
   - triggers: new orders, payments to check, failed courier bookings, low stock, risky orders, SMS balance
   - delivery by server-sent events
   - a "mark all read" button, and a choice of what to be notified about
3. **Dashboard:**
   - date range
   - KPI tiles: sales, orders, items, average order value
   - a sales chart
   - status tiles that link to the filtered order list
   - recent orders
   - help videos (phase 33)
4. **Order list:** column picker, sort, page size, risk icon, quick preview; rare statuses under "Others".
5. **Order page:**
   - previous/next order arrows
   - timeline with **staff-only comments**
   - courier score card (phase 37), tags
6. **Empty states** with a "How to" video. A live preview beside forms that change the storefront.

**Built 2026-11-14 (status: Review), simpler than planned in places:**

- **Search:** orders, products and customers from Ctrl/⌘+K, through the existing list queries.
- **Notifications:** a bell that lists the work waiting (orders to confirm, payments to check, orders to pack, addresses the courier can't place, unfinished checkouts, low stock) with a dot when a count grows. It refreshes every minute. **No server-sent events, no stored "read" state and no per-person choice of what to be notified about:** the bell is a to-do list built from counts the server already had. Failed courier bookings, risky orders and SMS balance are not in it yet.
- **Dashboard:** date range, four KPI tiles, a bar per day, orders per status, latest orders (`bdDashboard`).
- **Order list:** sort, a column chooser, page size, the risk badge beside the status, a quick look, and Awaiting payment, Partly delivered, Returned and Cancelled under "Others".
- **Order page:** arrows to the newer and older order (`bdOrderNeighbours`), and staff-only notes in the history.
- **Top bar:** the store's name, "View store", and counts on four menu items.

**Not built, with the reason:**

- **Courier score card:** needs phase 37.
- **Help videos in empty states and on the dashboard:** need phase 33's videos.
- **Order tags:** needs a new field and a migration; left for its own small task.
- **A live preview beside storefront forms:** no form needed it yet; the page and theme editors already have one.
- **Real-time notifications (SSE):** see above. Add it when merchants ask for alerts while the admin is open on another screen, or with the mobile app (48).

### Edge cases

- Long Bangla labels in tabs and the sidebar.
- On phones: the sidebar becomes a drawer, and tables hide columns.
- Search never shows data a role can't see.
- A hidden field that has an error, or a value the merchant set, opens by itself.

### Done when

- [ ] Every existing screen works in the new layout.
- [ ] Bangla-only merchants (phase 33's group) find orders, products and settings faster than before, timed.

### Not in this phase

A mobile app (48).

---

## Phase 64 — Store controls

| | |
|---|---|
| Milestone | M12 |
| Delivers | Maintenance mode, hide from search engines, VAT %, more number prefixes, invoice logo, storefront switches |
| Depends on | 12, 06, 17 |
| Size | M |

**Goal.** The small store settings competitors have, done properly.

### Build

1. **Maintenance mode:** a "we'll be back soon" page that is cached correctly (phase 17 purges it) and returns 503 with Retry-After. Staff with a preview link still see the store.
2. **Hide from search engines:** `noindex` plus a `robots.txt` change, with a warning, for the whole store.
3. **VAT %:** prices include VAT by default, as is usual in Bangladesh. It is shown on invoices.
4. **Number prefixes:** order, order return and replacement (the other prefixes are in phase 55).
5. **Invoice logo,** separate from the store logo.
6. **Storefront switches:** cart drawer or cart page, breadcrumbs, back-to-top button. These become simple theme settings.
7. **Return window in days:** used by returns (phase 37).

### Done when

- [ ] Maintenance mode can be switched on and off without stale pages anywhere.
- [ ] Turning on "hide from search engines" is visible in `robots.txt` and on every page within a minute.

---

## Phase 65 — Order confirmation services I

| | |
|---|---|
| Milestone | M12 |
| Delivers | An order limit per device; address clean-up for free-text addresses |
| Depends on | 11, 21 |
| Size | M |

**Goal.** Fewer fake and undeliverable orders before anyone picks up a phone.

### Build

1. **Order limit per device:** a first-party device ID (a cookie plus a localStorage value). Up to N orders per device in X hours, with the same message as phase 11's limits. Disclosed in the privacy policy.
2. **Address clean-up:**
   - for addresses typed as free text: imported orders (21), phone orders, and the courier's own address strings
   - suggests the district, thana and a tidy street line
   - staff must confirm the suggestion; nothing is changed silently
   - rule-based matching on bd-geo first; an AI model only as a fallback, sending no personal data beyond the address text
   - every change is recorded in the order timeline

### Done when

- [ ] The device limit stops repeat test orders from one browser.
- [ ] Address suggestions are right for at least 90% of a sample of 200 real imported addresses.

---

## Phase 66 — Order confirmation services II (paid)

| | |
|---|---|
| Milestone | M12 |
| Delivers | AI voice confirmation calls in Bangla; a call-centre service (ours or a partner's), both paid |
| Depends on | 04, 38, 39, 65 |
| Size | L |

**Goal.** A merchant can switch on "we call your COD customers for you" and pay per call.

### Decide at start

- Build our own voice agent, or resell a provider through an integration?
- Which call-centre partner, if any?
- Pricing: per call, or credits (phase 39)?
- Recording and consent rules in Bangladesh (phase 42's legal review).

### Build

1. **Settings, not an add-on store:**
   - Settings → Order confirmation offers: off, AI call, or call centre
   - which orders get a call: all COD, first-time customers, or risky
   - retry rules and calling hours
2. **AI voice call:**
   - calls the customer and confirms the order in Bangla: items, total, address
   - records the answer (confirmed, cancelled, wrong number, call back) on the order in the confirmation queue (phase 04)
   - writes a timeline entry
   - transcripts are kept for 30 days
3. **Call centre:**
   - orders are passed to agents (ours or a partner's) through a limited agent view
   - the agent sees only the fields needed: name, phone, items, total, address
   - same outcomes and timeline entries as the AI call
4. **Billing:** usage is metered and charged through phase 39's credits. A daily cap per store.
5. **Reports:** confirmation rate, cancellations and cost per confirmed order, inside phase 41's reports.

### Security and privacy

- Agents get no other access to the store, and every action is logged (phase 32's activity log).
- Customer phone numbers are never exported to partners in bulk: calls go through our system.

### Done when

- [ ] In a 2-week pilot, AI calls confirm orders with the outcome recorded correctly.
- [ ] The cost per confirmed order is known.
- [ ] A merchant can switch the service on or off without help.

### Not in this phase

A shared inbox for Messenger, Instagram and WhatsApp (later candidate).
