# Changelog

All notable changes to Ecomm BD. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Phase 07, shipping zones and rates** (plugin `shipping-bd`):
  - Delivery charges by bd-geo zone: ৳60 inside Dhaka city, ৳100 Dhaka suburbs, ৳120 outside Dhaka by default (shown as suggestions until the merchant saves), an optional own rate for Chattogram city, and district or thana overrides.
  - Per-product delivery: free delivery, own inside/outside-Dhaka charges (the highest in the cart applies) and an extra charge per item; weight charges per started kilogram from the variant's weight.
  - Free delivery above a subtotal per zone (after discounts, before delivery), Express (own rates, only where offered) and Store pickup, both off until turned on; where the store delivers (areas, districts, heaviest order); the COD fee setting (applied with COD in phase 08).
  - Three delivery methods for every store from a new store-defaults step. Manual orders (draft orders) use the same rules.
  - `Order.bdDelivery` in the Shop and Admin APIs: zone, why no method is offered (in Bangla and English) and "spend ৳X more for free delivery".
  - Merchant admin: **Settings → Delivery**, in merchant language, with a warning listing products without a weight. Changing charges needs `UpdateShippingMethod`.
  - Migration: product and variant delivery fields (additive).
  - Tests: unit tests of the calculator matrix, end-to-end tests (Mirpur, Savar, Rajshahi, Chattogram, threshold crossing, district change, Express and pickup, coverage, product fields, weight, settings validation and permissions, draft orders) and a Playwright test of the delivery page.

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
