# Decisions

A short log of decisions and why. Newest at the bottom. Details live in [architecture.md](architecture.md) and the [roadmap](roadmap/README.md).

| Date | Decision | Why |
|---|---|---|
| 2026-10-20 | **Vendure 3.8 is the core**, installed from npm and extended with plugins, staying on upstream releases | Won the benchmark against Medusa ([bench/RESULTS.md](../bench/RESULTS.md)); upgrades stay a version bump |
| 2026-10-20 | **One isolated site and PostgreSQL database per store**, on our CloudPanel servers | Isolation between stores, "your store isn't locked into a platform" pitch |
| 2026-10-20 | **PostgreSQL + two Redis (queue, cache) + Varnish** per server | Speed; Redis queue must never evict jobs, cache must |
| 2026-10-20 | **Astro + Preact islands** for the storefront | Zero JavaScript by default: the fastest option |
| 2026-10-20 | **Keep tooling simple for the MVP:** ESLint (recommended rules) + Prettier, Vitest, Playwright, one CI job, Dependabot | The user's call: easy to understand and maintain. Stricter checks (permission audit test, audit gates, CodeQL, secret scanning job) can be added later if needed |
| 2026-10-20 | **TypeScript 5.8.2**, not the newer 7.x | It's the version Vendure 3.8 is built and tested with |
| 2026-10-20 | **Known dependency advisories accepted for now.** `npm audit` reports 13 high-severity advisories in Vendure 3.8's dependencies; none can be fixed without a newer Vendure. Most are build tooling (`braces`, `micromatch`, `ts-morph`, `lingui`), not reachable by shoppers | **Must fix before phase 10** (real customer emails): nodemailer's address-parser denial-of-service. Upgrade Vendure if a fix exists by then, otherwise validate email addresses strictly before they reach nodemailer |
| 2026-10-20 | **Idempotency stores must claim keys atomically** (Redis `SET NX`, a database unique constraint) | A test caught the in-memory store letting two identical requests both run; fixed |
