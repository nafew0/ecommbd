# Ecomm BD: notes for AI coding sessions

Read first:
- [README.md](README.md) (setup and commands)
- [docs/mvp-spec.md](docs/mvp-spec.md) (what we're building)
- [docs/architecture.md](docs/architecture.md) (how)
- [docs/roadmap/README.md](docs/roadmap/README.md) (the phases; the user asks "complete phase NN")
- [docs/decisions.md](docs/decisions.md) (decisions so far)

## How the user wants work done

- **Keep it simple.** MVP-level tooling: no strict audits, compliance gates or heavy automation unless asked. Suggest stricter options as a later step instead.
- **Work on the `nafew` branch.** Don't push or open pull requests without asking.
- The user reviews everything: make small, clear changes and explain them in plain language.

## Project rules

- **Vendure is the core,** installed from npm at an exact version. Never edit `node_modules`.
  - Features are Vendure plugins in `apps/core/src/plugins/`, scaffolded with `npx vendure add` and listed in `apps/core/src/plugins/index.ts`.
  - When an extension point isn't enough, see README section 9.
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
- **Logs:** no full phone numbers, emails or secrets. The JSON logger masks messages; don't log whole objects with personal data.

## Commands

```bash
npm run services:up      # PostgreSQL + Redis in Docker
npm run dev              # server, worker, Dashboard
npm run lint && npm run typecheck && npm test && npm run test:e2e
npm run build && npm run test:browser
```

## Gotchas

- `packages/shared` must be built before the core runs. The root `npm run` scripts do this; inside `apps/core`, run `npm run build:shared` at the root first.
- When writing files, `\uXXXX` escapes for invisible characters (zero-width space, BOM, ZWJ, ZWNJ) can end up as the real invisible character. Write them as escapes and check: ESLint's `no-irregular-whitespace` catches them.
