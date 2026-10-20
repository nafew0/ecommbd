# Vendure vs Medusa: checkout benchmark

> Run on 2026-10-20 · Decides the one-time fork in [docs/architecture.md](../docs/architecture.md), Decision 1

## Verdict

**Fork Vendure.**

- **Faster for one shopper:** checkout p95 is **2.4× lower** (131 ms vs 313 ms).
- **Much faster at ten shoppers at once:** checkout p95 is **4.3× lower** (587 ms vs 2,526 ms).
- **More orders per second:** about **5× higher** throughput (21.8 vs 4.4 checkouts/s).
- **Less memory under load:** peak is **less than half** of Medusa's (517 MB vs 1,201 MB).

Medusa needed at least 20% lower checkout p95 and lower memory to win. It was worse on both.

## Results

Mean of two runs per engine, run alternately (Vendure, Medusa, Vendure, Medusa).

| | Vendure | Medusa | Medusa ÷ Vendure |
|---|---|---|---|
| Boot to healthy | 1.4 s | 2.5 s | 1.7× |
| Memory idle | 337 MB | 336 MB | 1.0× |
| Memory peak under load | 517 MB | 1,201 MB | 2.3× |
| Memory 10 s after load | 192 MB | 728 MB | 3.8× |
| Checkout p50, 1 shopper | 115 ms | 291 ms | 2.5× |
| Checkout p95, 1 shopper | 131 ms | 313 ms | 2.4× |
| Checkout p50, 10 shoppers | 447 ms | 2,284 ms | 5.1× |
| Checkout p95, 10 shoppers | 587 ms | 2,526 ms | 4.3× |
| Throughput, 10 shoppers | 21.8 checkouts/s | 4.4 checkouts/s | 0.20× |
| Failed checkouts | 0 | 0 | |

### Per step, p95

| Step | Vendure, 1 shopper | Medusa, 1 shopper | Vendure, 10 shoppers | Medusa, 10 shoppers |
|---|---|---|---|---|
| View product | 7 ms | 7 ms | 33 ms | 77 ms |
| Add to cart | 26 ms | 42 ms | 100 ms | 318 ms |
| Contact + address | 23 ms | 59 ms | 71 ms | 507 ms |
| Shipping options | 5 ms | 19 ms | 29 ms | 137 ms |
| Choose shipping | 20 ms | 87 ms | 65 ms | 657 ms |
| Payment | 30 ms | 29 ms | 98 ms | 222 ms |
| Place order | 31 ms | 88 ms | 281 ms | 748 ms |
| **Whole checkout** | **131 ms** | **313 ms** | **587 ms** | **2,526 ms** |

### Run-to-run spread (checkout p95, 10 shoppers)

| Engine | Run 1 | Run 2 |
|---|---|---|
| Vendure | 551 ms | 624 ms |
| Medusa | 2,617 ms | 2,434 ms |

## What these numbers say

- **Product pages cost the same with one shopper.** Every step that writes to the cart costs Medusa 2–4× more. It runs each one as a workflow with Redis locks and events; Vendure runs a direct database transaction.
- **The gap widens under load.** With ten shoppers at once, Medusa's cart writes queue up: choosing shipping goes from 87 ms to 657 ms. Vendure's go from 20 ms to 65 ms.
- **Medusa holds on to memory.** After load, Vendure dropped back to ~190 MB both times. Medusa stayed at 404 MB after run 1 and 1,053 MB after run 2. With about 50 stores per 32 GB server, peaks like that add up.
- **Idle memory is higher than Vendure's docs say.** Vendure measured 305–368 MB idle here, against the documented 200–300 MB. The architecture's ~400 MB per store (core + storefront) is tight. Trimming unused packages in the fork is the lever.

## Setup

| | |
|---|---|
| Machine | Apple M4, 10 cores, 16 GB RAM, macOS; Node.js 24.16.0 |
| Database | PostgreSQL 17.11 in Docker; separate databases `vendure` and `medusa` |
| Redis | Redis 7.4.11 in Docker; Vendure on db 0, Medusa on db 1 |
| Vendure 3.8.0 | Production build (`tsc`), `NODE_ENV=production`. BullMQ job queue on Redis, Redis cache plugin, default search, scheduler, asset server. Job worker in the same process. No dashboard, GraphiQL or email plugin. |
| Medusa 2.21.2 | Production build (`medusa build`), `NODE_ENV=production`. Redis for caching (with `MEDUSA_FF_CACHING=true`), event bus, workflow engine and locking, as in Medusa's deployment guide. `workerMode: shared`. Admin disabled. |
| Sample data | Each engine's own standard demo data: Vendure's `@vendure/create` catalogue, Medusa's starter seed. Stock raised to 1,000,000 on the variant used, matching Medusa's seed. |

**The checkout:** the same guest flow on both, through each engine's own store API, with a new shopper and cart every time.

1. View product
2. Add to cart
3. Set contact and shipping address
4. List shipping options
5. Choose shipping
6. Start payment
7. Place order

- Vendure uses its GraphQL Shop API and requests only the fields used.
- Medusa uses its REST Store API, with `fields=` to trim responses where the API allows it.
- Payments use each engine's built-in test provider.

**Load:** each run has 30 warm-up checkouts (not counted), then 200 checkouts with 1 shopper, then 500 with 10 shoppers at once. Memory is the RSS of the server's whole process tree, sampled every 250 ms. Both engines ran as a single process.

## Caveats

- **Local, not on CloudPanel.** Absolute timings will differ on your servers. Both engines shared the same hardware, database and Redis, so the ratios should carry over.
- **Out-of-the-box sample data.** Each engine used its own demo catalogue (Vendure 54 products, Medusa 4). Checkout touches one product, so this hardly affects checkout timings.
- **Both engines were tuned per their own production docs.** Neither had custom tuning beyond that, and connection pools were left at their defaults.

## Reproduce

```
docker compose up -d                          # Postgres :55432, Redis :56379
cd vendure && npm install && npx tsc -p . && NODE_ENV=production node dist/populate.js && cd ..
cd medusa && npm install && npx medusa db:migrate && npm run seed && npx medusa build \
  && cp .env .medusa/server/ && (cd .medusa/server && npm install --omit=dev) && cd ..
node runner/bench.mjs vendure run1 && node runner/bench.mjs medusa run1
node runner/report.mjs                        # comparison tables from results/*.json
```

Raw results and server logs are in `results/`.
