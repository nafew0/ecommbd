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

### Decide at start

- Lint and format tooling: ESLint flat config + Prettier, or Biome. Pick one and apply it to all workspaces.
- Dependabot or Renovate. Whichever is chosen must group all `@vendure/*` packages into one update.
- CI runner limits: target a full CI run of under 10 minutes.

### Build

1. **CI** (`.github/workflows/ci.yml`), on every pull request and push to `main`:
   - `npm ci`, typecheck for all workspaces, lint, format check
   - unit tests (Vitest)
   - Vendure API end-to-end tests with PostgreSQL 17 and Redis service containers
   - `npm run build`
   - `npm audit --omit=dev --audit-level=high`
   - secret scan (gitleaks)
   - licence check for production dependencies against an allowlist (MIT, ISC, BSD, Apache-2.0, GPL-3.0 for the server)
   - Least-privilege workflow permissions (`contents: read`), third-party actions pinned by commit SHA, no `pull_request_target` on untrusted code.
2. **CodeQL** code scanning, and **Dependabot alerts**. Both are free for public repositories.
3. **`packages/shared`** (TypeScript, zero runtime dependencies where possible, 100% branch coverage):
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
   - Vitest workspace config.
   - `apps/core/e2e/` using `@vendure/testing` against PostgreSQL, with a helper to start the server with our plugins and to seed data.
   - An example test proving the harness works.
   - Playwright installed and configured for the storefront later (mobile emulation, slow-4G profile).
7. **Permission audit test.** It lists every custom GraphQL resolver and REST route our plugins add, and fails if one has no permission declaration. Empty for now; every later phase is covered automatically.
8. **Project rules for humans and agents:**
   - `CLAUDE.md` at the repo root covers commands, the plugin-first rule, migration rules (expand and contract), the Bangla/English rule, the security checklist, testing expectations, the roadmap protocol, and links to docs. It references `apps/core/AGENTS.md`.
   - `README.md` at the root: what the product is, how to start (link to the setup guide), and repository layout.
9. **Docs scaffolding:**
   - `docs/decisions/` with an ADR template and the first ADRs: 001 Vendure on upstream releases, 002 one site and database per store, 003 PostgreSQL + two Redis + Varnish, 004 Astro storefront.
   - `docs/glossary.md`: Bangla/English terms for orders, statuses, payments and delivery.
   - `CHANGELOG.md`.
10. **Branch protection** settings documented for you to apply on GitHub: require CI, require one review, no force-push to `main`.

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

- CI secrets: none are needed yet. Later phases add only sandbox credentials, and never production secrets.
- The crypto helper uses only Node's `crypto` module (no custom algorithms). Keys are 256-bit from the environment.
- The secret scan runs on the full git history once, to confirm nothing leaked during setup.
- The repository is public: its README and `CLAUDE.md` must not contain internal hostnames, IPs or credentials. Production inventory lives outside the repo.

### Tests

- Unit tests for every `packages/shared` module (table-driven, including all edge cases above).
- The end-to-end harness smoke test.
- CI proves it blocks merges: a deliberately failing lint, test and fake secret on a test branch must each fail CI. Documented with screenshots in the PR, then the branch is deleted.

### Done when

- [ ] A pull request to `main` runs the full CI in under 10 minutes and is green.
- [ ] A failing test, a lint error and a committed fake secret are each blocked by CI.
- [ ] `packages/shared` is used by `apps/core` (environment validation) with 100% branch coverage.
- [ ] The core refuses to start with a missing or invalid variable and says which one.
- [ ] `CLAUDE.md`, the root README, ADRs 001–004, the glossary and the CHANGELOG exist.
- [ ] Dependabot or Renovate opens grouped `@vendure/*` updates.

### Not in this phase

Log shipping and metrics (28), the storefront app (12), release builds (26).

---

## Phase 02 — Bangladesh store defaults, geo data and store settings

| | |
|---|---|
| Milestone | M1 · Foundations |
| Delivers | Bangladesh defaults for every new store (P0); base for addresses and shipping |
| Depends on | 01 |
| Size | L |

**Goal.** Every store starts correctly set up for Bangladesh: BDT, Bangla and English, the country, tax and roles. Addresses use real divisions, districts and upazilas/thanas, so shipping, couriers and reports can rely on them.

### Decide at start

- **Dataset source and licence** for divisions (8), districts (64), upazilas (~495) and metropolitan thanas (Dhaka, Chattogram and other city corporations), with Bangla and English names and official geocodes. Candidates: Bangladesh Bureau of Statistics geocodes, or an open dataset on GitHub (check the licence; attribute it).
- **Vendure provinces:** whether to create the 64 districts as Vendure `Province` regions, so Vendure's own address `province` and zones can refer to them, or to keep districts only in our data and custom fields.
- **Default storefront language:** Bangla or English per store, chosen at setup. The second language is always available.
- **Address field mapping** onto Vendure's address (`streetLine1`, `city`, `province`, `postalCode`), plus our custom fields. Check that order addresses accept the same custom fields as customer addresses in Vendure 3.8.
- **Rounding policy** details beyond the README rule, for example whether tax-exclusive prices are allowed at all.

### Build

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
6. **Dashboard:**
   - a "Store settings" page (profile, policies, locale)
   - a district/thana picker component for any address form
7. **Docs:** an ADR for each decision, and a setup guide note on `store:init`.

### Edge cases

- **Duplicate names across districts.** Every district has a "Sadar" upazila, and several cities have a "Kotwali" thana. Selection is always hierarchical, and IDs are never resolved from a name alone.
- **City areas vs upazilas.** Shoppers write "Mirpur" or "Uttara", while couriers use their own area lists (phase 19). City corporation areas and upazilas are kept as distinct types.
- **New administrative units** created after our dataset was built: offer "Other / not listed" plus free text, flag the order, and add the unit in the next data version.
- **Merchant changes defaults** (switches the currency to USD, deletes a zone): the initializer doesn't fight it. The settings page warns that BDT is expected by couriers and payments.
- **Migrated store** (phase 21): the initializer runs before import; the import then fills data without duplicating defaults.
- **Missing translation:** product or page content without Bangla falls back to English (Vendure's language fallback).
- **Bangla digits** in store phone numbers or settings are normalized on save.
- **Initializer interrupted** halfway: it re-runs safely, and each step checks existence first.

### Security

- Settings changes need a dedicated permission (`UpdateStoreSettings`) and are recorded in history (the full activity log arrives in phase 32).
- Public/private split enforced on the server, with a test that private fields never appear in Shop API responses.
- The logo goes through the normal asset upload; phase 09 later adds validation and re-encoding.
- Geo queries are read-only and need no authentication; they're rate-limited like any public endpoint.

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

### Done when

- [ ] A fresh database started with `npm run dev` gives a store in **BDT**, with Bangla and English, Bangladesh enabled, 0% standard tax with prices including tax, and the five roles defined.
- [ ] The Dashboard has a Store settings page, and an address form with a district → thana picker in both languages.
- [ ] `bdDistricts` and `bdThanas` work in the Shop API and are cacheable.
- [ ] The initializer is idempotent and documented, and ADRs record the dataset source, provinces decision and address mapping.

### Not in this phase

Shipping rates (07), the checkout form (14), courier area mapping (19), assigning staff to roles (32).
