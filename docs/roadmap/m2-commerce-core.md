# M2 · Bangladesh commerce core

> Phases 03–11 · [Roadmap overview](README.md)
> **Exit criteria:** through the API alone, a shopper orders by phone with COD; staff confirm, print and verify payments; the customer gets SMS; and fake orders are caught.

All work in this milestone is Vendure plugins in `apps/core/src/plugins/` plus screens in our merchant admin (`apps/admin`, phase 02b). The storefront comes in M3, so flows here are proven through API end-to-end tests and the admin.

---

## Phase 03 — Phone-first customers and guest checkout API

| | |
|---|---|
| Milestone | M2 |
| Delivers | Phone-only checkout (P0, API side), BD phone validation (P0), customer list keyed by phone (P0) |
| Depends on | 02 |
| Size | M |

**Goal.** A shopper checks out with name, phone and address only, and is recognised by phone number. No email is ever required or shown.

### Decide at start

- **Names:** how one full name maps onto Vendure's `firstName` and `lastName`. Recommended: the full name in `firstName` and `lastName` empty, if Vendure accepts that; otherwise split on the last space. The order address always keeps the full name as typed.
- **Guest checkout for registered phones:** Vendure's guest checkout strategy can allow guests to use a registered customer's identity. Recommended: allow it (COD shoppers often don't remember they "registered"), and never show account data to a guest.
- **Placeholder email** format: `<digits>@phone.invalid`. `.invalid` is a reserved top-level domain, so mail can never be delivered to it.

### Build (plugin `bd-checkout`)

1. **Customer custom fields:**
   - `phone` (E.164, indexed; unique among customers this plugin creates)
   - `alternatePhone`
   - `source` (web, manual, import)
   - `internalNotes`
   - denormalized stats, updated from events: orders, delivered, returned, cancelled, total spent
2. **Shop API mutation `setCustomerForOrderByPhone(input: { name, phone, alternatePhone?, email? })`:**
   - Normalizes and validates the phone with `packages/shared`.
   - Finds the customer by phone, or creates a guest customer with the placeholder email.
   - Attaches the customer to the active order.
   - Returns typed errors: `INVALID_PHONE`, `NOT_A_MOBILE`, `NAME_REQUIRED`, `NAME_TOO_LONG`.
3. **Shop API mutation `setOrderShippingAddressBD(input)`:**
   - Validates `districtId` and `thanaId` (phase 02) and fills Vendure's address fields plus our custom fields.
   - Typed errors (`UNKNOWN_DISTRICT`, `THANA_NOT_IN_DISTRICT`, `ADDRESS_TOO_SHORT`) with Bangla and English messages keyed by code.
4. **Order custom fields:**
   - `customerNote` (max 500 characters)
   - `contactEmail`, used only when a real email was given but belongs to another customer
   - `locale` (the shopper's language, for SMS)
5. **Checkout settings** (settings store): show or hide email and alternate phone, whether the note is shown, minimum address length, and whether international phones are allowed (default off).
6. **A guard before payment:** an order can't move to `ArrangingPayment` without a valid phone and a BD-validated address. Use Vendure's order interceptor or order process, whichever gives clearer errors.
7. **Dashboard:**
   - the customer list shows phone instead of the placeholder email, with search by phone (normalized; partial matches on the last digits)
   - the customer detail shows phone, alternate phone, stats and internal notes
   - anywhere Vendure would display a placeholder email, it shows the phone instead
8. **`isPlaceholderEmail()`** helper used by every later feature: SMS, email, exports and Meta.

### Edge cases

- **One phone, several people** (a family sharing a number): one customer record. Each order keeps the name and address typed for it. The customer record's name is set from the first order and isn't overwritten.
- **Shopper uses a phone that belongs to a registered customer:** the order links to that customer for history and stats. The response reveals nothing about the account (no saved addresses, no name).
- **Real email given that already belongs to another customer:** don't attach it to this customer; store it as the order's `contactEmail`.
- **Two checkouts with the same new phone at the same moment:** the unique index makes one fail; catch it, re-read and attach the existing customer.
- **Name edge cases:** Bangla script, emoji, one word, only spaces (rejected), over 100 characters (rejected), leading/trailing spaces (trimmed).
- **Phone formats:** Bangla digits, pasted `+880`, a landline (rejected with "enter a mobile number"), a foreign number (rejected unless the store allows international phones; never sent SMS).
- **Older API clients** that call Vendure's standard `setCustomerForOrder` with an email: still works, but the guard requires a phone before payment.
- **Placeholder email** must never appear in the Dashboard, exports, Meta payloads or emails. Tests cover each surface that exists so far.

### Security

- **Rate limits** on both mutations, per session and per phone (Redis): this blocks phone-number probing and spam carts.
- **No information disclosure.** Responses never reveal whether a phone has an account or past orders. Don't prefill saved addresses for unauthenticated shoppers: it's tempting, but it would leak addresses to anyone who knows a phone number. Prefill only after OTP login (phase 34).
- Input limits and control-character stripping on all fields.
- Phones in logs are masked (last 3 digits).

### Tests

- End-to-end: a full checkout through the API (dummy payment until phase 08) with name, phone, district, thana and address, and no email anywhere.
- End-to-end: same phone twice gives the same customer; the concurrent same-phone race is handled; an email conflict is handled.
- End-to-end: every typed error in both languages; the guard blocks payment without a phone.
- Rate limit hit returns a clear error.

### Done when

- [ ] An API checkout with only name, phone and a district/thana address places an order.
- [ ] The customer list is searchable by phone and never shows a placeholder email.
- [ ] All edge cases above have passing tests.

### Not in this phase

The checkout UI (14), OTP (11 and 34), incomplete-order capture (11).

---

## Phase 04 — BD order workflow, order numbers and confirmation queue

| | |
|---|---|
| Milestone | M2 |
| Delivers | Order list with BD statuses (P0), confirmation workflow (P0), search by phone (P0), home widgets (P0, part) |
| Depends on | 03 |
| Size | L |

**Goal.** Orders move through the statuses Bangladeshi merchants use, and staff confirm or cancel orders by phone quickly, without stepping on each other.

### Decide at start

- **Mapping to Vendure states.**
  - "New" maps to `PaymentAuthorized` (COD and advance orders) or `PaymentSettled` (fully prepaid).
  - Custom states `Confirmed`, `Packed` and `Returned` are added with Vendure's order process.
  - "Shipped", "Delivered" and "Cancelled" use Vendure's own states.
  - Document every allowed transition in an ADR.
- **When an order counts as placed** (Vendure's order-placed strategy): when the shopper completes checkout, including COD.
- **Order number format:** sequential per store (`1001`, `1002`…) with an optional prefix (`MF-1001`).

### Build (plugin `bd-orders`)

1. **Order states** through Vendure's order process, with Bangla/English labels and colours:
   - New → Confirmed → Packed → Shipped → Delivered
   - Cancelled is allowed from New, Confirmed or Packed.
   - Shipped → Returned, and PartiallyDelivered → Returned for the returned part.
   - Guards:
     - Packing needs confirmation, unless the store setting "skip confirmation for prepaid orders" is on.
     - Cancelling needs a reason code.
     - Shipped orders can't be cancelled, only returned.
2. **Human order numbers.** Vendure gives an order its `code` when the cart is created, so sequential codes would leave gaps from abandoned carts. Instead, keep Vendure's random `code` for carts and add an `orderNumber` custom field, assigned **when the order is placed** from a PostgreSQL sequence (safe under concurrency). Show `orderNumber` everywhere merchants and shoppers look: Dashboard, SMS, invoices, couriers.
3. **Cancel reasons** (codes plus free text): fake order, customer cancelled, unreachable, duplicate, out of stock, price issue, other.
4. **Confirmation queue** (Dashboard route "Confirm orders"):
   - Lists New orders, oldest first.
   - Each row: order number, time since placed, name, phone and alternate phone as tap-to-call `tel:` links, district/thana, item summary, total, payment type (COD, advance paid, prepaid), customer note, and a risk badge (filled in by phase 11).
   - **Actions:**
     - Confirm and Cancel (reason required).
     - **No answer** adds a call attempt and moves the order down.
     - **Call later** snoozes until a chosen time.
     - Edit, which opens phase 05's editor.
   - Keyboard shortcuts, plus bulk confirm for orders already verified.
   - **Call log:** each attempt is a history entry with outcome, staff member and time.
   - **Claiming:** opening an order claims it for 5 minutes and shows "Rahim is calling" to others, so two people don't call the same customer.
   - Optional **auto-cancel suggestion** (store setting, off by default): unconfirmed after N days with M failed calls. It only suggests, and never cancels by itself unless the merchant turns that on.
5. **Optimistic locking** on transitions. If two staff act on the same order, the second sees "Already confirmed by Karim 1 minute ago" instead of a double transition.
6. **Order list** (admin list page):
   - columns: order number, customer name, phone, district, BD status, payment type, total, date
   - status tabs with counts ("All (120) · New (12) · Confirmed (5) …")
   - filters: status, Dhaka-time date range, district, payment type
   - search by phone, order number or name
   - **order detail page:** items, customer, address, payment, delivery charge, notes, status history and the actions for the current status
7. **Home widgets:** today's orders and sales (Dhaka day), waiting for confirmation, and confirmed but not packed.
8. **Events** on Vendure's event bus for later phases: `OrderConfirmed`, `OrderPacked`, `OrderReturned`, `OrderCancelledWithReason`, each with the acting staff member.
9. **Imported-order flag** (`imported = true`). Imported orders never fire these events (used from phase 21).

### Edge cases

- Confirming an order whose stock ran out in the meantime: warn and offer edit or cancel.
- Cancelling an order with a paid advance or online payment: the cancel flow requires a refund record (phase 08).
- **Partial delivery** (customer keeps 1 of 3 items): PartiallyDelivered, with a per-line returned quantity. The full returns workflow comes in phase 37, but the data model supports it now.
- Duplicate orders from the same phone with the same items within 30 minutes: flag "possible duplicate", with a one-click cancel as duplicate.
- An invalid transition through the API returns a clear typed error, not a server error.
- Eid volume (2,000+ New orders a day): queue pagination, indexes on (state, placedAt) and fast filters. Load test the queue query.
- An order placed at 23:59 Dhaka time counts for that day in the widgets, even though it's 17:59 UTC.
- A staff member closes the browser while holding a claim: the claim expires after 5 minutes.
- An imported order in a final state appears in lists, but can't enter the queue.

### Security

- **Custom permissions:** `ConfirmOrder`, `CancelOrder`, `PackOrder`, `ReadSalesFigures`. Order staff can confirm without seeing sales totals; the widgets check permissions.
- Every transition is recorded with the staff member (Vendure history plus our events). The full activity log comes in phase 32.
- Order numbers are guessable by design, so no shopper-facing lookup may work with the number alone (enforced in phase 14).

### Tests

- End-to-end state machine: every allowed transition succeeds; every disallowed one fails with the right error.
- Concurrency: two simultaneous confirms result in one success and one "already confirmed".
- Order numbers: 200 concurrent placements give 200 unique, consecutive numbers; abandoned carts consume none.
- Dhaka day-boundary test for widgets.
- Playwright: the confirmation queue (confirm, cancel with reason, no answer, call later, claim indicator).
- Events fire for real orders and never for imported ones.

### Done when

- [ ] A COD order placed through the API appears as **#1001 New** in the confirmation queue.
- [ ] Staff confirm in two clicks; cancelling requires a reason; history shows who did what and when.
- [ ] Two staff can't confirm the same order twice.
- [ ] Order numbers have no gaps from abandoned carts.
- [ ] Home widgets show correct Dhaka-day numbers.

### Not in this phase

Editing orders (05), printing (06), courier booking and automatic Shipped/Delivered (19), the returns workflow (37).

---

## Phase 05 — Manual orders, order editing and stock rules

| | |
|---|---|
| Milestone | M2 |
| Delivers | Manual order entry (P0), stock deduction (P0), product and category screens (P0) |
| Depends on | 04 |
| Size | L |

**Goal.** Staff add products on one simple page; enter orders taken by phone, Messenger or WhatsApp in under a minute; fix orders before they ship; and stock never oversells.

### Build

1. **Manual order page** (Dashboard), built on Vendure's draft orders:
   - Find a customer by phone or create one inline. Address uses the district → thana picker.
   - Product search showing stock and variants, with quantities.
   - Line price override and order discount (fixed amount), both permission-gated.
   - Shipping calculated by phase 07's rules, with a manual override.
   - Payment: COD, already paid (method and TrxID), or partial advance (phase 08).
   - **Source:** Messenger, Facebook comment, phone, WhatsApp, walk-in, other.
   - "Send SMS to customer" toggle.
   - Creates the order as New, or directly as **Confirmed**, since staff already spoke to the customer.
2. **Editing orders before shipping**, using Vendure's order modification:
   - change quantities, add or remove items, change variant
   - change address or district (shipping recalculates)
   - change the shipping charge, add a discount
   - **Money differences:** COD orders just change the COD amount due. For prepaid orders, an increase asks for an additional payment and a decrease creates a refund record.
3. **Stock rules:**
   - Stock is allocated when the order is placed, released on cancel, and on return goes back to stock or to "damaged", chosen per item.
   - **No overselling under concurrency.** Verify how Vendure 3.8 checks saleable stock at add-to-cart and at placement. If two shoppers can both buy the last unit, add a guard that locks the stock row at placement (`SELECT … FOR UPDATE` through the transactional connection) in an order interceptor.
   - Per-variant **allow backorders** (pre-orders), off by default.
   - Stock adjustments with a reason (recount, damaged, gift) in the history.
4. **Edit history:** every change records the user, time, and before/after values, visible on the order.
5. **Product screens** (admin), on Vendure's products, variants and collections. The fields follow [reference-bd-admin.md](../research/reference-bd-admin.md#product-form-one-page-opens-as-a-dialog):
   - **Product list:** image, name, category, price with the old price struck through, stock, Featured and New badges, search, and edit, duplicate and delete actions.
   - **Product form on one page:**
     - name in Bangla and English, main image, gallery, customer-feedback images (review screenshots)
     - price, old price, stock, category, short and full description, YouTube link, Featured and New switches
     - **delivery for this product:** free delivery, or its own inside/outside Dhaka charges (used by phase 07)
     - **variations:** size, colour, pack or custom, each with price, stock, image and a default
     - a collapsed **More** part for SKU, weight, tags and SEO, so beginners never need it
   - **Categories:** name in both languages, image, parent and order.
   - **Stock:** a list of variants with quantity and low-stock highlight, and quick adjustment with a reason.

### Edge cases

- Abandoned draft orders: deleted automatically after 7 days.
- A product saved without a Bangla name: the English name is used everywhere, and the list shows a "Bangla missing" hint.
- A manual order for an existing customer with a new address doesn't overwrite saved addresses unless staff choose "save to customer".
- Editing an order that's already booked with a courier: blocked with "Cancel the courier booking first". The hook is added here; phase 19 calls it.
- Editing an order with promotions: promotions re-evaluate. If a coupon no longer qualifies, keep the original discount unless staff remove it, and show a warning.
- The last unit bought by two shoppers at the same moment: exactly one succeeds; the other sees "just sold out".
- An ordered variant deleted later: the order keeps its line snapshot (name, SKU, price).
- A quantity change that makes stock negative: blocked, unless backorders are allowed.

### Security

- **Permissions:** `CreateManualOrder`, `EditOrder`, `OverridePrice`, `ApplyManualDiscount`.
- **Discount cap per role:** for example, order staff up to 10%, owners unlimited.
- Price overrides and discounts are always recorded with the original value.

### Tests

- End-to-end: manual order in each payment mode; created directly as Confirmed; SMS toggle respected.
- End-to-end: modifications that raise or lower the total for COD and prepaid orders.
- **Concurrency:** 50 parallel orders for a variant with 10 units place exactly 10.
- Restock and damaged flows on return.

### Done when

- [ ] Staff add a product with three variations and a gallery on one page, on a phone.
- [ ] Staff create a Messenger order in under a minute in the admin.
- [ ] Editing a confirmed order recalculates totals, updates the COD amount and records before/after values.
- [ ] The concurrency test proves no overselling.

### Not in this phase

Bulk product editing (35), the returns workflow (37).

---

## Phase 06 — Invoices, packing slips and courier stickers

| | |
|---|---|
| Milestone | M2 |
| Delivers | Bulk invoice and sticker printing (P0) |
| Depends on | 04 (07 and 19 add shipping and tracking details when available) |
| Size | M |

**Goal.** The packing desk prints exactly what it needs, in bulk, in Bangla and English, on the printers BD merchants actually own.

### Decide at start

- **Rendering:** HTML print views printed by the browser, not server-side PDF libraries. Most Node PDF libraries don't shape Bangla conjuncts correctly; the browser does. Confirm with a quick test of both approaches and record the decision.
- A barcode library: Code 128 rendered as SVG (for example `bwip-js` or `JsBarcode`). Check licence and size.

### Build

1. **Print templates** (Dashboard routes rendering print-optimised pages):
   - **A4 and A5 invoice.**
     - Logo and store contact details.
     - Order number with barcode, and the date in Dhaka time.
     - Customer name, phone and alternate phone, plus full address with area and district.
     - Item lines with variant, quantity, unit price and line total.
     - Subtotal, discount, delivery charge, total, amount paid, and **COD due** in large type.
     - Payment method, customer note, and a footer with the return policy summary.
   - **Packing slip:** items and quantities, no prices.
   - **80 mm thermal receipt.**
   - **Courier stickers:** 4×6 in, 3×4 in, and an A4 sheet with 8 or 12 labels. Each shows the recipient, phone, address, COD amount, order number barcode, and the courier consignment barcode once booked.
2. **Bulk print:** select orders in the list, choose a template, print. Batches of 100 per print job keep the browser responsive.
3. **Settings:** default template per document, fields to show or hide, language (Bangla, English or both), footer text, and Bangla digits on/off.
4. **Fonts:** print views use a self-hosted, subset Bangla font so output looks the same on every staff PC. The usual fallbacks (Nirmala UI on Windows, the Noto Sans Bengali family) render inconsistently. Print views aren't performance-critical, so the font download is fine here.
5. **Tracking:** a "printed" mark on each order, and "Reprint" shown on later prints.

### Edge cases

- Long addresses on small stickers: automatic font downsizing to a minimum, then wrapping. Never cut off the phone or COD amount.
- 50+ line items: multi-page invoices with repeated headers and "page 2 of 3".
- Very long product names: wrap, never overflow.
- Orders without a courier booking yet: the sticker shows the order barcode only.
- Thermal printers with odd margins: a printing guide in the help draft (browser margins set to "None").
- Mixed-language data (Bangla address, English product name) on one document.
- Amounts in Bangla digits when that setting is on, everywhere on the document.

### Security

- Print routes need authentication and a `PrintOrders` permission.
- `Cache-Control: no-store` on print views, so personal data isn't kept in caches.
- Only order data the user's role may see is rendered (for example, the packer role sees no prices on packing slips).

### Tests

- Snapshot tests of each template's HTML with Bangla and English fixtures.
- Playwright print-to-PDF smoke test per template (layout fits the page size; barcodes scan with a barcode library in the test).
- A one-time visual check of Bangla conjuncts on Windows and macOS Chrome, recorded with screenshots in the PR.

### Done when

- [ ] Staff select 100 orders and print A4 invoices and 4×6 stickers with scannable barcodes.
- [ ] Bangla renders correctly in Chrome on Windows and macOS.
- [ ] COD amount and phone are never cut off on any sticker size.

### Not in this phase

Courier consignment barcodes (added when phase 19 lands), email invoices (later).

---

## Phase 07 — Shipping zones and rates

| | |
|---|---|
| Milestone | M2 |
| Delivers | Shipping rates: inside/outside Dhaka, per district, free-shipping threshold (P0) |
| Depends on | 02, 03 |
| Size | M |

**Goal.** Delivery charges work the way BD merchants price them today, and are calculated automatically at checkout and in manual orders.

### Decide at start

- **COD fee** (when the merchant passes the courier's COD charge on to the shopper): add it as a Vendure surcharge on COD orders, or build it into the COD shipping price. Pick the one that shows clearly on invoices.
- **Free-shipping threshold:** based on the subtotal after discounts and before shipping (recommended); confirm with the pilot merchant.

### Build (plugin `shipping-bd`)

1. **Delivery zones** from `bd-geo` (`dhaka_city`, `dhaka_suburb`, `outside_dhaka`, optional `chattogram_city`), with per-district and per-thana overrides.
2. **Shipping calculator `bdZoneRate`:**
   - base rate per zone
   - district and thana overrides
   - weight surcharge: per extra kg above a threshold, using the variant field `weightGrams`
   - per-product flat surcharge (heavy or fragile items)
   - **per-product delivery charges:** a product can have its own inside-Dhaka and outside-Dhaka charge, set in the product form (phase 05). Blank means the store default. With several products in one cart, the highest charge applies (confirm with the partner).
   - free shipping above a subtotal per zone, plus free-shipping products or collections
3. **Methods:** Standard (default), Express (optional, own rates, typically Dhaka only), and Store pickup (৳0, optional).
4. **Eligibility checker:**
   - ships to some zones or districts only (for example "inside Dhaka only")
   - maximum order weight
5. **COD fee** (optional): flat or a percentage of COD due, rounded to whole taka.
6. **Dashboard settings form** written in merchant language, for example:
   - "Inside Dhaka ৳60"
   - "Dhaka suburbs ৳100"
   - "Outside Dhaka ৳120"
   - "Free delivery above ৳2,000"

   It starts with suggested typical values that the merchant confirms, and has an advanced table for district overrides.
7. **Defaults** registered with phase 02's initializer.
8. **"Spend ৳X more for free delivery"** amount returned by the Shop API for the cart (shown in phase 14).
9. A Dashboard warning lists products missing a weight when weight-based surcharges are on.

### Edge cases

- An address without a district (an old customer, or an imported address): no shipping options until a district is chosen, with a clear message.
- A shopper changes district after picking a method: rates recalculate and an ineligible method is dropped with a message.
- Variants without weight: treated as 0 g, with the merchant warning above.
- Free-shipping threshold crossed by adding or removing items: recalculated live.
- A discount pushes the subtotal below the threshold: shipping comes back, and the shopper sees why.
- Several eligible methods: the cheapest is selected by default.
- Rates changed by the merchant while a cart is open: the new rate applies at the next cart update.
- Every charge and fee is a whole taka.

### Security

- Only `UpdateShippingMethod` can change rates. Values are validated as non-negative with sane maximums.
- No shopper input reaches the calculator except district and thana IDs, which are validated against `bd-geo`.

### Tests

- Unit: calculator matrix covering zone × weight × threshold × COD fee × overrides × free-shipping products.
- End-to-end: checkout in Mirpur (Dhaka city), Savar (suburb) and Rajshahi (outside), threshold crossing, district change, and a manual order using the same rules.

### Done when

- [ ] Checkout shows ৳60 for Mirpur, ৳100 for Savar and ৳120 for Rajshahi with the default suggestions, and free delivery above the threshold.
- [ ] Manual orders use identical rules.
- [ ] The merchant edits rates in one simple form.

### Not in this phase

Courier rate quotes (46), international shipping (not planned).

---

## Phase 08 — Payments I: COD, manual mobile banking and partial advance

| | |
|---|---|
| Milestone | M2 |
| Delivers | Cash on delivery (P0), manual bKash/Nagad (P0), partial advance (P1, built now because the payment model must support it) |
| Depends on | 04, 07 |
| Size | L |

**Goal.** Take money the way small BD merchants do today: COD, a bKash/Nagad/Rocket "Send Money" with a transaction ID, or an advance payment with the rest on delivery.

### Decide at start

- Confirm Vendure 3.8's behaviour with several payments on one order: the order reaches `PaymentAuthorized` once payments cover the total. Prove it with a spike test before building.
- Whether a shopper may place a manual mobile-banking order *before* sending money (status "awaiting payment"). Recommended: no. The TrxID is required to place the order, and shoppers who can't pay now choose COD.

### Build (plugin `payments-bd`)

1. **`cod` payment handler:**
   - Authorized at checkout for the amount due on delivery.
   - Settled when the order is Delivered, or when COD reconciliation (phase 37) marks it collected.
   - Cancelled with the order.
   - **Eligibility:** maximum order value for COD, allowed zones, disabled for blocked phones (phase 11).
2. **`manual-mfs` payment handler** (bKash, Nagad, Rocket "Send Money"):
   - **Checkout shows** the merchant's number for the chosen provider, the **exact amount**, and an instruction to write the order number as the reference.
   - **The shopper enters** the sender number and the TrxID.
   - **New payment state `PendingVerification`** (Vendure payment process).
   - **Staff verify** or reject (with reason) in a **Verify payments** queue in the Dashboard; the payment then becomes Settled or Declined.
   - **TrxID checks:** normalized to uppercase and trimmed, with a lenient per-provider format check (alphanumeric, 8–12 characters). **Unique across all orders** per provider (database unique index).
   - **Amount mismatch:** recorded as partially paid. Overpayment is noted and refunded by staff.
   - **Reminders:** unverified after N hours notifies staff.
3. **Partial advance** (store settings):
   - **Rule:** delivery charge, fixed ৳X, or X% of the total.
   - **Scope:** all COD orders, outside Dhaka only, specific products or collections, or phones flagged risky (phase 11).
   - **At checkout:** one advance payment (manual mobile banking now, online gateways in phase 18) plus one COD payment for the remainder, with both amounts shown clearly.
4. **Refund records:** cancelling an order with money received requires recording the refund (method, TrxID, amount, staff). This uses Vendure refunds with a manual handler.
5. **Display everywhere:** payment badges in order lists, "Paid ৳150 / COD due ৳1,100" on order detail, invoices and stickers (phase 06), and the COD amount sent to couriers (phase 19).
6. **Defaults:** COD enabled; manual mobile banking disabled until the merchant enters their numbers.

### Edge cases

- **Wrong amount sent:** partially paid; the COD due increases by the shortfall, if the merchant chooses that.
- **Money sent to the wrong number:** staff reject with a reason, and the shopper gets an SMS (phase 10).
- **Someone else's TrxID** (fraud): duplicate detection catches reuse. Staff still check their bKash statement before verifying.
- **TrxID typos** (O vs 0, I vs 1): a "did you mean" hint for staff, never automatic correction.
- **COD order paid online before delivery:** add a payment. The COD due drops, and if a courier booking exists, it's updated or rebooked (hook for phase 19).
- **Advance paid, then cancelled:** the cancel requires a refund record first.
- **Order edits after an advance** (phase 05): COD due recalculates; overpayment becomes a refund record.
- **Rounding:** the advance percentage rounds to whole taka and the remainder makes up the exact total.

### Security

- Verification is always a human action with the `VerifyPayment` permission, and is recorded. There's no automatic verification for manual payments.
- Rate-limit TrxID submissions per session and per phone.
- Merchant mobile-banking numbers come from public store settings. Personal numbers aren't exposed unless the merchant enters them.

### Tests

- End-to-end:
  - COD lifecycle
  - manual mobile banking verify and reject
  - duplicate TrxID blocked
  - partial payment
  - advance + COD remainder totals
  - refund record on cancel
- Unit: advance calculation and rounding for every rule type.
- Spike test proving Vendure's multiple-payment behaviour (kept as a regression test).

### Done when

- [ ] A shopper pays the delivery charge in advance by bKash Send Money with a TrxID, and the rest by COD. Staff verify it in the queue.
- [ ] The COD due amount is correct on the order, invoice and sticker.
- [ ] A reused TrxID is rejected.

### Not in this phase

Online gateways (18), COD reconciliation from courier payouts (37), gateway refunds (45).

---

## Phase 09 — Image pipeline and upload security

| | |
|---|---|
| Milestone | M2 |
| Delivers | Automatic WebP compression (P0) |
| Depends on | 01 |
| Size | M |

**Goal.** Every image is small, fast and safe automatically, whether uploaded in the Dashboard or imported from WooCommerce.

### Decide at start

- Storage layout and serving path: `files/images/<content-hash>/<width>.webp`, served by Nginx at `/img/…` in production and by the core's asset route in development.
- Whether to keep Vendure's asset server for Dashboard previews, with our variants for the storefront (likely), or replace it entirely.
- SVG logos: reject in the MVP (simplest and safe), or sanitize server-side.

### Build (plugin `images`)

1. **On asset creation, a job generates:**
   - WebP at widths 160, 320, 480, 768, 1080 and 1600, never upscaling, at quality ~78
   - width and height stored on the asset
   - a dominant colour (for placeholders)
   - optionally a tiny blurred placeholder (~200 bytes)
2. **Upload validation** before anything is stored:
   - maximum size of 15 MB
   - type detected from the file's bytes (JPEG, PNG, WebP, GIF, AVIF), not the name
   - `limitInputPixels` of about 40 megapixels against decompression bombs
3. **Processing:**
   - auto-rotate from EXIF, then **strip all metadata**, including GPS location from phone photos
   - convert CMYK to sRGB
   - keep PNG transparency in WebP
   - animated GIFs become animated WebP with frame and size caps (or the first frame only, if the result is too large)
4. **Originals** are kept outside any public path, so sizes can be regenerated later.
5. **Regenerate command** (`npm run images:regenerate -- --all|--asset <id>`) for quality or size changes.
6. **Deletion:** removing an asset deletes its variants after a 7-day grace period (accidental deletes can be undone).
7. **Deduplication** by content hash: the same image uploaded twice is stored once.
8. **Usage tracking** per store (total bytes), for plan limits later (phase 39).
9. **Dashboard:** upload progress, plus clear Bangla/English errors ("Please upload JPG or PNG", "Image too large").

### Edge cases

- **iPhone HEIC photos:** sharp's prebuilt binaries can't decode most HEIC files (HEVC isn't included). Detect HEIC and show "Please upload JPG or PNG"; don't fail silently.
- Huge panoramas (very wide, little height): resize by width only, with a height cap.
- Tiny images (smaller than 160 px wide): keep only the original size as WebP.
- Corrupted or truncated files: rejected cleanly.
- Two uploads of the same file at the same moment: dedupe without a race (unique hash constraint).
- Processing fails halfway (process restart): the job is idempotent and resumes.
- Disk full: the job fails visibly, the asset is marked "processing failed", and staff are alerted.
- Transparent product images on coloured backgrounds: alpha is kept.

### Security

- Byte sniffing, pixel limits and **re-encoding**. Re-encoding removes polyglot payloads hidden inside image files.
- File names are never used in paths, only hashes.
- Responses carry correct `Content-Type` and `X-Content-Type-Options: nosniff`, with no directory listing.
- SVG is rejected (or sanitized, per the ADR).
- The files folder is owned by the store's Linux user (phase 24).

### Tests

- A fixture set with expected outcomes:
  - JPEG with GPS EXIF (location removed)
  - CMYK JPEG
  - PNG with alpha
  - animated GIF
  - 50-megapixel bomb (rejected)
  - truncated file
  - SVG with a script (rejected)
  - HEIC (clear error)
  - tiny image
  - duplicate upload
- **Size check:** a 5 MB phone photo produces variants totalling under 400 KB, and the 1080 px version is under 150 KB.
- **Throughput:** 100 images processed within a stated time on a 2 vCPU machine. Note the result for capacity planning.

### Done when

- [ ] A 5 MB phone photo becomes WebP sizes under 400 KB in total, with location data removed, served with immutable caching.
- [ ] Every malicious or unsupported fixture is rejected with a clear message.
- [ ] Imports can call the same pipeline (an API used by phase 21).

### Not in this phase

AVIF (50), image CDN decisions (29), storage quotas enforcement (39).

---

## Phase 10 — Notifications: SMS, templates and email hygiene

| | |
|---|---|
| Milestone | M2 |
| Delivers | Order SMS in Bangla (P0) |
| Depends on | 04, 08 |
| Size | M |

**Goal.** Customers get timely, correct SMS in their language. Merchants control templates and costs. Placeholder emails never receive mail.

### Decide at start

- **SMS provider** for the direct driver: compare 2–3 Bangladeshi providers on API quality, delivery reports, masking (sender ID) support, price, and uptime history. The interface must allow switching to the central gateway (phase 38) without changing callers.
- **Email transport** for real emails (staff invites, password resets, optional customer emails): an SMTP provider, chosen for deliverability.

### Build (plugin `notifications`)

1. **SMS driver interface** (`send`, `getStatus`, `parseDeliveryReport`) with the first direct driver. Credentials are encrypted per store.
2. **Outbox and job:** every SMS is written to the outbox in the same transaction as the order change, then sent by a job with retries.
   - Idempotency key: (order, event, recipient), so a retry never sends twice.
   - Delivery reports, if the provider supports them, update the status.
3. **Templates per event:**
   - order placed, confirmed, shipped (with tracking link), delivered, cancelled
   - manual payment verified or rejected
   - OTP (used in phases 11 and 34)
   - Each template exists in Bangla and English; the language comes from the order's `locale`.
   - Variables: `{name} {orderNumber} {total} {codDue} {trackingUrl} {storeName} {storePhone}`
   - Missing variables fall back to safe defaults.
4. **Template editor** (Dashboard):
   - live preview with the **segment count and cost**
   - Bangla text uses Unicode SMS: 70 characters for one SMS, 67 per part when longer
   - plain English uses GSM-7: 160 characters, 153 per part
   - warns when a template becomes 3+ SMS
5. **Settings:**
   - enable/disable per event, and sender ID
   - **quiet hours** (default 22:00–08:00 Dhaka): non-urgent SMS wait until morning; OTPs are never delayed
6. **Local usage counter** per store (segments sent per day and month). Real credit purchase and billing come in phases 38–39.
7. **Short tracking links** `https://<store>/t/<token>`: our own, with no third-party shortener. The token is random (128-bit) and scoped to one order; the page itself comes in phase 14.
8. **Email hygiene:**
   - Vendure's email plugin handlers are filtered so placeholder emails (`*.invalid`) are always skipped.
   - Dev mode, and the `/mailbox` page, are off in production.
   - A real SMTP transport is configured through environment variables.

### Edge cases

- **Recipient issues:**
  - Non-mobile or foreign numbers are skipped and logged, never sent.
  - Customers who opt out (manual flag per customer) receive only transactional SMS that the merchant marks as required.
- **Provider issues:**
  - When the provider is down: retry with backoff, then mark failed after N attempts and alert staff. Orders are never affected.
  - When credits run out: non-critical SMS stop and the merchant is alerted. Orders and OTPs are never blocked by it.
- **Message content:**
  - A template too long after variables are filled (a long address): the warning appears at save time; at send time it's sent as multipart.
  - Mixed Bangla, English and emoji is treated as Unicode, and segments are counted correctly.
- **Timing:**
  - Quiet hours that cross midnight: scheduling is correct in Dhaka time.
  - Events in quick succession (confirmed then shipped within a minute): both are sent, in order.

### Security

- Provider keys are encrypted and never logged; OTP codes are never logged.
- **SMS pumping protection:** only Bangladeshi mobile numbers, a per-phone daily cap, and a per-store daily cap with an alert. OTP abuse is the classic way attackers run up SMS bills.
- Template variables are inserted as plain text and never interpreted.
- Tracking-link tokens are unguessable and reveal only order status, the shopper's first name and district.

### Tests

- Unit: segment counting for Bangla, English, mixed, emoji and long messages; quiet-hours scheduling across midnight; template rendering with missing variables.
- End-to-end: placing, confirming and shipping an order queues exactly one SMS per event, even when the job retries.
- Contract: the provider driver against a mock server, covering success, errors, timeouts and delivery reports.
- A test that no email handler fires for a placeholder email.

### Done when

- [ ] Placing, confirming and shipping an order each send the correct Bangla SMS exactly once.
- [ ] The merchant edits a template and sees the live segment count and cost.
- [ ] Placeholder emails never receive mail; `/mailbox` is unavailable in production.

### Not in this phase

Central SMS gateway, credit purchase and failover provider (38), abandoned-checkout SMS automation (44).

---

## Phase 11 — Incomplete orders and fake-order protection

| | |
|---|---|
| Milestone | M2 |
| Delivers | Incomplete orders (P0); OTP for COD (P1), block list (P1), own-store risk score (P1), all built now because they share the same data |
| Depends on | 03, 04, 10 |
| Size | L |

**Goal.** Recover shoppers who abandon checkout, and stop fake COD orders without annoying real shoppers.

### Decide at start

- **Consent wording** for capturing checkout details before the order is placed (shown under the phone field), in Bangla and English.
- **Bot protection provider** used when abuse is detected: Cloudflare Turnstile (free and privacy-friendly) is recommended. Check the script's size impact; it loads only when needed.

### Build (plugins `bd-checkout` part 2 and `fraud-guard`)

1. **Capturing incomplete checkouts:**
   - **Shop API mutation `saveCheckoutProgress(input)`**, called by the storefront (debounced) as soon as a valid phone is typed. It stores phone, name, district, thana, a cart snapshot (variants, quantities, prices), the active order, source/UTM data and timestamps.
   - **Entity `IncompleteCheckout`** with status: open, recovered, converted, dismissed or expired.
   - **Recovered detection:** an order placed later with the same phone (within 7 days) marks it recovered and links the order.
   - **Expiry:** after 30 days, personal data is deleted and only counts are kept for reports.
2. **"Incomplete orders" page** (Dashboard):
   - list with filters and a tap-to-call phone
   - a manual "send SMS" using a template ("Your order is waiting…")
   - **Convert to order**, which opens phase 05's manual order with everything prefilled
   - dismiss with a reason
3. **Block list:**
   - **Phone numbers:** permanent or with expiry.
   - **IP addresses:** temporary only, with a warning that Bangladeshi mobile users share IPs behind carrier-grade NAT, so one IP block can stop thousands of real shoppers.
   - Notes and who added each entry.
4. **Velocity rules (store settings):**
   - maximum orders per phone per 24 hours (default 3)
   - per session
   - duplicate-cart detection
   - **duplicate-order block:** after an order, the same phone can't order again for N minutes (1 to 1,440, off by default). The shopper sees the merchant's message and a WhatsApp button instead of an error.
5. **Own-store risk score** per order, with reasons shown as a badge in the confirmation queue (for example "2 returns, 1 fake order before"). Inputs:
   - this phone's history in this store (delivered, returned, cancelled as fake)
   - velocity
   - address quality (missing thana, very short address)
   - a name that looks like gibberish
6. **OTP for COD** (setting: off, all COD orders, first-time phones only, or risky orders only):
   - 6-digit code, 5-minute expiry, 3 attempts per code, a 60-second resend cooldown, at most 5 OTPs per phone per day
   - sent through phase 10's SMS
7. **Advance required for risky orders:** links to phase 08's partial advance rules.
8. **Bot protection:**
   - a hidden honeypot field and a minimum time-to-submit check
   - Turnstile appears only when rate thresholds are exceeded, so normal shoppers never see it

### Edge cases

- **Capture edge cases:**
  - Typed a phone then left: captured, with the consent notice shown.
  - A wrong phone typed by mistake: staff might call a stranger, so the call script in the help draft opens politely.
  - Several incomplete records for one phone: merged, latest wins.
  - The shopper later orders with a different phone: no automatic link; staff can link manually.
  - A cart snapshot whose products are deleted or out of stock: convert-to-order shows what's unavailable.
- **OTP edge cases:**
  - The SMS is delayed: resend is offered after the cooldown.
  - Shoppers with no SMS reception: the merchant chooses a setting that either allows the order flagged "unverified" or offers advance payment.
- **Blocking and scoring:**
  - A blocked shopper sees a polite generic message, never "you are blocked".
  - Blocked shoppers can appeal: unblock from the customer page, with the reason recorded.
  - False positives: risk never auto-rejects unless the merchant explicitly enables auto-reject for a score threshold.
  - VPN or shared IPs: IP signals never decide alone.

### Security

- **Rate limits** on `saveCheckoutProgress` per session, phone and IP, plus payload size limits.
- The Shop API never returns incomplete-checkout data.
- **OTP protection:** codes stored hashed, compared in constant time, attempt limits, and responses that don't reveal whether a phone is blocked.
- Risk reasons are visible only to staff with `ReadRisk` (part of the order staff role).
- Privacy: 30-day expiry job, and personal data excluded from exports after expiry.

### Tests

- End-to-end:
  - capture → recovered when the order is placed
  - convert to order
  - expiry deletes personal data
- End-to-end OTP flows: correct code, wrong code, expiry, attempt limits, resend cooldown, daily cap.
- Velocity and block list: allowed and blocked cases, plus the polite message.
- Unit: risk score inputs → score and reasons.
- Load: `saveCheckoutProgress` under bursty debounced calls doesn't create duplicates.

### Done when

- [ ] An abandoned checkout appears in the Dashboard within 5 seconds of typing a valid phone, and converts to an order in two clicks.
- [ ] Repeated fake orders from a blocked phone are refused politely.
- [ ] OTP-for-COD works in every mode, within the SMS limits.
- [ ] The confirmation queue shows the risk badge with reasons.

### Not in this phase

The storefront call to `saveCheckoutProgress` (14), courier-based fraud data (37), the cross-store network score (38), automated abandoned-checkout SMS (44).
