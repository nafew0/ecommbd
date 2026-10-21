# Changelog

All notable changes to Ecomm BD. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Phase 04 review: confirm, pack and cancel permissions now apply to Vendure's standard order mutations as well as the merchant admin. Native cancellation checks the reason, required note and settled payments before changing lines, under a transaction and order lock. Direct cancellation transitions cannot leave live quantities and reserved stock behind.
- The home widget is labelled **Order value today** in English and Bangla, with its meaning explained. The Admin API exposes `todayOrderValue`; `todaySales` remains a deprecated alias with the same permission check.
- Status-only returns now require confirmation and explain that returned quantities, stock and payments are unchanged. Returned/cancelled order pages no longer show a delivery collection instruction. The stock, partial-return, refund and courier-payment contract is recorded in `docs/decisions/order-states.md` for the next implementation work.

### Added

- **Phase 06, invoices, packing slips and courier stickers** (plugin `bd-print`, print views in the merchant admin):
  - A4 and A5 invoices (logo, store contacts, order number with barcode, Dhaka date, customer, address, items, discount, delivery, total, paid and the amount to collect in large type, payment, note, return policy line); packing slips (no prices, a packed box per line); 80 mm thermal receipts; courier stickers 4×6 in, 3×4 in and A4 sheets of 8 or 12 labels.
  - Bangla, English or both on every label, Bangla digits on/off; phone numbers keep English digits for couriers.
  - Long invoices continue on more pages with the header repeated and "page 2 of 3"; long addresses on small stickers shrink, then wrap, and the phone and COD amount are never cut off.
  - Print from the orders list (select up to 100 per page; bigger selections print in batches of 100) or from an order. Each order remembers what was printed; a second print says "Reprint".
  - Settings → Invoices and stickers: paper sizes, what shows, language, digits and a footer line.
  - New permission `PrintOrders` (owner, manager, order staff, packer). Packing slips get no prices from the server; print data is never cached.
  - Our own Code 128 barcodes (no library), checked by decoding with ZXing.
  - Tests: unit and snapshot tests in Bangla and English, end-to-end tests of the print data, Playwright tests that print every template to PDF, check page sizes, scan barcodes and print 100 orders.
- **Two developers:** each works on their own branch; the roadmap lists who builds which phases.
- **Phase 04, BD order workflow, order numbers and confirmation queue** (plugin `bd-orders`):
  - Order statuses New → Confirmed → Packed → Shipped → Delivered, plus Partly delivered, Returned and Cancelled, on Vendure's order process. Every allowed change is in `docs/decisions/order-states.md`; anything else is refused with a clear message, also from Vendure's own mutations. Cancelling needs a reason (fake, customer cancelled, unreachable, duplicate, out of stock, price issue, other).
  - Order numbers 1001, 1002… (optional prefix, e.g. `MF-1001`), given when the order is placed, so abandoned carts leave no gaps.
  - Confirmation queue: oldest first, tap-to-call, "No answer" (moves it down), "Call later" (hides it until then), a call log, "Rahim is calling" claims for 5 minutes, bulk confirm, keyboard shortcuts, possible-duplicate and looks-unreachable flags, and an optional auto-cancel (off unless the merchant turns it on).
  - Two staff acting on one order at once: one wins, the other is told who already did it.
  - A stock warning when confirming an order whose stock ran out; orders with money received can't be cancelled until refunds arrive (phase 08).
  - Merchant admin: **Orders** list with status tabs and counts, search by phone, order number or name, Dhaka-date, district and payment filters; an order page with items, money to collect, customer, address, history and the next actions; **Confirm orders**; home widgets for the Dhaka day (sales need the new `ReadSalesFigures` permission); **Settings → Orders**.
  - New permissions `ConfirmOrder`, `CancelOrder`, `PackOrder` and `ReadSalesFigures`, granted to the default roles by a new store-defaults step.
  - Events for later phases (`BdOrderConfirmedEvent`, `BdOrderPackedEvent`, `BdOrderReturnedEvent`, `BdOrderCancelledWithReasonEvent`), never fired for imported orders.
  - Tests: unit tests for the shared status table and order settings, end-to-end tests of the whole state machine, concurrency, numbering under load, the Dhaka day boundary, permissions and events, a 20,000-order load test, and Playwright tests of the queue and order screens.

- **Phase 03, phone-first customers and guest checkout API** (plugin `bd-checkout`):
  - Shop API `setCustomerForOrderByPhone` (name, phone, optional alternate phone and email) and `setOrderShippingAddressBD` (district, thana, address, note), with typed errors (`BdCheckoutError`, e.g. `INVALID_PHONE`, `NOT_A_MOBILE`, `THANA_NOT_IN_DISTRICT`) in Bangla and English, input cleaning and length limits, and rate limits per session and per phone in Redis.
  - One customer per phone: new customer fields (phone, alternate phone, source, internal notes, order stats kept up to date), a placeholder email `…@phone.invalid` for phone-only customers, safe when two checkouts create the same phone at once. A family sharing a phone keeps one customer; each order keeps its own name and address.
  - No payment without a valid mobile number and a district/thana address, for every checkout path, including Vendure's own `setCustomerForOrder` (which now finds customers by phone and never overwrites them).
  - Guests never see a linked account's data: a guest's `Order.customer` shows only what they typed.
  - Checkout settings (show email, alternate phone and note; minimum address length; international phones) in the settings store, readable by the storefront.
  - Placeholder addresses are never emailed.
  - Merchant admin: **Customers** list searched by phone (the last digits are enough, Bangla digits too), and a customer page with phone, alternate phone, stats, recent orders and internal notes.
  - Tests: unit tests for the shared checkout helpers (100% coverage), end-to-end tests for every listed edge case, Playwright tests of the customer screens.

- **Phase 02, Bangladesh store defaults, place data, store settings and the merchant admin:**
  - `packages/bd-geo`: 8 divisions, 64 districts, 495 upazilas, 12 city corporations and the metropolitan thanas of Dhaka and Chattogram, in Bangla and English, with old spellings, delivery zones (Dhaka city, Dhaka suburbs, Chattogram city, outside Dhaka) and search. Official BBS geocodes as IDs.
  - New stores start ready for Bangladesh: BDT, prices including tax, Bangla (default) and English, Bangladesh enabled, a 0% standard tax and five staff roles (Owner, Manager, Order staff, Packer, Marketing). Runs on start and with `npm run store:init`; never overwrites a merchant's changes.
  - Store settings: name, logo, phones, WhatsApp, address (district → thana), trade licence, social links, business hours, Bangla and English policy templates, language and date format. A new `UpdateStoreSettings` permission and a change history. The storefront sees public fields only.
  - Addresses get district, thana, area, landmark and an alternate phone, checked on the server (the thana must be in the district), on customer and order addresses alike.
  - `bdDistricts` and `bdThanas` in the Shop and Admin APIs, and cacheable `GET /bd-geo/...` routes.
  - The merchant admin at `/admin` (`apps/admin`): sign-in, Bangla/English switch saved per staff member, a sidebar that becomes a drawer on phones, the Store settings page, a district → thana picker, and building blocks for later screens (list page, form dialog, phone, taka and Dhaka-time inputs, image upload). Signing in again after a session ends keeps what was typed.
  - Security: CSRF protection on the APIs, HTTP-only session cookies with separate names for the admin and the storefront, a strict Content Security Policy on `/admin`.
  - Tests: unit tests for bd-geo and the settings schema (100% coverage), end-to-end tests for defaults, settings, permissions, addresses and the place API, and Playwright tests of the admin on a desktop and a phone.

- **Phase 01, engineering foundation:**
  - `packages/shared`, Bangladesh helpers with full test coverage:
    - Bangladeshi phone numbers (normalize, validate, format, mask)
    - taka (whole-taka rounding, lakh grouping, Bangla digits)
    - Bangla text cleaning
    - Dhaka time and quiet hours
    - encryption for stored secrets
    - a safe outbound HTTP client (timeouts, retries, circuit breaker, SSRF protection)
    - idempotency keys
    - settings checks
  - The server checks every setting at startup and lists any that are missing or wrong.
  - JSON logs in staging and production, with request IDs and masked phone numbers and emails.
  - Tests: unit tests, an end-to-end test against PostgreSQL, and a Playwright Dashboard login test.
  - ESLint and Prettier, one GitHub Actions CI job, and Dependabot.
  - `CLAUDE.md`, a decisions log and a Bangla/English glossary.
