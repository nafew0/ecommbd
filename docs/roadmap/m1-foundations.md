# M1 · Foundations

> Phases 01–02 · [Roadmap overview](README.md)
> **Exit criteria:** CI blocks bad code, and a new store starts in BDT with Bangladesh, Bangla and English, and district/thana data.

---

## Phase 01 — Engineering foundation

| | |
|---|---|
| Milestone | M1 · Foundations |
| Delivers | Enables every later phase |
| Depends on | 00 (project setup, done) |
| Size | M |

**Goal.** Every later phase can be built, reviewed and merged safely. CI catches mistakes, shared code solves Bangladesh-specific basics once, and anyone (including future Claude sessions) knows the project's rules.

> **Scope simplified on 2026-10-20** at the user's request: MVP-level tooling, no strict audits ([decisions](../decisions.md)). The permission audit test, `npm audit` gate, licence check, gitleaks and CodeQL were dropped; they can be added later if needed. Built on the `nafew` branch.

### Decided

- **Lint and format:** ESLint (recommended rules) + Prettier.
- **Dependency updates:** Dependabot, weekly, with all `@vendure/*` packages in one update.
- **Tests:** Vitest for unit and end-to-end tests, Playwright for the browser.
- **TypeScript:** 5.8.2, the version Vendure is tested with.

### Build

1. **CI** (`.github/workflows/ci.yml`): one simple job on every pull request and on pushes to `main` and `nafew`:
   - `npm ci`, lint, typecheck
   - unit tests
   - end-to-end tests with PostgreSQL 17 and Redis service containers
   - build
   - Playwright Dashboard login test

   Read-only workflow permissions, actions pinned by commit SHA.
2. **Dependabot** (`.github/dependabot.yml`) for npm and GitHub Actions.
3. **`packages/shared`** (TypeScript, 100% test coverage):
   - `phone`: normalize, validate, format and mask Bangladeshi mobile numbers; operator from prefix; split fields that hold several numbers.
   - `money`: whole-taka helpers, rounding (half-up to taka), formatting with lakh grouping (`৳1,00,000`) and optional Bangla digits.
   - `text`: NFC normalization, whitespace collapse, Bangla⇄ASCII digit conversion. Strips zero-width spaces and BOMs, but never ZWJ/ZWNJ.
   - `time`: Asia/Dhaka helpers for day boundaries, quiet hours, business days and formatting.
   - `crypto`: AES-256-GCM encrypt/decrypt with a key-version prefix (`v1:` …), random 96-bit IVs, and a key-rotation helper.
   - `http`: an outbound client with timeouts (connect 5 s, total 15 s by default), retries only for idempotent requests, a per-host circuit breaker, request IDs, header and body redaction, and the **SSRF guard**. The guard resolves DNS, blocks private, loopback, link-local and metadata ranges (IPv4 and IPv6), re-checks on redirects (max 3), and caps response size.
   - `idempotency`: key format and storage helpers.
   - `env`: zod helpers to validate environment variables at boot.
4. **Environment validation** in `apps/core`: a zod schema for every variable in `.env.example`. The server exits at boot with a clear list of what's missing or invalid.
5. **Structured logging.** A Vendure logger that writes JSON in production (pretty in dev), with log level from the environment, request IDs and a PII redaction helper. Shipping logs to a central system comes in phase 28.
6. **Test harness:**
   - unit tests in `apps/core/test/unit/`
   - end-to-end tests in `apps/core/test/e2e/`, using `@vendure/testing` against PostgreSQL with our plugins and middleware (`test/support/test-config.ts`)
   - a Playwright Dashboard login test in `tests/browser/`
7. **Project rules:** `CLAUDE.md` (commands, plugin-first rule, migrations, Bangla/English, permissions on each method, the keep-it-simple preference) and a product introduction at the top of the root `README.md`.
8. **Docs:** `docs/decisions.md` (a short decisions log instead of separate ADR files), `docs/glossary.md`, `CHANGELOG.md`.

### Edge cases

- **Phone input** (all in unit tests):
  - Accepted formats: `01712345678`, `+8801712345678`, `8801712345678`, `008801712345678`, `০১৭১২৩৪৫৬৭৮`, `017-1234-5678`, `(017) 12345678`, ` 01712345678 `, and the 10-digit `1712345678`.
  - Rejected: `012…` (no such mobile prefix), landlines such as `02-9123456` (rejected for SMS, allowed as an alternate number), 10 or 12 digits after the prefix.
  - Mixed content: text around the number (`01712345678 (bkash)`); two numbers in one field (`01712345678/01812345678` takes the first and reports the second).
- **Money:** zero, negative (refunds), very large amounts (`৳10,00,00,000`), a percentage of an odd amount rounding to whole taka, and Bangla digits.
- **Time:** an order at 23:59:59 and one at 00:00:00 Dhaka time fall on different days, although both are on the same UTC date.
- **Text:**
  - Bangla with ZWJ/ZWNJ stays byte-identical after normalization.
  - `ড়` written as U+09DC and as `ড` + `়` compare equal after normalization.
  - Emoji survive; control characters are removed.
- **SSRF guard** blocks:
  - `http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254`, `http://10.0.0.1`
  - a hostname that resolves to a private IP (DNS rebinding)
  - a redirect from a public URL to a private one
  - a response larger than the cap
- **Crypto:** decrypting with the wrong key fails loudly; tampered ciphertext fails (auth tag); old-version ciphertext still decrypts after rotation.

### Security

- CI needs no secrets; it uses the development values from `.env.example`.
- The crypto helper uses only Node's `crypto` module (no custom algorithms). Keys are 256-bit from the environment, and error messages never include key material.
- The repository is public: its README and `CLAUDE.md` must not contain internal hostnames, IPs or credentials.
- Turn on GitHub's free secret scanning and push protection in the repository settings (no code needed).

### Tests

- Unit tests for every `packages/shared` module, including all edge cases above: 181 tests, 100% coverage.
- Core unit tests for settings, JSON logs and request IDs.
- An end-to-end test: a real server on PostgreSQL answers the Shop and Admin APIs and returns request IDs.
- Playwright: Dashboard login works; a wrong password is refused.

### Done when

- [x] `packages/shared` is used by `apps/core` (settings checks) with 100% test coverage.
- [x] The core refuses to start with a missing or invalid setting and says which one.
- [x] Lint, typecheck, unit, end-to-end and browser tests pass locally.
- [x] `CLAUDE.md`, the README introduction, the decisions log, the glossary and the CHANGELOG exist.
- [ ] CI runs green on GitHub (after the branch is pushed).
- [ ] Dependabot opens its first grouped update (after merge to `main`).

### Not in this phase

Log shipping and metrics (28), the storefront app (12), release builds (26).

---

## Phase 02 — Bangladesh store defaults, geo data, store settings and the merchant admin

| | |
|---|---|
| Milestone | M1 · Foundations |
| Delivers | Bangladesh defaults for every new store (P0); base for addresses and shipping; our own simple merchant admin (P0) |
| Depends on | 01 |
| Size | XL (split into 02a defaults, geo data and settings, and 02b the merchant admin) |

**Goal.** Every store starts correctly set up for Bangladesh: BDT, Bangla and English, the country, tax and roles. Addresses use real divisions, districts and upazilas/thanas, so shipping, couriers and reports can rely on them. Merchants get their own simple admin in Bangla and English, and every later phase adds its screens there.

> **Built on 2026-10-21** on the `nafew` branch. Decisions are in the [decisions log](../decisions.md) (2026-10-21 rows); the setup guide covers `store:init` and the admin.

### Decide at start

- **Dataset source and licence** for divisions (8), districts (64), upazilas (~495) and metropolitan thanas (Dhaka, Chattogram and other city corporations), with Bangla and English names and official geocodes. Candidates: Bangladesh Bureau of Statistics geocodes, or an open dataset on GitHub (check the licence; attribute it).
- **Vendure provinces:** whether to create the 64 districts as Vendure `Province` regions, so Vendure's own address `province` and zones can refer to them, or to keep districts only in our data and custom fields.
- **Default storefront language:** Bangla or English per store, chosen at setup. The second language is always available.
- **Address field mapping** onto Vendure's address (`streetLine1`, `city`, `province`, `postalCode`), plus our custom fields. Check that order addresses accept the same custom fields as customer addresses in Vendure 3.8.
- **Rounding policy** details beyond the README rule, for example whether tax-exclusive prices are allowed at all.
- **Admin stack (02b):** React + Vite + TypeScript + Tailwind + shadcn/ui, with TanStack Query and a small GraphQL client. It's the same family as Vendure's Dashboard and the reference store's admin, so the skills carry over. Confirm, and pick the translation library.
- **Where the admin is served:** recommended as static files from the core at `/admin` on the store's domain, the same origin as the Admin API, so the session cookie works without CORS.

### Build: defaults, geo data and settings (02a)

1. **`packages/bd-geo`:**
   - Hierarchical dataset: division → district → upazila/thana, plus city corporation areas. Each unit has a stable ID (geocode), Bangla name, English name and aliases (old and alternate spellings: Chittagong/Chattogram, Comilla/Cumilla, Jessore/Jashore, Barisal/Barishal, Bogra/Bogura, Chapai Nawabganj/Chapainawabganj…).
   - **Delivery-zone tag** per unit: `dhaka_city` (Dhaka North and South City Corporation areas), `dhaka_suburb` (Savar, Keraniganj, Dhamrai, Nawabganj, Dohar and other parts of Dhaka district outside the city), `outside_dhaka`. Optionally `chattogram_city`.
   - Functions: `getDistricts()`, `getThanas(districtId)`, `findById`, `search(query)` (fuzzy, alias-aware, Bangla and English), `zoneOf(districtId, thanaId)`.
   - Versioned data (`dataVersion`) with a changelog; unit IDs are never reused.
   - Gzipped size of the full dataset measured. Target ≤ 15 KB for the parts the checkout loads.
2. **Shop API queries** (in a `bd-core` plugin): `bdDistricts(lang)` and `bdThanas(districtId, lang)`. Cacheable (the storefront and Varnish cache them), with no personal data.
3. **Store defaults initializer** (`bd-core` plugin), idempotent and extensible:
   - A registry where later plugins add their own defaults: shipping methods in 07, COD in 08, SMS templates in 10, and so on.
   - Runs on first boot of a new store, and on demand (`npm run store:init`). It only *creates missing* things and never overwrites changes the merchant made. `--force` exists for operations staff only.
   - Default channel: currency **BDT**, prices **include tax**, available languages **bn** and **en**, default language from setup.
   - Countries: Bangladesh enabled. Other countries exist but are disabled (only foreign-address orders would need them, and that's off by default).
   - Zones: `Bangladesh` (default tax and shipping zone).
   - Tax: category "Standard" with a **0%** rate by default. VAT-registered merchants set their own rate; the help text tells them to confirm with their accountant.
   - Global settings: `trackInventory: true`, `outOfStockThreshold: 0`.
   - **Roles defined now** (assigning staff comes in phase 32): Owner, Manager, Order staff, Packer, Marketing, as our own permission sets. Only the owner account exists at first.
4. **Store settings** in Vendure's settings store (or a small plugin entity if the settings store doesn't fit; decide during the phase):
   - **Profile:** store name (bn/en), logo, favicon, phones, WhatsApp number, Messenger page, email, address, trade licence number (optional), social links, business hours, short description.
   - **Policies:** return, refund, privacy, terms. Bangla templates are pre-filled and must be reviewed by the merchant.
   - **Locale:** default language, show prices in Bangla digits (yes/no), date format.
   - Each field is marked **public** (sent to the storefront) or **private** (Dashboard only). The storefront query returns only public fields.
5. **Address fields** as custom fields on customer addresses and order addresses:
   - `districtId`, `thanaId`, `area` (free text, such as "Mirpur 10"), `landmark`, `alternatePhone`
   - Vendure's own `city` and `province` are filled from the IDs, in English, for compatibility.
   - A validation service checks that the thana belongs to the district.
6. **Admin screens** (in the 02b admin):
   - a "Store settings" page (profile, policies, locale)
   - a district/thana picker component for any address form
7. **Docs:** an ADR for each decision, and a note on `store:init` in the setup guide (root `README.md`).

### Build: the merchant admin (02b)

**Why our own admin.** Our partner wants a simple admin with only the fields BD merchants use. Vendure's Dashboard is built for complex stores and has no Bangla. The model is the admin in [reference-bd-admin.md](../research/reference-bd-admin.md): about 12 menus, one-page forms, Bangla first. Vendure stays the engine: the admin only talks to Vendure's Admin API, and all permission checks stay on the server.

1. **`apps/admin`:** a React app built to static files and served by the core at `/admin`.
2. **Sign-in** with Vendure's Admin API (the `login` mutation and a cookie session). Bangla and English errors, sign-out, and "session expired, please sign in again". Two-factor comes in phase 32.
3. **Layout:**
   - a left sidebar with icons that collapses, and becomes a drawer on phones
   - page header, toasts, confirm dialogs and friendly empty states
   - a Bangla/English switch saved per staff user
   - a self-hosted Bangla font
4. **Menu.** The full list is below. Each item appears when the phase that builds it ships.

   | Menu | Items | Built in |
   |---|---|---|
   | Dashboard | Order and revenue counts (today, 7 and 30 days), waiting for confirmation, low stock, latest orders | 04, 33 |
   | Orders | All orders, Confirm orders, Phone order, Incomplete orders, Verify payments | 04, 05, 08, 11 |
   | Products | All products, Categories, Reviews, Stock | 05, 35 |
   | Customers | Customers, Block list | 03, 11 |
   | Sales pages | Landing pages with checkout | 16 |
   | Online store | Theme, Home page, Header and footer, Menus, Pages | 12, 15 |
   | Marketing | Coupons, Tracking (Pixel, TikTok, GTM) | 20, 35, 36 |
   | Settings | Store, Delivery, Payments, Couriers, Checkout, Invoice, Staff | 02, 06, 07, 08, 14, 19, 32 |

   No spin wheel.
5. **Building blocks** so every later phase adds a screen quickly:
   - **list page:** search, status tabs with counts, filters, pagination and bulk select
   - **form page or dialog:** validation with zod and messages in both languages
   - **inputs:** image upload, phone (using `packages/shared`), taka amount, and Dhaka date and time
6. **Vendure's own Dashboard** stays at `/dashboard` for our support team. Merchant staff are sent to `/admin`. Hiding it is only a convenience: permissions are enforced by the server either way.
7. **Playwright:** the Dashboard login test from phase 01 moves to the new admin. Keep one smoke test for Vendure's Dashboard.

### Edge cases

- **Duplicate names across districts.** Every district has a "Sadar" upazila, and several cities have a "Kotwali" thana. Selection is always hierarchical, and IDs are never resolved from a name alone.
- **City areas vs upazilas.** Shoppers write "Mirpur" or "Uttara", while couriers use their own area lists (phase 19). City corporation areas and upazilas are kept as distinct types.
- **New administrative units** created after our dataset was built: offer "Other / not listed" plus free text, flag the order, and add the unit in the next data version.
- **Merchant changes defaults** (switches the currency to USD, deletes a zone): the initializer doesn't fight it. The settings page warns that BDT is expected by couriers and payments.
- **Migrated store** (phase 21): the initializer runs before import; the import then fills data without duplicating defaults.
- **Missing translation:** product or page content without Bangla falls back to English (Vendure's language fallback).
- **Bangla digits** in store phone numbers or settings are normalized on save.
- **Initializer interrupted** halfway: it re-runs safely, and each step checks existence first.
- **Admin session expires while a form is open:** the typed values stay, the admin asks to sign in again, then the save completes.
- **Slow mobile data:** the admin shows skeletons, keeps its first load small, and loads each screen only when opened.
- **Bangla digits typed** in number, phone and price inputs are accepted and normalized.
- **Long Bangla labels** in the sidebar, buttons and table headers: checked at phone and desktop widths.

### Security

- Settings changes need a dedicated permission (`UpdateStoreSettings`) and are recorded in history (the full activity log arrives in phase 32).
- Public/private split enforced on the server, with a test that private fields never appear in Shop API responses.
- The logo goes through the normal asset upload; phase 09 later adds validation and re-encoding.
- Geo queries are read-only and need no authentication; they're rate-limited like any public endpoint.
- **Admin:**
  - the session lives in an HTTP-only cookie, never in `localStorage`
  - Vendure's CSRF protection is on
  - a strict Content Security Policy applies to `/admin`
  - the admin hides what a role can't do, but the server is what blocks it

### Tests

- **Dataset integrity** (unit):
  - 8 divisions, 64 districts, every upazila/thana has a parent, IDs are unique and stable, both names exist, and everything is NFC-normalized.
  - Aliases resolve correctly, and `zoneOf` is correct for a list of known places.
- **End-to-end:**
  - A fresh database plus the initializer gives the expected channel, languages, country, zone, tax and roles. A second run changes nothing.
  - A merchant change survives a re-run.
  - Settings permission is enforced.
  - Private settings never leak through the Shop API.
- **Address validation:** a thana not in the district is rejected with a Bangla/English error.
- **Admin (Playwright):** sign in and out in Bangla and English, a wrong password, the sidebar at phone width, and editing store settings on a phone.

### Done when

- [x] A fresh database started with `npm run dev` gives a store in **BDT**, with Bangla and English, Bangladesh enabled, 0% standard tax with prices including tax, and the five roles defined. (End-to-end test on a fresh database; also seen on the dev database with `npm start`.)
- [x] A merchant signs in at `/admin`, switches between Bangla and English, and edits Store settings on a phone. (Playwright, Pixel 7.)
- [x] The admin has an address form with a district → thana picker in both languages. (Store settings → address; Playwright.)
- [x] Vendure's Dashboard still works at `/dashboard` for our support team. (Playwright smoke test.)
- [x] `bdDistricts` and `bdThanas` work in the Shop API and are cacheable. (End-to-end tests, including a 304 on the GET routes.)
- [x] The initializer is idempotent and documented, and ADRs record the dataset source, provinces decision and address mapping.
- [ ] CI runs green on GitHub (after the branch is pushed).

### Not in this phase

Shipping rates (07), the checkout form (14), courier area mapping (19), assigning staff to roles (32), the screens behind each menu item (built in the phase listed).
