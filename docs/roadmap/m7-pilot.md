# M7 · Pilot

> Phases 30–31 · [Roadmap overview](README.md)
> **Exit criteria:** one migrated WooCommerce merchant has run on Ecomm BD for 30 days and the MVP success criteria in [mvp-spec.md](../mvp-spec.md) section 2 are met, or every gap has a scheduled fix.

---

## Phase 30 — Security hardening I (pre-pilot)

| | |
|---|---|
| Milestone | M7 |
| Delivers | Safety before real shoppers and real money touch the system |
| Depends on | 03–29 (all P0 build and platform phases) |
| Size | M |

**Goal.** Close the obvious holes before a real merchant's customers trust us with their phone numbers, addresses and payments.

### Build

1. **Threat model** (`docs/security/threat-model.md`):
   - a data-flow diagram (shopper → Varnish → storefront → core → PostgreSQL/Redis; staff → Dashboard; core → gateways, couriers, Meta, SMS; agent ↔ central)
   - an asset inventory (personal data, payment references, secrets, backups)
   - STRIDE threats per component, each with its mitigation or accepted risk
2. **ASVS Level 2 review** of everything built so far, with findings tracked as issues:
   - **Staff:** Dashboard authentication and sessions.
   - **Access control:** the permission audit test from phase 01 lists every resolver and route. Also test for IDOR: one store's data from another session, a shopper's order from another session.
   - **Input and output:** validation and encoding, rich text sanitizing, file uploads.
   - **Integrations:** payment flows and webhooks.
   - **Abuse controls:** rate limits, error handling (no stack traces to users).
3. **GraphQL hardening:**
   - `@vendure/harden-plugin`: query complexity and depth limits, introspection and GraphiQL off in production, field suggestions off
   - **Apollo `csrfPrevention` on.** First check that the Dashboard's uploads still work (they must send the preflight header).
   - strict CORS (only the store's own origins)
4. **Web hardening:**
   - **CSP** moves from report-only to enforced, with reports collected and reviewed.
   - **Headers:** HSTS (with `includeSubDomains` once all subdomains are HTTPS), `nosniff`, Referrer-Policy, Permissions-Policy, frame protection for the Dashboard.
   - **Cookie flags** checked everywhere.
5. **Admin hygiene:**
   - **Superadmin:** the provisioning superadmin is disabled for daily use and kept as break-glass only. Staff use personal accounts.
   - **Sessions:** idle and absolute timeouts for staff sessions.
6. **Secrets:**
   - a rotation procedure for every secret type (store encryption keys, gateway credentials, central keys), rehearsed once on staging
   - a secret scan of the full repo history repeated
7. **Automated scanning:**
   - **SAST:** Semgrep with community TypeScript rules plus our own. Our rules flag:
     - `set:html` without the sanitizer
     - outbound `fetch` not using the SSRF-guarded client
     - SQL built with string concatenation
     - logging calls that include phone or email fields
   - **DAST:** OWASP ZAP baseline against the staging storefront, Shop API and Dashboard login.
   - **Dependencies:** audit across all workspaces.
8. **Incident response v1** (`docs/runbooks/incident-response.md`):
   - severity levels and who is called
   - first-hour checklist: contain, preserve logs, rotate secrets
   - merchant communication templates in Bangla and English
   - the post-incident review format
9. **`security.txt`** and a vulnerability disclosure page (contact address, what's in scope).
10. **Fix all high and critical findings.** Medium findings are fixed or scheduled with an owner and date.

### Edge cases

- False positives from scanners: each is triaged and written up, never silently ignored.
- Hardening that breaks a feature (CSP blocking a needed script, CSRF blocking uploads): caught by the full end-to-end suite, which must stay green.

### Security

This whole phase is security. Its output also includes a **residual risk register**: known risks we're accepting for the pilot, each with a reason and a revisit date.

### Tests

- Every finding fixed has a regression test.
- The permission audit test, CSRF test, CSP test and header test run in CI from now on.
- ZAP baseline added to a scheduled CI job against staging.

### Done when

- [ ] Zero open high or critical findings.
- [ ] The ZAP baseline is clean, or every remaining warning is justified in writing.
- [ ] The threat model, residual risk register and incident runbook are reviewed by you.
- [ ] A secret rotation was rehearsed on staging.

### Not in this phase

External penetration test and legal documents (42), staff 2FA (32).

---

## Phase 31 — Pilot: migrate and run the first store for 30 days

| | |
|---|---|
| Milestone | M7 |
| Delivers | The MVP success criteria (spec section 2) |
| Depends on | 30, and all P0 phases |
| Size | L (mostly calendar time and support) |
| Needs | A signed pilot agreement and access to the merchant's WooCommerce, gateway, courier and Meta accounts |

**Goal.** One real WooCommerce merchant moves to Ecomm BD, runs their business on it for 30 days, and wants to stay.

### Decide at start

- **Pilot merchant:** pick from the 3–5 candidates (spec section 8). Ideal: a COD-heavy Facebook-ads store with 1–500 products, using at least one of Steadfast or Pathao, and willing to give feedback.
- **Timing:** avoid cutting over within two weeks before Eid or a big sale.
- **Support channel and hours** for the pilot: for example a WhatsApp group with your team and the merchant's staff.

### Build

1. **Pilot agreement:** data consent and access, what's included, support terms, and a rollback promise: the old WooCommerce store is kept read-only for 30 days.
2. **Pre-migration audit:**
   - their plugins (like the montahafood screenshot), data quirks, custom checkout fields
   - their gateway and courier accounts, their Pixel and ad setup, traffic patterns
   - a **gap list**: anything their business needs that we don't do yet, each either fixed before cutover or given a workaround the merchant agrees to
3. **Staging rehearsal:**
   - full migration of their data to a staging store, with the dry-run and verification reports reviewed together
   - **merchant acceptance testing** with their own staff:
     - place, confirm, print and book orders (courier in test mode where possible)
     - check the landing pages rebuilt from their CartFlows pages
     - review SMS templates and check Meta test events
4. **Training:**
   - a short Bangla guide and screen recordings for their staff: confirmation queue, printing, booking, incomplete orders
   - a one-hour live session
5. **Production:**
   - provision the store (phase 24) and migrate
   - **cutover** per the runbook (phase 22): lowered TTL, final sync, freeze, DNS switch
   - gateway, courier and Meta settings updated, and the redirect crawler green
6. **Hypercare:**
   - daily check-ins in week one, then twice a week
   - a dedicated dashboard for the store
   - **issue tracking with targets:** critical (orders or payments broken) fixed within 4 hours, high within 1 day
   - every incident gets a short written review
7. **At least two releases** shipped to the pilot store during the 30 days through the normal pipeline, to prove updates are invisible to the merchant.
8. **Measure the success criteria:**
   - LCP p75 from real-user data
   - migration duration
   - Event Match Quality for Purchase
   - releases rolled out with automatic health checks
   - zero times the merchant touched a server
9. **Retrospective:**
   - what broke, what was slow, what staff loved and hated
   - backlog changes, including re-prioritizing P1 items
   - with permission, a **case study** with before/after speed and conversion numbers for the public launch

### Edge cases

- **The merchant wants to roll back:** DNS points back to WooCommerce, and orders taken on Ecomm BD meanwhile are exported for them. We learn why before trying again.
- **A peak arrives during the pilot** (an unexpected sale or viral ad): the load limits from phase 29 apply; watch capacity live.
- **Gateway or courier accounts not ready on cutover day:** COD and manual bKash still work, so the cutover can proceed with online gateways turned on later.
- **Staff turnover at the merchant:** the training materials let new staff learn without us.
- **A data problem found after cutover** (a missing product field): fixed with a targeted re-import from the old store, which stays available read-only.

### Security

- Production access for our team goes through central with audited, time-limited support access. Phase 43 builds the full tool; for the pilot it's documented manual access with every session logged.
- The merchant's credentials (WooCommerce keys, gateway, courier) are handled only through the product's encrypted settings, never in chat messages or documents.

### Tests

- The staging rehearsal is the main test: every merchant workflow, run by their staff.
- After cutover, the redirect crawler and a daily synthetic checkout (dry run) on the live store.

### Done when

- [ ] The store has been live for 30 days.
- [ ] Each MVP success criterion is met, or has a scheduled fix with a date.
- [ ] Two or more releases rolled out without the merchant noticing.
- [ ] The merchant agrees to continue, ideally as a paying customer and a reference.
- [ ] The retrospective is written and the backlog updated.

### Not in this phase

Onboarding more merchants (after 43), self-serve signup (40).
