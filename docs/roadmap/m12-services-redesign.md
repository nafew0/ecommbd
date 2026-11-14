# M12 · Services and admin redesign

> Phases 63–66 · [Roadmap overview](README.md)
> **Exit criteria:**
> - The merchant admin has a calmer layout, with global search, notifications, a real dashboard and a faster order workflow.
> - Store controls match the competition.
> - Merchants can pay us to confirm COD orders by AI voice call or through a call centre.

**Why this milestone exists.** It came from the [Boneek competitor check](../research/competitor-boneek.md) (2026-11-14). We offer paid services **ourselves or with partners**, as normal paid settings. **There is no add-on store or marketplace.**

**Suggested order:** 63 (the redesign) is cheap and changes how the product feels in a demo. Consider pulling it ahead of the pilot (31), together with phase 37's courier score.

These phases are planned at a higher level. **Refine each one before starting it**, and update this file first.

---

## Phase 63 — Admin redesign

| | |
|---|---|
| Milestone | M12 |
| Delivers | A new admin layout, global search, notifications, a dashboard, a new order list and order page |
| Depends on | 02b, 04 |
| Size | L |

**Goal.** The admin feels like Shopify: calm, fast to scan, and in Bangla first.

### Build

1. **Layout:**
   - **Top bar:** logo, global search, notifications bell, store name, avatar menu.
   - **Sidebar:** about 10 top-level items; the active group opens its submenu.
   - **Online store and Settings:** each opens as its own full-height area with "← Back to dashboard".
   - **Look:** neutral colours (very light grey page, white cards, near-black main buttons, colour only for statuses) and full-width tables.
2. **Global search (Ctrl/⌘+K):** finds screens, actions ("Create order"), orders by number or phone, products and customers. It respects permissions.
3. **Notifications:**
   - triggers: new orders, payments to check, failed courier bookings, low stock, risky orders, SMS balance
   - delivery by server-sent events
   - a "mark all read" button, and a choice of what to be notified about
4. **Dashboard:**
   - date range
   - KPI tiles: sales, orders, items, average order value
   - a sales chart
   - status tiles that link to the filtered order list
   - recent orders
   - the confirmation widgets we already have
   - help videos (phase 33)
5. **Order list:**
   - status **tabs with counts**, with rare statuses under "Others"
   - column picker, sort, page size
   - risk icon, quick preview
6. **Order page:**
   - header with badges, previous/next order arrows, and Print and More menus
   - **one main "next step" button** with a menu of other actions
   - payment card
   - timeline with **staff-only comments**
   - right-hand cards: courier score, risk, customer (copy buttons), tags, note, attribution
7. **Empty states** with one action and a "How to" video. A live preview beside forms that change the storefront.

### Edge cases

- Long Bangla labels in tabs and the sidebar.
- On phones: the sidebar becomes a drawer, and tables become cards.
- Search never shows data a role can't see.

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
