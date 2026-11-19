# M10 · Back office

> Phases 51–55 · [Roadmap overview](README.md)
> **Exit criteria:** an owner records what they buy and spend, and sees a true profit and loss for any month. Stock lives in more than one place and moves between places with a record. Products have the depth BD merchants expect: several kinds of variation, units, brands and shipping classes.

**Why this milestone exists.** It came from the [Boneek competitor check](../research/competitor-boneek.md) (2026-11-14). Boneek, our main competitor, offers all of this, and owners use it to answer "did I make money this month?". Dropshipping is **out of scope** and is not part of this milestone.

These phases are planned at a higher level. **Before starting any of them, refine it** with what we've learned from real merchants (pilot, phase 41 reports, interviews), and update this file first. The product standards in the [README](README.md) apply exactly as before.

**Keep it simple.** This is a shop owner's notebook, not accounting software:
- no double-entry ledger
- no chart of accounts
- no tax filing

Every screen is in Bangla and English, with taka in whole numbers.

---

## Phase 51 — Cost and profit

| | |
|---|---|
| Milestone | M10 |
| Delivers | Cost per item on products and variations; profit per order and per product |
| Depends on | 05, 21 |
| Size | M |

**Goal.** Every order shows what it earned after product cost, delivery and COD charges.

### Decide at start

- When the cost changes, does an order keep the cost from when it was placed? (Recommended: yes, a snapshot per order line.)
- Which delivery cost counts: what the merchant pays the courier (phase 19's charge), or a flat setting?

### Build

1. A **cost per item** field on each variation, with a "same for all variations" shortcut. It's imported from WooCommerce where a cost plugin stored it (phase 21).
2. A **cost snapshot on each order line** when the order is placed. Editing an order (phase 11) recalculates it.
3. **Profit on the order page and in the order list:**
   - price − discount − product cost − courier charge − COD charge − gateway fee
   - each part shown with its source
4. **Products list:** a cost column, margin %, and a "cost missing" filter.
5. Permission `ReadCost`, for owner and manager only by default. Order staff never see cost or profit.

### Edge cases

- Cost missing: profit shows "unknown", never ৳0.
- Partly delivered or returned orders count only what was delivered.
- An order line priced below cost shows a warning, not a block.

### Done when

- [x] An order shows a correct profit breakdown, and changing a product's cost doesn't change past orders. (`bd-cost.e2e-spec.ts`, the order page profit card.)
- [x] Order staff can't see cost anywhere: not in the API, in exports or on prints. (`bd-cost.e2e-spec.ts`: profit query, product fields, product form, product list, print payload. There is no order or product CSV export.)

### Not in this phase

Purchases that set the cost automatically (52); the monthly profit and loss report (53).

---

## Phase 52 — Purchases and suppliers

| | |
|---|---|
| Milestone | M10 |
| Delivers | Suppliers, purchases (stock in), purchase returns |
| Depends on | 51 |
| Size | L |

**Goal.** Buying stock is recorded once, and stock and cost update from it.

### Build

1. **Suppliers:**
   - name, phone (E.164), address, note
   - balance owed
   - list and detail pages with purchase history
2. **Purchase:**
   - supplier, date, reference number (with a prefix setting)
   - lines: variation, quantity, unit cost
   - delivery and other charges, discount, paid and due amounts, attached photo of the bill
   - statuses: Draft, Ordered, Received (partly or fully)
   - receiving adds stock (phase 05's adjustments, reason "purchase") and can update the cost per item: latest cost or weighted average, as a store setting
3. **Purchase return:** pick lines from a purchase; it removes stock and reduces what's owed to the supplier.
4. **Supplier payments:** record a payment against the balance. It ties into accounts in phase 53.
5. **Prints:** purchase order and receipt prints, reusing phase 06's print layouts.

### Edge cases

- Receiving more than was ordered is allowed, with a note.
- Receiving into a hidden or archived product is allowed.
- Deleting a received purchase isn't allowed: return it instead.
- Average cost with zero stock falls back to the latest cost.

### Done when

- [x] Receiving a purchase raises stock and cost correctly. A return reverses both. The supplier balance matches its purchases, returns and payments. (`bd-purchases.e2e-spec.ts`, the purchase page and the supplier page.)

### Not in this phase

Purchase orders emailed to suppliers; supplier portals.

---

## Phase 53 — Accounts, expenses and profit and loss

| | |
|---|---|
| Milestone | M10 |
| Delivers | Cash and bank accounts, transactions, expenses with expense heads, the profit and loss report |
| Depends on | 51, 52, 41 |
| Size | L |

**Goal.** An owner sees where money is, and whether the month made a profit.

### Build

1. **Accounts:**
   - kinds: cash, bank, bKash/Nagad/Rocket wallet, courier balance
   - opening balance and current balance
   - which account receives what: COD settlements (phase 37's reconciliation), gateway payouts, manual MFS payments (phase 08)
2. **Transactions history:** every movement in or out, with its source (order, purchase, expense, transfer between accounts, manual entry). It can be filtered and exported.
3. **Expenses:**
   - date, expense head, amount, account, note, receipt photo
   - default heads: rent, salary, ads (Facebook), packaging, delivery, utilities, other
   - heads can be edited
4. **Profit and loss report**, for any date range in Dhaka time:
   - sales (delivered)
   - − product cost (51)
   - − delivery and COD charges
   - − gateway fees
   - − expenses by head
   - = profit

   It compares with the previous period, can be printed, and joins phase 41's reports.
5. Permission `ManageAccounts`, owner only by default.

### Edge cases

- Returns after the period has closed count in the month they happen, with a note.
- Transfers between accounts are not counted as profit or loss.
- Ad spend can be entered by hand. An optional Meta import is left for later.

### Done when

- [x] A month of pilot data produces a profit and loss the owner agrees with when checked against their own notebook.

### Not in this phase

Payroll, tax and VAT returns, bank feeds.

---

## Phase 54 — Branches and stock transfers

| | |
|---|---|
| Milestone | M10 |
| Delivers | Several stock locations (branches or warehouses), stock transfers, pickup branch per courier |
| Depends on | 05, 19, 52 |
| Size | L |

**Goal.** A merchant with a shop and a warehouse knows what is where, and ships from the right place.

### Decide at start

- Use Vendure's built-in stock locations and allocation strategy, or a simpler layer on top? (Recommended: Vendure's, with our own screens.)

### Build

1. **Branches:**
   - name, address (district/thana), phone, note
   - which branch sells online
   - default branch per delivery zone
2. **Stock per branch** on the product and inventory screens. Purchases (52) receive into a chosen branch.
3. **Stock transfer:**
   - from, to, lines, reference number (prefix)
   - statuses: Sent, then Received (partly or fully)
   - stock stays "in transit" until received
4. **Pickup branch per courier account** (phase 19). Orders show which branch ships them.
5. **Limits:** branches count toward plan limits (phase 39).

### Edge cases

- Selling an item that only another branch has: the order is allowed, with a "transfer needed" flag.
- Deleting a branch that still holds stock isn't allowed.

### Done when

- [x] Stock is correct per branch through purchases, sales, returns and transfers. The courier pickup address follows the branch. (`bd-branches.e2e-spec.ts`: purchase receive and return, sale, cancel, order return, transfer send and receive, and the booking snapshot. The purchase, product, stock and order screens show the branch.)

### Not in this phase

Point of sale at a branch (not planned); a per-branch storefront.

---

## Phase 55 — Product depth

| | |
|---|---|
| Milestone | M10 |
| Delivers | Several kinds of variation per product, units, brands, shipping classes and dimensions, media library, product status (draft, archived, trash) |
| Depends on | 05, 07, 09, 13, 21 |
| Size | L |

**Goal.** Products can be set up the way BD merchants already think about them.

### Build

1. **Variation kinds:**
   - more than one kind per product (for example size × colour), from shared variation kinds kept at store level (Vendure option groups)
   - a matrix editor with bulk price and stock
   - today's single-kind products migrate without changes
2. **Units:** piece, kg, gram, litre, dozen, set, plus custom units. Shown next to the price and on invoices.
3. **Brands:**
   - brand pages, a brand filter, a logo and description
   - brand in structured data
   - brands imported from WooCommerce (see the roadmap's candidate features)
4. **Shipping classes:**
   - examples: bulky, fragile, small parcel
   - an extra charge per class on delivery rates (phase 07)
   - length, width and height next to weight
5. **Media library:** every uploaded image in one place, with search, reuse across products and pages, and the alt text kept. It reuses phase 09's pipeline.
6. **Product status:** Published, Draft, Archived, Trash (restorable for 30 days). This replaces the "hidden" flag.
7. **Number prefixes for:** products, purchases, purchase returns, stock transfers, order returns and replacements.

### Edge cases

- A variation combination that doesn't exist (for example XL in red) can be switched off.
- A brand that is deleted while products use it: the products keep working with no brand.

### Done when

- [ ] A size × colour product is created, sold and imported from WooCommerce correctly.
- [ ] Brand pages and filters work.
- [ ] A shipping class changes the delivery charge.

### Not in this phase

Product bundles and kits; digital products.
