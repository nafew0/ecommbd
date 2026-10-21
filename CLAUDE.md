# Ecomm BD: notes for AI coding sessions

Read first:
- [README.md](README.md) (setup and commands)
- [docs/mvp-spec.md](docs/mvp-spec.md) (what we're building)
- [docs/architecture.md](docs/architecture.md) (how)
- [docs/roadmap/README.md](docs/roadmap/README.md) (the phases; the user asks "complete phase NN")
- [docs/decisions.md](docs/decisions.md) (decisions so far)

## How the user wants work done

- **Keep it simple.** MVP-level tooling: no strict audits, compliance gates or heavy automation unless asked. Suggest stricter options as a later step instead.
- **Each developer works on their own branch** (Nafew on `nafew`, Imtiaz on `imtiaz`), taking the phases of their track ([roadmap](docs/roadmap/README.md#who-builds-what-two-developers)). Merge `main` into your branch often and merge each finished phase to `main`. Don't push or open pull requests without asking.
- The user reviews everything: make small, clear changes and explain them in plain language.

## Project rules

- **Vendure is the core,** installed from npm at an exact version. Never edit `node_modules`.
  - Features are Vendure plugins in `apps/core/src/plugins/`, scaffolded with `npx vendure add` and listed in `apps/core/src/plugins/index.ts`.
  - When an extension point isn't enough, see README section 9.
- **Merchant screens go in our own admin** (`apps/admin`, from phase 02b), which talks to Vendure's Admin API. Keep it simple: only the fields BD merchants use (see [docs/research/reference-bd-admin.md](docs/research/reference-bd-admin.md)). Vendure's Dashboard is for our support team only.
- **Settings:** add new ones to `apps/core/src/env-schema.ts` and `apps/core/.env.example`. Read them through `env` (`src/env.ts`), never `process.env`.
- **Bangladesh helpers live in `packages/shared`:**
  - phone numbers, taka, Bangla text, Dhaka time, encryption, idempotency
  - the outbound HTTP client: use `createHttpClient` for any call to another service. Keep its SSRF protection on for URLs that come from data (imports, webhooks).
- **Money:** integer poisha, whole taka for prices and totals.
- **Time:** stored in UTC, shown and calculated in Asia/Dhaka.
- **Phones:** stored as E.164 (`+8801…`).
- **Every shopper- and merchant-facing string in Bangla and English** (see [docs/glossary.md](docs/glossary.md)).
- **Database:**
  - never `synchronize`
  - generate migrations with `npm run migrate:generate -- <name>`
  - keep them backward-compatible: add first, remove in a later release
- **Permissions:** every custom GraphQL query or mutation and every REST route needs `@Allow(...)` **on the method**. Vendure ignores `@Allow` on a class, and a method without it gets no permission check at all.
- **Store defaults:** a new default for every store is a step registered with `registerStoreDefaults` (bd-core) with a new `id`. Never edit a step that stores have already run; add a new one.
- **Addresses:** a new mutation that takes an address must be listed in `ADDRESS_ARGS` (`bd-core/address/address.interceptor.ts`), or the district/thana checks skip it.
- **Customers and emails:** customers are keyed by the `phone` custom field; phone-only customers have a placeholder email (`…@phone.invalid`). Check `isPlaceholderEmail()` (`packages/shared`) before showing, exporting or sending to any email.
- **Order statuses:** the table in `packages/shared/src/order-status.ts` drives both the server guard and the admin buttons. A new transition needs a row there and in `docs/decisions/order-states.md`.
- **Dates in SQL:** Vendure's timestamp columns have no time zone; the core runs in UTC (`src/env.ts`). Pass JS dates as parameters in SQL you write.
- **Test databases** are built from entities, not migrations: anything only a migration creates (like the order-number sequence) goes in `addMigrationOnlyObjects` (`apps/core/test/support/test-config.ts`).
- **Merchant admin (`apps/admin`):**
  - every string goes in `src/messages/en.ts` and `bn.ts` (TypeScript refuses a missing one)
  - import shared helpers by path (`@ecommbd/shared/phone`), never the package root: it contains Node-only code
  - hiding a button is a convenience; the permission check belongs on the server
- **Logs:** no full phone numbers, emails or secrets. The JSON logger masks messages; don't log whole objects with personal data.

## Storefront design standard

The storefront (`apps/storefront`) must look and feel like a modern Shopify store. Shopify's own free themes (Dawn, Horizon) are the reference. It must not look like a generic AI-made page.

- **Look:**
  - white or very light backgrounds, near-black text, one accent colour (the store's brand)
  - generous white space, large product photos, a clear type scale
  - product cards are photo, title and price, with no box, border or shadow around them
  - buttons are solid and rectangular
- **No pill shapes:** no fully rounded chips, badges, tags or buttons. Corners are square or barely rounded (`--radius`, 0–4 px). Only things that are really round (the floating WhatsApp button) are round.
- **Icons:** no icon libraries (Lucide, Heroicons, Font Awesome, Material, Feather) and no emoji as icons.
  - Use our own small SVG set in `src/components/Icon.astro`, drawn on one grid with one stroke width.
  - Use a text label instead when it's clearer.
- **No generic AI look:**
  - no gradient text or gradient backgrounds, glassmorphism, blur or glowing shadows
  - no Tailwind default palettes (slate, teal, indigo…)
  - no "✨ New" badges, and no centred hero with three feature cards
  - no filler: every element has a job
- **Motion:**
  - Motion (the `motion` package, Framer Motion's successor) in its small vanilla form (`animate` from `motion/mini`, `inView`), only inside the scripts or islands that need it. Never `motion/react`: it needs React and breaks the JS budget.
  - Everything else uses CSS transitions and cross-document view transitions.
  - Keep it short and subtle (150–300 ms, ease-out), and always off when the shopper prefers reduced motion.
  - Nothing starts hidden waiting for JavaScript.
- **Budget first:** design never buys more JavaScript than the budget allows ([architecture.md](docs/architecture.md), Decision 2). Pages with nothing to interact with stay at zero JavaScript.
- **Phone first:** design at 360–430 px first, then desktop. Check with long Bangla names and Bangla digits.

## Commands

```bash
npm run services:up      # PostgreSQL + Redis in Docker
npm run dev              # server, worker, Dashboard, merchant admin at /admin
npm run lint && npm run typecheck && npm test && npm run test:e2e
npm run build && npm run test:browser
```

## Gotchas

- `packages/shared` and `packages/bd-geo` must be built before the core runs. The root `npm run` scripts do this; inside `apps/core`, run `npm run build:packages` at the root first.
- When writing files, `\uXXXX` escapes for invisible characters (zero-width space, BOM, ZWJ, ZWNJ) can end up as the real invisible character. Write them as escapes and check: ESLint's `no-irregular-whitespace` catches them.
