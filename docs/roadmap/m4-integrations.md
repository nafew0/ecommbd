# M4 · Payments, couriers and Meta

> Phases 18–20 · [Roadmap overview](README.md)
> **Exit criteria:** sandbox SSLCommerz and bKash payments verified on the server, Steadfast and Pathao booking with automatic status sync, and deduplicated Meta events with "Good" match quality.

Every integration here talks to a company we don't control. So each one gets:

- a **driver interface**, so providers can be swapped or added
- **contract tests** against recorded responses plus a mock server
- **nightly sandbox runs** where a sandbox exists
- **circuit breakers**, so a provider outage never blocks orders
- **encrypted per-store credentials** with a "Test connection" button

---

## Phase 18 — Online payments: SSLCommerz and bKash

| | |
|---|---|
| Milestone | M4 |
| Delivers | SSLCommerz (P0), bKash tokenized checkout (P1), online partial advance (P1) |
| Depends on | 08, 14 |
| Size | L |
| Needs | SSLCommerz sandbox and bKash PGW sandbox credentials (lead-time items) |

**Goal.** Card and mobile-banking payments that are always verified with the gateway on the server, and never lose or duplicate an order, even when callbacks arrive late, twice, or never.

### Decide at start

- **Payment expiry:** how long an unpaid online order holds stock before it's cancelled (recommended 45 minutes), and what the shopper sees on returning late.
- **SSLCommerz page style:** full redirect or the embedded popup. Redirect is simplest and most reliable on low-end phones.
- **Late payments:** policy for a payment that arrives after the order was auto-cancelled. Recommended: reinstate the order if stock allows, otherwise refund, and always tell staff.

### Build (plugins `payments-sslcommerz`, `payments-bkash`)

1. **Shared foundation:**
   - **Credentials:** encrypted per store, with sandbox/live mode and a "Test connection" button.
   - **`PaymentAttempt` entity:** order, gateway, attempt ID, amount, status, timestamps and redacted raw responses.
   - **Idempotent callbacks:** keyed by the gateway transaction ID, with a unique constraint.
   - **Reconciliation job:** queries the gateway for every unfinished attempt every few minutes for 24 hours, then hourly for 7 days, fixing "paid but not recorded" cases.
   - **Expiry job:** cancels unpaid online orders after the expiry window and releases stock. Advance-payment orders stay waiting for payment instead of cancelling, if the merchant prefers.
2. **SSLCommerz:**
   - **Session:** create one with a unique `tran_id` per attempt and references in `value_a`–`value_d` (store, order, attempt); redirect the shopper.
   - **Return pages** (success, fail, cancel) **only display state**; they never mark anything paid.
   - **IPN listener** (server-to-server), then a **validation API call** with `val_id`. It checks:
     - status `VALID` or `VALIDATED`
     - amount and currency match exactly
     - `tran_id` matches the attempt
     - store ID matches
     - `verify_sign` hash checks out
     - `risk_level`: 1 means a risky transaction, held for staff review
   - **Refund API client** (the refund UI comes in phase 45).
3. **bKash tokenized checkout:**
   - **Tokens:** grant and refresh, cached until expiry.
   - **Flow:** create payment, redirect, the callback calls **execute payment**, and a successful execute settles the payment.
   - **The known bKash failure:** money is taken but `execute` times out or errors. Always follow with a **query payment** call and settle from its answer. The reconciliation job repeats the query.
   - Error codes mapped to Bangla and English messages.
   - **Refund API client.**
4. **Online partial advance:** phase 08's advance rules can now be paid by SSLCommerz or bKash, with the remainder on COD.
5. **Dashboard:** a payment panel per order showing gateway transaction IDs, status history, a "Check status now" button, and a review queue for risky or late payments.
6. **Circuit breaker:** if a gateway fails repeatedly, its option is hidden at checkout for a few minutes ("bKash is temporarily unavailable"), with COD still offered. Staff are alerted.

### Edge cases

- **Callback timing:**
  - The IPN arrives before the shopper returns to the site: the return page shows "Paid".
  - The shopper returns, but no IPN ever arrives: the reconciliation job finds the payment.
  - Duplicate IPNs or callbacks: processed once.
- **Payment problems:**
  - Amount or `tran_id` tampered with in the return URL: ignored, because only server validation counts.
  - A currency or amount mismatch on validation: rejected, with staff alerted.
  - Two attempts both succeed (double payment in two tabs): one is applied, and the other is flagged for refund.
  - Payment completed after the order was cancelled: handled by the late-payment policy, never silently dropped.
- **bKash outcomes:**
  - Execute fails but the query shows success: settled.
  - Execute fails and the query shows failure: shopper can retry.
- **Gateway down at checkout:** the method is hidden by the circuit breaker; COD and other methods still work.
- **Configuration mistakes:** sandbox credentials in live mode (or the reverse) are caught by "Test connection", and the Dashboard shows a warning banner.
- **Shopper behaviour:**
  - Closes the browser mid-payment: the order waits, and reconciliation or expiry resolves it.
  - Retries payment on an expired attempt: a new attempt is created; the old one is reconciled.

### Security

- **Only server-side validation counts:** never trust redirect parameters.
- **IPN endpoint:** accepts only the expected fields, verifies through the validation API, and rejects unknown stores. Use the gateway's IP allowlist if it's documented.
- **Minimal card scope:** no card data ever touches our servers (hosted gateway pages), which keeps PCI scope to the smallest level.
- **Credentials:** encrypted with the store's key and never logged; raw gateway responses stored with secrets removed.
- **Return URLs:** built server-side and never taken from shopper input (no open redirect).
- **Staff actions:** reinstating or refunding a late payment needs `ManagePayments` and is recorded.

### Tests

- **Contract tests** with recorded sandbox responses for both gateways.
- **End-to-end against a mock gateway server** that simulates every edge case above: late IPN, duplicate IPN, tampered return, validation mismatch, execute timeout followed by a successful query, double payment, and payment after cancel.
- **Manual sandbox checklist** run before merging, with screenshots: a real sandbox card payment and a real sandbox bKash payment.
- **Nightly sandbox run** in CI (scheduled workflow) that alerts on failure.

### Done when

- [ ] Sandbox SSLCommerz card payments and sandbox bKash payments complete end to end.
- [ ] Every simulated edge case resolves correctly, including the reconciliation job automatically fixing a "paid but not recorded" payment.
- [ ] Online partial advance works with a COD remainder.

### Not in this phase

Refund UI and gateway refunds (45), Nagad direct, aamarPay, ShurjoPay (45), platform-level payments (49).

---

## Phase 19 — Couriers I: Steadfast and Pathao

| | |
|---|---|
| Milestone | M4 |
| Delivers | Courier booking with automatic status sync for Steadfast and Pathao (P0); courier status widget (P0) |
| Depends on | 04, 06, 08 |
| Size | L |
| Needs | Steadfast and Pathao merchant API credentials (lead-time items) |

**Goal.** Book parcels in one click, or 50 at once, and let delivery updates move orders automatically, including COD settlement on delivery.

### Decide at start

- **Status updates:** check what each courier actually offers today (webhooks, signature scheme, polling limits), and record it in the ADR.
- **Pathao location mapping:** how to match `bd-geo` districts and thanas to Pathao's city/zone/area IDs. Recommended: automatic name and alias matching, plus a manual mapping table for the rest.
- **Booking moment:** booking requires the Packed state, and staff can book from Confirmed if the store skips packing.

### Build (plugin `couriers` with drivers)

1. **Courier driver interface:**
   - `createParcel`, `bulkCreate`, `getStatus`, `cancel`
   - `parseWebhook`, `syncLocations`
   - optional `quote`
   - capability flags, for example "supports bulk"
2. **Steadfast driver:**
   - API key and secret
   - create a parcel with the invoice (our order number), recipient name, phone, address, **COD amount as whole taka**, and note
   - stores the consignment ID and tracking code
   - status lookup by consignment or invoice; bulk create; webhook or polling
3. **Pathao driver:**
   - **Auth:** client ID/secret plus a password grant, with token refresh.
   - **Store:** the merchant's Pathao store ID.
   - **Location sync:** cities, zones and areas fetched and cached, refreshed weekly.
   - **Location mapping:** automatic matching from `bd-geo` with aliases, plus a **manual mapping screen** for unmatched thanas. Once saved, a mapping applies to all future orders.
   - **Parcel details:** item type, weight (from phase 07's weights), delivery type; then create the order and track status.
4. **Booking UX:**
   - **Book** from an order, or **bulk book** from the order list.
   - **Default courier** per delivery zone (store setting).
   - **Fulfillment record:** a Vendure fulfillment through a fulfillment handler, holding courier name, consignment ID and tracking code.
   - **Stickers** from phase 06 gain the consignment barcode.
   - **SMS:** the "shipped" SMS (phase 10) includes the tracking link.
5. **Status sync:**
   - **Webhooks** (verified) as the main path, and a **polling task** every 30–60 minutes for active parcels as a fallback.
   - **Mapping table** from courier statuses to ours:
     - picked up → Shipped
     - delivered → Delivered, which **settles the COD payment**
     - partial delivery → PartiallyDelivered, keeping the collected amount
     - cancelled or returned → the Returned flow
     - hold or unknown → added as a note only
   - Status timestamps keep updates in order: never move backwards except into returns.
6. **Outbox and idempotency:** one active booking per order; retries never double-book.
7. **Manual fallback:** "Mark as booked manually" with a courier name and tracking code, for when an API is down.
8. **Home widget:** in transit, delivered today, returned this week.
9. **Hooks** called by earlier phases:
   - editing a booked order (phase 11a) requires cancelling the booking first
   - a COD amount change (phase 08) updates or rebooks the parcel

### Edge cases

- **Booking problems:**
  - An address that can't be mapped to a Pathao zone: the order waits in an "unmapped addresses" queue with a one-click mapping fix.
  - Booking rejected by the courier's validation (invalid phone, address too long, weight missing): a clear message on the order, with fields to fix.
  - Duplicate booking attempts (double click, retry): blocked by idempotency.
  - Bulk booking with partial failures: successes stay booked, and failures are listed for retry.
  - Courier token expires during a bulk job: refreshed automatically, and the job continues.
- **Cancellations and amount changes:**
  - Cancelling after pickup: blocked, with staff told to arrange a return.
  - The COD amount changes after booking: update through the API if supported, otherwise cancel and rebook (only before pickup).
- **Status updates:**
  - A status arrives out of order: compare timestamps; never regress.
  - A webhook for an unknown consignment: logged and ignored, never an error loop.
- **Courier downtime:** bookings queue and retry with backoff; staff see "waiting for Steadfast"; the manual fallback is offered.
- **Rate limits:** bulk jobs respect them, backing off when told.

### Security

- Credentials encrypted per store; tokens never logged.
- **Webhook verification:** each courier's secret or signature, plus a per-store webhook URL containing an unguessable path segment. Use the courier's IP allowlist if it's documented.
- **Personal data:** the courier receives only what delivery needs (name, phone, address, COD amount, item description).
- Booking needs the `BookCourier` permission.

### Tests

- Contract tests with recorded responses for both couriers.
- End-to-end against mock courier servers: booking, bulk partial failure, token expiry, webhooks (valid, invalid signature, unknown consignment, out of order), polling fallback, and manual fallback.
- **Mapping:** at least 95% of Dhaka city thanas and all 64 district towns match Pathao locations automatically, measured on a fixture of Pathao's location list.
- The status mapping table is covered status by status.
- Playwright: bulk book 50 packed orders and print stickers with consignment barcodes.

### Done when

- [ ] Staff bulk-book 50 packed orders with Steadfast in one action, and the stickers show consignment barcodes.
- [ ] A delivered webhook moves an order to Delivered and settles its COD payment.
- [ ] Pathao bookings work, with the unmapped-address queue catching the rest.
- [ ] The home widget shows live courier counts.

### Not in this phase

RedX, courier fraud check, returns workflow, COD reconciliation (37), more couriers and smart courier selection (46).

---

## Phase 20 — Meta Pixel and Conversions API

| | |
|---|---|
| Milestone | M4 |
| Delivers | Meta Pixel + Conversions API, deduplicated (P0); Purchase trigger setting (P0); event log (P1, pulled forward because the pilot needs it for debugging) |
| Depends on | 04, 14, 16 |
| Size | L |
| Needs | A test Pixel, a Conversions API token, and Meta's Test Events tool (lead-time items) |

**Goal.** Accurate, deduplicated Meta tracking, including for shoppers with ad blockers, that teaches the ad algorithm to find **real** buyers rather than fake COD orders.

### Decide at start

- **Graph API version** to pin, plus a calendar reminder to upgrade before it's deprecated.
- **Purchase value:** order total with or without delivery charge (a store setting; default excludes delivery).
- **`content_ids` format** (variant SKU or ID): it must match the catalog feed in phase 36. Decide once, here.

### Build (plugin `meta-capi` plus a storefront tracker)

1. **Settings (Dashboard):**
   - one or two Pixel IDs, the Conversions API token (encrypted) and a test event code
   - **Purchase trigger:** when placed, when confirmed, or when delivered
   - events on/off, browser Pixel on/off
   - **"Send manual orders"** (default off: Messenger orders didn't come from an ad click on the site)
2. **Storefront tracker** (a tiny script, within the JS budget):
   - **Event IDs:** a unique `event_id` per event.
   - **Meta cookies:**
     - captures `fbclid` from the URL into `_fbc` (`fb.1.<ms>.<fbclid>`)
     - creates `_fbp` (`fb.1.<ms>.<random>`) if missing
   - **Server copy:** sends each event (PageView, ViewContent, AddToCart, InitiateCheckout) to the core's event endpoint with a beacon.
   - **Browser Pixel:** loads Meta's script (`fbevents.js`) **after the page is interactive** (on first interaction or idle) and fires the same events with the same `eventID`. Meta deduplicates the browser and server copies.
3. **Core event endpoint:**
   - validates the payload, rate-limits, and ignores known bots
   - adds the client IP (from the trusted proxy header) and user agent
   - queues events to the outbox
4. **Saved at checkout** on the order:
   - `_fbp`, `_fbc`, IP, user agent
   - `external_id`, a hashed customer identifier

   This lets a Purchase sent days later (on confirm or delivery) still match the shopper.
5. **Sender job:**
   - **Normalizes** user data exactly as Meta specifies:
     - phone as digits with country code and no plus (`8801…`)
     - lowercase trimmed email, skipped for placeholder emails
     - lowercase first and last name
     - city/district lowercase without spaces, country `bd`
   - **Hashes** everything with SHA-256 and batches events to `/{pixel_id}/events`.
   - **Errors:** retries with backoff. An invalid or expired token alerts the merchant in the Dashboard.
   - **Logs** Meta's response (`events_received`, `fbtrace_id`).
6. **Purchase by trigger:**
   - **Placed:** the browser Pixel on the thank-you page plus the server event, deduplicated by `event_id`.
   - **Confirmed or delivered:** the server event only, sent when the order reaches that state. The thank-you page fires **no** Purchase Pixel event.
   - **Never** for imported orders.
7. **Event log page** (Dashboard): recent events with status, a payload preview (hashed fields only), Meta's response, and a "Send test event" button.
8. **Match-quality checklist** in the help draft: what raises match quality, and how the Purchase trigger affects ad learning.

### Edge cases

- **Ad blockers** block the Pixel: the server events still arrive, which is the point of the Conversions API.
- **Delayed Purchase:** an order delivered days later gets `event_time` = delivery time, which is within Meta's 7-day window for website events. An event that is somehow older than 7 days is skipped and logged.
- **A cancelled order after Purchase was sent:** it can't be retracted. This is exactly why "confirmed" or "delivered" are the recommended triggers; the help draft explains it.
- **Duplicates:** retries resend the same `event_id`, and Meta deduplicates.
- **Value and currency:** BDT, whole numbers, matching the setting.
- **Two Pixels:** every event goes to both, each with its own token if needed.
- **Token problems:** a revoked token pauses sending, alerts the merchant, and keeps events queued for up to 7 days.
- **Meta API version deprecated:** pinned version plus an upgrade task. A deprecation warning in responses alerts the platform team.
- **Bots and scripts** posting fake events: known bots are filtered, events require a storefront session, and endpoint rate limits apply.
- **Burst traffic** from a viral ad: events are batched (up to Meta's batch limit) and the queue absorbs spikes.

### Security

- The token is encrypted per store and never logged.
- Only hashed personal data is sent to Meta. Raw phone numbers and emails are never logged or included in payload previews.
- The event endpoint is rate-limited, size-limited and schema-validated, so it can't be used to flood logs or the queue.
- Stored IP addresses follow the 90-day retention rule.

### Tests

- **Normalization:** unit tests against Meta's documented examples, including Bangla names (lowercased as-is, Unicode preserved) and placeholder-email skipping.
- **Deduplication:** browser and server events share an `event_id`.
- **Purchase triggers:** the full matrix of placed, confirmed and delivered × browser Pixel on/off × manual order on/off × imported orders.
- **Graph API mock:** errors (invalid token, rate limit, malformed event) handled as designed.
- **Manual check in Meta's Test Events tool**, with screenshots in the PR.

### Done when

- [ ] Meta's Test Events tool shows PageView, ViewContent, AddToCart, InitiateCheckout and Purchase, deduplicated.
- [ ] Event Match Quality for Purchase is **"Good" or better** with realistic test data.
- [ ] With the trigger on "confirmed", Purchase is sent only after staff confirm, and never from the thank-you page.
- [ ] The event log shows every event and Meta's response.

### Not in this phase

GA4, TikTok and GTM, and the Meta catalog feed (36).
