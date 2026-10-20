# M9 · Growth

> Phases 44–50 · [Roadmap overview](README.md)
> **Exit criteria:** P2 features shipped; merchants can integrate through a public API; owners run their store from a phone; the platform scales past 200 stores.

These phases are further away, so they're planned at a slightly higher level. **Before starting any of them, refine it** with what we've learned from real merchants (support tickets, the reports in phase 41, interviews), and update this file first. The product standards in the [README](README.md) apply exactly as before.

---

## Phase 44 — Conversion boosters: upsell, abandoned checkout SMS and blog

| | |
|---|---|
| Milestone | M9 |
| Delivers | One-click post-purchase upsell (P2), abandoned checkout SMS (P2), blog (P2) |
| Depends on | 43 |
| Size | M |

**Goal.** More revenue from the traffic merchants already pay for.

### Build

1. **One-click post-purchase upsell:**
   - After a COD order is placed, the thank-you page offers one discounted add-on product ("Add for ৳250").
   - Accepting adds it **to the same order** before confirmation: same delivery, no new checkout. COD makes this simple, because nothing is charged yet.
   - **Merchant setup:** offer rules by product or collection, discount, and a time limit (for example 10 minutes).
   - Prepaid orders get the same offer with an additional payment through phase 18's gateways.
2. **Abandoned checkout SMS automation** (builds on phase 11):
   - an automatic SMS 30–60 minutes after abandonment with a cart link, optionally with a coupon
   - **frequency caps:** at most 1 per phone per 7 days
   - quiet hours respected, **consent text** at capture, and opt-out
   - recovery tracking in reports
3. **Blog:**
   - posts built with sections (phase 15), with categories and tags
   - SEO (Article JSON-LD), RSS feed, sitemap entries, and Bangla typography
   - product embeds inside posts

### Edge cases

- **Upsell:**
  - The upsell product goes out of stock or its price changes: the offer is hidden or updated.
  - The order is already confirmed: no upsell.
  - The shopper accepts twice: idempotent.
- **Abandoned SMS:**
  - The shopper ordered through another channel meanwhile: cancelled through the recovered check.
  - Sent at night: queued until the morning.
- **Blog:** slugs that clash with pages or products are rejected; long Bangla posts still meet the performance budget.

### Security and privacy

- Abandoned SMS go only to phones captured with the consent notice, with caps against harassment and SMS cost abuse.
- Blog content is sanitized like pages.

### Done when

- [ ] Upsell acceptance adds to the same order with correct COD.
- [ ] Abandoned SMS recover carts within caps.
- [ ] Blog posts rank-ready (valid structured data) and within budget.

---

## Phase 45 — More payment gateways and refunds

| | |
|---|---|
| Milestone | M9 |
| Delivers | Nagad direct, aamarPay, ShurjoPay (P2); refunds through gateway APIs (P2) |
| Depends on | 18 |
| Size | M |

**Goal.** Every common Bangladeshi payment method, plus refunds without leaving the Dashboard.

### Build

1. **Gateway drivers** following phase 18's pattern:
   - **Nagad direct:** its signed and encrypted request scheme with public/private keys, the callback, then verify.
   - **aamarPay** and **ShurjoPay:** session, redirect, IPN, verification API.
   - Each with "Test connection", reconciliation, expiry, circuit breakers, contract tests and nightly sandbox runs.
2. **Refunds from the Dashboard:**
   - full and partial refunds through each gateway's refund API, with status tracking
   - manual-refund fallback records, plus refund SMS to the customer
   - refund permission and limits per role
3. **Refund reasons and reporting** feed phase 41.

### Edge cases

- **Refund API limits:** partial refunds not supported by a gateway (manual fallback); refund windows expired (manual).
- **Refund lifecycle:** a refund pending for days (status polling); double refund attempts (idempotent).

### Security

- Each gateway's keys are encrypted (including Nagad's private key); never logged.
- Refunds need `RefundPayment`, follow role limits, and are recorded.

### Done when

- [ ] Sandbox payments and refunds work for each new gateway, with all phase 18 edge cases covered.

---

## Phase 46 — More couriers and smart courier assignment

| | |
|---|---|
| Milestone | M9 |
| Delivers | Paperfly, eCourier and other couriers (P2); automatic courier choice |
| Depends on | 37 |
| Size | M |

**Goal.** Support every courier merchants use, and pick the best one per parcel automatically.

### Build

1. **More drivers:** Paperfly, eCourier, and others that merchants ask for (Sundarban, SA Paribahan for heavy goods, and others), with location mapping, contract tests and nightly runs where sandboxes exist.
2. **Smart assignment rules** per store:
   - choose by district, weight, COD amount, price quote
   - or by **historical delivery success** for that district and courier (from phase 37 data)
   - with a fallback order when a courier's API is down
3. **Rate quotes** shown at booking time where couriers offer them.
4. **Multi-courier sticker printing** in one batch.

### Edge cases

- Couriers without APIs: a manual workflow with tracking numbers and CSV status upload.
- A rule choosing a courier that then rejects the booking: automatic fallback to the next rule.

### Done when

- [ ] Bulk booking automatically spreads parcels across couriers by the store's rules, with fallback working.

---

## Phase 47 — Public API, webhooks and integrations

| | |
|---|---|
| Milestone | M9 |
| Delivers | Public API (Growth, spec phase 3) |
| Depends on | 43 |
| Size | L |

**Goal.** Merchants and their developers integrate with their store safely: accounting, ERPs, custom apps, automation tools. And still no plugin marketplace.

### Build

1. **API keys** per store, using Vendure's API key feature:
   - scoped permissions (read orders, write products…) and expiry
   - last-used tracking and rotation
   - usable only by the owner role
2. **Rate limits and quotas** per key and per plan.
3. **Webhooks:**
   - **Events:** order created, confirmed, shipped, delivered, returned; product changed; stock low.
   - **Delivery:** HMAC signatures with timestamps, retries with backoff, a delivery log and a manual re-send.
   - **Outbound safety:** every delivery goes through the SSRF guard (no private IP ranges, DNS checked at connect time).
4. **Developer documentation** in Bangla and English: GraphQL schema reference (via `vendure schema`), authentication, webhooks with verification examples, rate limits, and a changelog with a deprecation policy.
5. **API versioning** and a deprecation policy (at least 6 months' notice).

### Edge cases

- **Webhook receivers:** down for days (retries then disable, with an email); slow (timeouts); pointing to internal addresses (blocked).
- **Leaked API keys:** instant revoke, last-used info, optional IP restriction.

### Security

- Keys are stored hashed and shown once. Scopes are enforced server-side, using the phase 01 permission audit test extended to API keys.
- **Webhook SSRF protection** is mandatory; this is the riskiest outbound feature.

### Done when

- [ ] A developer builds a working integration from the docs alone, using a scoped key and verified webhooks.
- [ ] SSRF tests against webhook URLs pass.

---

## Phase 48 — Mobile admin app and push notifications

| | |
|---|---|
| Milestone | M9 |
| Delivers | Mobile admin (Growth, spec phase 3) |
| Depends on | 43 |
| Size | L |

**Goal.** Owners and order staff run the daily work from their phones, with instant alerts for new orders.

### Decide at start

- **PWA first** (installable web app with Web Push), then a native wrapper only if the PWA proves insufficient (for example, background notification reliability on some Android phones).

### Build

1. **Installable PWA** for the key flows (Bangla first):
   - confirmation queue with tap-to-call, order detail, incomplete orders
   - payment verification, courier booking, home numbers
2. **Push notifications:**
   - new order, payment awaiting verification, courier issues, low stock
   - per-user settings and quiet hours
3. **Works with weak connections:** recent orders cached for viewing; actions queue offline and send when back online, with conflict handling (an order already confirmed by someone else).

### Edge cases

- **Push problems:** permission denied (fall back to SMS digest for owners); delivery blocked by aggressive battery savers on some Android brands (documented guidance).
- **Offline conflicts:** an offline action conflicts with another staff member's change (the server wins, and the user is told).

### Security

- Same authentication as the Dashboard, including two-factor. Device sessions are listed and revocable (phase 32).
- Cached data is minimal and cleared on logout.

### Done when

- [ ] An owner confirms and books orders from the installed app on a mid-range Android phone, and receives new-order notifications within seconds.

---

## Phase 49 — Platform payments

| | |
|---|---|
| Milestone | M9 |
| Delivers | Platform-level payments: online payments on day one, no gateway paperwork (Later) |
| Depends on | 39, 42 |
| Size | XL (gated by legal approval) |

**Goal.** New merchants accept online payments from day one through the platform's own payment arrangement, like Shopify Payments, without applying for gateway accounts themselves.

### Prerequisite (do not start the build without it)

- **Legal and regulatory clearance:** confirm with a lawyer and a licensed payment provider what Bangladesh Bank allows. The likely route is a **sub-merchant or aggregator arrangement through a licensed PSP**, not holding funds ourselves. Record it in an ADR with the legal opinion.

### Build (once cleared)

1. **Merchant onboarding (KYC)** per the PSP's requirements: trade licence, NID of the owner, bank or mobile-banking payout account. Documents are stored encrypted, with access logged.
2. **Payments through the PSP's sub-merchant model**, reusing phase 18's patterns.
3. **Settlement:** payout schedules, statements, fees and reconciliation in the Dashboard; disputes and chargebacks workflow.
4. **Risk:** limits for new merchants, holds on suspicious activity, monitoring for fraud.

### Edge cases

- Settlement failures; disputes and chargebacks; a merchant suspended with pending payouts (the PSP's rules and our terms decide).

### Security

- KYC documents are among the most sensitive data we'd hold: encrypted, minimal access, with retention per law.
- Strict separation of duties for payout changes (two-person approval).

### Done when

- [ ] Legal clearance is documented, and a test merchant completes KYC, takes online payments and receives a settlement through the PSP.

---

## Phase 50 — Scale and performance II

| | |
|---|---|
| Milestone | M9 |
| Delivers | Growth past 200 stores; AVIF; Banglish search |
| Depends on | 29 |
| Size | L |

**Goal.** Keep "fastest in BD" true as the platform grows, and make operations at hundreds of stores routine.

### Build

1. **AVIF images** through `<picture>` with WebP fallback: about 20–30% smaller. Encoding time is measured and run in background jobs.
2. **PgBouncer** (transaction mode) per server, if phase 29's measurements or growth call for it.
3. **Moving stores between servers** with near-zero downtime: replicate, sync files, switch, verify, and roll back if needed. Central automates rebalancing for full servers.
4. **Capacity planning automation:** central forecasts per server and alerts before a server fills; new servers are added with the phase 23 playbook.
5. **Multi-region disaster recovery:** standby restore capability in a second region or provider, rehearsed.
6. **Banglish search:** transliteration between Bangla and Latin script ("panjabi" ⇄ "পাঞ্জাবি") without manual synonyms, plus typo tolerance improvements.
7. **CDN and edge improvements** as Bangladeshi network conditions change (repeat phase 29's edge test yearly).
8. **More themes**, based on what merchants actually build with the editor.

### Edge cases

- **Store moves:** a move during heavy traffic (scheduled, with a short read-only window); a failed move rolls back to the source.
- **AVIF encoding load:** background-only, with a backlog that never delays uploads.

### Done when

- [ ] A store moves between servers with under a minute of read-only time.
- [ ] AVIF reduces image bytes as measured.
- [ ] Banglish queries find Bangla products without synonyms.
