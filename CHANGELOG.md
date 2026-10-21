# Changelog

All notable changes to Ecomm BD. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Phase 11, incomplete orders and fake-order protection** (plugin `fraud-guard`):
  - **Incomplete orders:** the checkout is saved as soon as a valid phone is typed (`saveCheckoutProgress`, for the storefront in phase 14); Orders → **Incomplete orders** lists them with tap-to-call, a one-time reminder SMS, **Make an order** (opens the phone order filled in, saying which products are no longer available) and dismiss with a reason. A later order from the same phone marks them ordered; personal data is deleted after 30 days.
  - **Block list** (Customers → Block list, and on the customer page): phones for good or until a date, IPs for at most 30 days. Blocked shoppers see a polite "can't take this order online"; staff can still enter their orders. Unblocking records why.
  - **Order limits:** at most 3 website orders a phone in 24 hours by default, and an optional "already ordered" window with the merchant's own message.
  - **Risk badge** with reasons ("1 fake order before · Name looks made up") in the confirmation queue and on the order, for staff with the new `ReadRisk` permission.
  - **Verification code for COD** by SMS: never, every COD order, first-time customers or risky orders; 6 digits, 5 minutes, 3 tries, a minute between codes, 5 a day; optionally the shopper may order "not verified" when no SMS arrives.
  - **Bot checks** on the phone checkout: a hidden field and a minimum time on the form.
  - Settings → **Fake-order protection**. Migration: incomplete checkouts, block list, codes, three order fields (additive).
  - Tests: unit tests of the risk score and name check; end-to-end tests of capture, bursts, recovery, convert, SMS, dismiss and expiry, the block list (phones and IPs), limits, the risk badge and its permission, every code mode and limit, and the bot checks; Playwright tests of making an order from an incomplete checkout and of blocking and unblocking.

- **Phase 10, notifications: SMS, templates and email hygiene** (plugin `notifications`; no SMS provider yet, by choice):
  - Order SMS in Bangla or English when an order is placed, confirmed, shipped (with a tracking link), delivered or cancelled, and when a bKash/Nagad/Rocket payment is verified or not matched; OTP template ready for phase 11.
  - Each SMS is sent exactly once (an outbox with a unique key per order, event and phone), retried 4 times if the provider fails, and kept with its status and reason on the order page.
  - Only Bangladeshi mobile numbers; per-phone and per-store daily limits; quiet hours (22:00–08:00 Dhaka) hold ordinary SMS until morning; customers can be marked "SMS off" and then get only the messages the merchant marks required.
  - Merchant admin **Settings → SMS**: templates per event with the live length, number of SMS parts and cost, a warning at 3+ parts, sender name, quiet hours, limits and today's and this month's usage.
  - Email: dev mode and `/mailbox` only in development; SMTP through new settings `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Nodemailer pinned to 10.0.16 (security fixes).
  - New settings `SMS_DRIVER` (`log` or `none`) and `STOREFRONT_URL`. Migration: the SMS outbox, customer `smsOptOut`, order `trackingToken` (additive).
  - Tests: unit tests of segment counting, templates and settings; end-to-end tests of order SMS (once each, retries, opt-out, limits, foreign numbers, quiet hours, templates, manual orders without SMS, usage); a Playwright test of the template editor.

- **Phase 05, manual orders, order editing and stock rules** (plugins `bd-catalog` and `bd-manual-orders`):
  - **No overselling:** Vendure 3.8 places every order for the last units when shoppers pay at once (50 orders for 10 units in our test). Payments now lock and re-check stock, so exactly 10 are placed and the rest are told "just sold out".
  - Merchant admin **Products**: a list with image, price and old price, stock, category and badges (Featured, New, "Bangla missing"), duplicate and delete; a **one-page product form** with names and descriptions in Bangla and English, main photo, gallery, customer feedback photos, YouTube link, category, delivery for this product, and size, colour, pack or custom variations each with price, old price, stock, photo, default and pre-order; SKU, weight and SEO under "More".
  - **Categories** with names in both languages, image, parent, order and free delivery; **Stock** with low stock first and adjustments with a reason and history.
  - **Phone order**: customer by phone, address, product search with stock, staff price and discount (permission-gated, 10% cap for order staff), delivery by the store's rules or a typed charge, COD, already paid or an advance, source (Messenger, Facebook comment, phone, WhatsApp, walk-in), SMS toggle, created as New or Confirmed; the total is worked out by the server as staff type.
  - **Editing orders before shipping** (items, quantities, prices, address, delivery, discount) from the order page and the confirmation queue: the COD amount follows the new total; money to give back becomes a "refund due" staff mark refunded; before/after is in the history.
  - New permissions `CreateManualOrder`, `EditOrder`, `OverridePrice`, `ApplyManualDiscount`, `UnlimitedDiscount` on the default roles; a hidden "Recorded by staff" payment method for cash and bank payments; draft orders older than 7 days are deleted.
  - Migrations: product, variant, collection and order fields, the feedback images, the stock adjustment log (additive).
  - Tests: unit tests of the product form schema; end-to-end tests of the product form, categories, stock, overselling, manual orders and edits; Playwright tests of adding a product with three sizes and a gallery, and a Messenger order in under a minute.

- **Phase 09, image pipeline and upload security** (plugin `images`):
  - Every image is checked and cleaned before it's stored: JPEG, PNG, WebP, GIF or AVIF only (by its bytes; no SVG or HEIC), up to 15 MB and 40 megapixels; rotation applied; all metadata removed, including GPS location; CMYK to sRGB; transparency and animation kept. Clear Bangla/English messages, e.g. for iPhone HEIC photos.
  - A worker job makes WebP sizes (160–1600 px, never upscaled), a dominant colour and a tiny placeholder, stored once per image by content hash and served at `/img/<hash>/<width>.webp` with a year's caching.
  - Unused sizes are deleted 7 days after they're no longer used; `bdImageUsage` reports storage; `npm run images:regenerate`.
  - New setting `IMAGES_DIR`. Migration: image fields on assets (additive).
  - The admin's upload box shows the server's reason when an image is refused.
  - Tests: unit tests with a generated fixture set (GPS, rotation, CMYK, alpha, animated GIF, pixel bomb, truncated, SVG, HEIC, tiny, duplicate) and the size budget (a 5 MB phone photo gives under 400 KB of sizes); end-to-end tests of upload, serving, refusals, dedupe, usage, the grace period and regeneration.

- **Phase 08, payments I: COD, manual mobile banking and partial advance** (plugin `payments-bd`):
  - Cash on delivery, authorized at checkout and settled automatically on delivery; an optional order limit and allowed areas; blocked phones (phase 11) see a polite "not available".
  - bKash, Nagad and Rocket "Send Money" to the merchant's number: the shopper enters the sender number and transaction ID, the order is placed, and staff verify or reject it in **Orders → Verify payments**. A transaction ID can pay one order only; look-alike characters are pointed out to staff.
  - Partial advance before delivery (delivery charge, fixed or a percentage; all COD orders, outside Dhaka, chosen products, or risky phones), then COD for the rest.
  - The COD charge from the delivery settings as its own order line (`setBdPaymentChoice`).
  - Refund records (amount, how, TrxID, note), required before cancelling an order with money received; "money received" now subtracts refunds everywhere.
  - Shop API `bdPaymentOptions` (COD available or why, advance, COD amount, merchant numbers); store defaults create the four payment methods; new `VerifyPayment` permission for Owner and Manager.
  - Merchant admin: **Settings → Payments**, **Orders → Verify payments**, and a Payments card on the order page with "Record refund".
  - Migration: the unique transaction field on payments and the order's payment choice (additive).
  - Tests: unit tests of the advance rules, COD limits and TrxID checks; end-to-end tests of the COD lifecycle, verify, reject, partial payment, duplicate TrxID, advance + COD, the COD charge, refunds before cancelling and permissions; a Playwright test of the queue.

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
