# M6 · Platform operations

> Phases 23–29 · [Roadmap overview](README.md)
> **Exit criteria:** on a real CloudPanel server, one command creates a store and one command updates every store; backups restore within target; alerts fire within 2 minutes; and capacity, load and edge decisions are made with real numbers.

This milestone is what turns the product into a **service**: the thing that lets us promise "you never touch a server". It can run in parallel with M2–M5 after phase 01, because it touches different files (`infra/`, `apps/agent/`, `apps/central/`).

---

## Phase 23 — Server baseline

| | |
|---|---|
| Milestone | M6 |
| Delivers | Platform security and reliability for every server (P0) |
| Depends on | 01 |
| Size | L |
| Needs | A staging CloudPanel server; the domain and a DNS host with an API (lead-time items) |

**Goal.** Any fresh CloudPanel server becomes production-ready, hardened and identical to the others by running one playbook, and running it again changes nothing.

### Decide at start

- **Tooling:** Ansible (recommended, because it's idempotent, has check mode and is widely known) or plain shell scripts.
- **Operating system:** the CloudPanel-supported Ubuntu or Debian LTS version, pinned. Upgrades are deliberate.
- **Ports:** pick ports for Varnish, `redis-queue` and `redis-cache` that don't clash with CloudPanel's own services (CloudPanel uses Varnish for PHP sites too).

### Build (`infra/ansible/`)

1. **Base role:**
   - pinned packages, UTC system time with time sync, locale, swap
   - kernel limits: file descriptors, `somaxconn`
   - automatic security updates with controlled reboot windows (Dhaka night)
   - journald size limits, log rotation
2. **Access and firewall:**
   - **SSH:** key-only, no root password login, named admin users, fail2ban.
   - **Firewall:** only 80/443 open to the world; SSH restricted where possible.
   - **CloudPanel's admin port (8443):** restricted to admin IPs or a VPN, with CloudPanel 2FA required.
3. **PostgreSQL:**
   - official repository, pinned major version
   - listening on localhost only, SCRAM authentication
   - tuning computed from server RAM (architecture Decision 4)
   - `pg_hba.conf` managed so each store's role reaches only its own database (entries written by phase 24)
4. **pgBackRest:** installed and configured; the schedule and off-site repository arrive in phase 27.
5. **Redis:**
   - **`redis-queue`:** `noeviction`, append-only file on.
   - **`redis-cache`:** `allkeys-lru`, no persistence, memory cap.
   - Both as their own systemd services, localhost only.
   - The ACL default user is disabled, and dangerous commands (`FLUSHALL`, `FLUSHDB`, `CONFIG`, `KEYS`, `DEBUG`) are denied to store users.
6. **Varnish:**
   - with the `xkey` module (varnish-modules), our VCL from `infra/varnish/` (phase 17), and a memory size from the server's RAM
   - admin interface on localhost only
   - **Nginx in front:** SSL, Brotli and static images go straight to disk; HTML goes through Varnish.
7. **Node.js:** a pinned LTS version, plus PM2 with per-user systemd startup.
8. **Layout and limits:**
   - `/opt/ecommbd/releases/` and the agent's directories, with correct ownership and permissions
   - **Memory protection:** PostgreSQL and Redis get protective OOM priorities, so under memory pressure a store's Node process is killed (and restarted) before the database is.
9. **Monitoring exporters** installed now (node, PostgreSQL, Redis, Varnish), listening locally; phase 28 collects them.
10. **Secrets** in Ansible Vault; no secret ever lands in the repo.
11. **Staging setup:** the wildcard domain `*.staging.ecomm.bd` with a **wildcard certificate via DNS-01** (needs the DNS host's API).
12. **CI:** `ansible-lint` and a syntax check on every pull request touching `infra/`.

### Edge cases

- **CloudPanel updates** rewrite its Nginx configuration: our changes go only through supported vhost customizations or include files, never by editing generated files. Verify after a CloudPanel update.
- **Port collisions** with CloudPanel's services: the playbook checks before binding.
- **Server sizes:** RAM-based tuning works from 8 GB (staging) to 64 GB.
- **Disk layout:** a separate volume for PostgreSQL data when available.
- **A partial run** (network drop): the next run completes it, because every task is idempotent.
- **Security updates needing a reboot:** done in the night window, one server at a time, with the store health check after each.

### Security

- A subset of the CIS benchmark, written down: services minimized, everything bound to localhost unless public, SSH hardened, automatic security patches.
- CloudPanel's admin panel is never publicly reachable.
- Redis ACLs deny dangerous commands; PostgreSQL store roles have no superuser, `CREATEDB` or `CREATEROLE`.
- An external port scan in CI or the runbook shows only 22 (if allowed), 80 and 443.

### Tests

- A full run on a fresh staging server, then a **second run reporting zero changes**.
- An external port scan (documented).
- Simulated memory pressure: PostgreSQL survives and the Node process is restarted.

### Done when

- [ ] A fresh server reaches baseline with one command, in under 30 minutes.
- [ ] Re-running reports zero changes.
- [ ] An external scan shows only the expected ports, and CloudPanel's admin port isn't public.
- [ ] `*.staging.ecomm.bd` serves HTTPS with the wildcard certificate.

### Not in this phase

Creating stores (24), backups schedule and off-site storage (27), log and metric collection (28).

---

## Phase 24 — Store provisioning and lifecycle

| | |
|---|---|
| Milestone | M6 |
| Delivers | Create store, free subdomain, custom domain with SSL (P0, done by us for the pilot) |
| Depends on | 02, 23 |
| Size | L |

**Goal.** Create, suspend, resume, rename and delete stores safely with one command each, with clean rollback on any failure.

### Decide at start

- **CloudPanel site type** for a store: Node.js site or reverse proxy. Pick whichever gives us control of upstream ports, Nginx includes and SSL, and document the exact `clpctl` commands.
- **Retention before final deletion:** recommended 30 days, with a final export.
- **Reserved slugs list:** `www`, `api`, `admin`, `mail`, `staging`, `status`, `help`, `ecomm`, brand and payment names (`bkash`, `nagad`…), offensive words in Bangla and English.

### Build (`apps/agent` CLI, run on the server; phase 25 automates it)

1. **`ecommbd-store create --slug <slug> [--domain <domain>]`:**
   1. Validate the slug (letters, digits, hyphens; length; reserved and offensive lists; homoglyphs) and the domain format, including international domain names converted to punycode.
   2. Check capacity: free memory and disk above thresholds, otherwise refuse.
   3. Allocate ports for the core and storefront.
   4. Create the CloudPanel site and the Linux user (`clpctl`), and the directories (`files/`, `logs/`, `env/`).
   5. **PostgreSQL:** a role with a random 256-bit password, `CONNECTION LIMIT`, no special privileges, its own database, and a `pg_hba` entry.
   6. **Redis:** one ACL user each on `redis-queue` and `redis-cache`, limited to the key pattern `s<storeId>:*` with dangerous commands denied.
   7. **Varnish:** add the backend and reload the VCL.
   8. **Env file** (mode 0600, owned by the store user) with generated secrets: cookie secret, the store's encryption key, and a random superadmin password that's never used day to day.
   9. **PM2 setup** for the core and storefront, pointing at the current release.
   10. **Migrations**, then the BD defaults initializer (phase 02).
   11. **Owner account:** an invite link with a single-use token (24-hour expiry); the owner sets their own password.
   12. **SSL:** platform subdomains use the wildcard certificate; custom domains get a Let's Encrypt certificate once DNS points (HTTP-01), retried automatically.
   13. **Health check**, then record the store in the server's state file (and in central once phase 25 exists).
2. **Transactional:** every step records how to undo itself. On failure, completed steps roll back in reverse order and the log says exactly what happened. Re-running after a fix resumes.
3. **Locking:** one operation per store at a time.
4. **Lifecycle commands:**
   - **`suspend`:** the storefront shows the suspended page (phase 12) with a 503; the Dashboard is limited to billing and export.
   - **`resume`**
   - **`domain add|remove|primary`:** apex and www handling, with a redirect to the primary.
   - **`rotate-secrets`:** re-encrypts stored credentials with a new key version.
   - **`delete`:** final export, then a retention period, then removal of the database, Redis keys, files, users, site and certificates, recorded and confirmed.
5. **Runbook:** `docs/runbooks/store-lifecycle.md`.

### Edge cases

- **Domains:**
  - The domain already exists in CloudPanel, or belongs to another store: refuse with a clear message.
  - **DNS not yet pointing** at us: the store runs on its platform subdomain, and custom-domain SSL retries in the background.
  - **Let's Encrypt rate limits** (certificates per registered domain per week): avoided for platform subdomains by the wildcard certificate; custom domains are spaced out.
  - **Apex vs www:** both work, one redirects to the other.
- **Capacity:** port exhaustion, disk or memory full: refuse before starting, never half-create.
- **Deletion and slug reuse:**
  - Deletion while a backup runs: wait for the lock.
  - Re-creating a deleted store's slug during its retention period: refused, so the old data can still be restored.
- **Failure at every step:** covered by tests that inject a failure at each step and check the rollback.

### Security

- Secrets are generated with a cryptographic random source, stored only in the env file (0600) and in central's encrypted store (phase 25).
- Store database roles can't create databases or roles; Redis users are limited to their key prefix.
- Each store runs as its own Linux user and can't read other stores' files.
- **Owner invites:** single-use and time-limited; tokens are stored hashed.
- **Deletion** requires typing the slug, and in production a second operator's approval (enforced in phase 25).
- Every lifecycle action is recorded.

### Tests

- On staging: create → health → suspend → resume → add custom domain → rotate secrets → delete, all passing.
- Failure injection at every create step, with rollback verified (no leftover users, databases, ACLs or sites).
- Concurrency: two operations on the same store are refused by the lock.
- Two stores on one server can't reach each other's database, Redis keys or files (isolation test).

### Done when

- [ ] `create` brings up a working store with HTTPS on `{slug}.staging.ecomm.bd` in **under 2 minutes**.
- [ ] Failures roll back cleanly at every step.
- [ ] `delete` leaves no trace after the retention period.
- [ ] The isolation test passes.

### Not in this phase

Automation from central (25), self-serve signup (40), moving a store between servers (50).

---

## Phase 25 — Central system foundation

| | |
|---|---|
| Milestone | M6 |
| Delivers | The registry of servers and stores, secure staff access, and store ↔ central communication |
| Depends on | 24 |
| Size | L |

**Goal.** One secure place that knows every server and store and their health, lets our team act on them through audited actions, and gives stores what they need from the platform, without ever becoming a single point of failure for shoppers.

### Decide at start

- **Stack:** NestJS + TypeORM + PostgreSQL (same patterns as Vendure, which is recommended) or Fastify + Drizzle, plus a React admin UI. Record it in an ADR.
- **Store-to-central authentication:** HMAC-signed requests with per-store credentials (recommended), or mutual TLS.
- **Hosting:** its own small server, never on a store server. Backups and monitoring as for stores.

### Build (`apps/central`)

1. **Staff authentication:**
   - email and password plus **mandatory TOTP two-factor** (WebAuthn optional)
   - session management and an optional IP allowlist
   - roles: owner, admin, support, finance, viewer
2. **Audit log:** append-only, records every action with who, what, when, from where and the result. No role can delete entries.
3. **Registry:**
   - **Servers:** capacity, versions, health, agent status.
   - **Stores:** slug, domains, server, release version, plan, status (provisioning, active, suspended, deleting, deleted) and owner contact.
4. **Store API** (stores call central, with signed requests):
   - **heartbeat:** version, health, queue depth, error rate
   - **entitlements:** licence and feature flags, which stores cache and keep using for 7 days if central is unreachable
   - **usage reports** (for billing in phase 39)
   - later: SMS sending and fraud scores (phase 38)
5. **No inbound calls to stores.** Central acts on servers only through agents (phase 26), and stores pull from central.
6. **Two-person rule** for destructive production actions (store deletion, data restore over live data): one staff member requests, another approves.
7. **Admin UI:** server and store lists with health, store detail, the audit log, and (after phase 26) lifecycle and release actions.

### Edge cases

- **Central is down:** stores keep selling. Entitlements are cached, usage reports queue in the store's outbox, and SMS and fraud scores degrade as phase 38 designs.
- **Clock skew** between servers: signed requests allow ±5 minutes; larger skew is alerted.
- **Credential rotation** with no downtime: two valid keys during the overlap.
- **API versions:** stores on different releases call the same central API, which is versioned, and old versions stay supported for at least two releases.
- **Duplicate or replayed registrations:** idempotent registration with nonces.

### Security

This is the most sensitive system we run:

- **Access:** mandatory 2FA, least-privilege roles, and the admin UI behind a VPN or IP allowlist.
- **Data:** secrets in an encrypted store (the master key outside the database), minimal personal data (store owner contact only, never shopper data), separate database credentials, encrypted backups.
- **Abuse protection:** rate limits on every endpoint; signed store requests reject replays (nonce cache).
- **Monitoring:** login alerts for staff accounts, and the audit log is reviewed weekly.

### Tests

- **API auth:** a replayed request, a skewed timestamp, the wrong store's credentials and a tampered body are all rejected.
- **Roles:** every staff role × action allowed or denied as designed.
- **Audit completeness:** every action produces exactly one audit entry.
- **End-to-end:** staging stores report heartbeats and appear healthy in the registry.

### Done when

- [ ] Staging stores appear in central with live health.
- [ ] Staff log in only with 2FA; every action appears in the audit log.
- [ ] With central stopped, the stores keep taking orders, and they catch up when it returns.

### Not in this phase

Releases (26), backup control (27), dashboards and alerts (28), billing (39), SMS and fraud network (38).

---

## Phase 26 — Deploy agent and release pipeline

| | |
|---|---|
| Milestone | M6 |
| Delivers | "One command rolls a release to every store; a store that fails its health check rolls back automatically" (success criterion) |
| Depends on | 24, 25 |
| Size | L |

**Goal.** Shipping a release to every store is one button in central: in waves, with zero downtime and automatic rollback.

### Decide at start

- **Artifact signing:** minisign or cosign with an Ed25519 key; the private key lives only in CI secrets or an offline vault.
- **Artifact storage:** GitHub Releases (the code is public anyway) or private object storage. The signature is what matters.
- **Maintenance window** for routine releases: recommended 02:00–05:00 Dhaka. Security hotfixes can go any time.

### Build

1. **Release workflow (CI)**, on a version tag `vX.Y.Z`:
   - build the core, Dashboard and storefront
   - production dependencies installed (`npm ci --omit=dev`)
   - a tarball with a **manifest**: version, commit, migration list, checksums, minimum agent version
   - signed, then uploaded
   - release notes generated from the CHANGELOG
2. **Agent** (`apps/agent`, a Node service under systemd on each server):
   - **Runs as `ecommbd-agent`**, with a **sudoers allowlist** for exactly the commands it needs (the `clpctl` subset, PM2 as store users, PostgreSQL admin tasks for provisioning).
   - **Pulls work from central** (outbound long-poll; no inbound port).
   - **Runs only predefined actions** with typed parameters (provision, release, rollback, suspend…). There is **no arbitrary shell command** action.
   - **Reports** progress and logs back to central.
   - **Updates itself** through the same signed-artifact path.
3. **Rollout engine** (central):
   - **Waves:** internal test stores → 10% canary → everyone else, with a pause between waves and automatic halt if the failure rate passes a threshold.
   - **Per store:**
     - pre-checks (disk space, current health)
     - a `pg_dump` of the store
     - **download and verify** the artifact (cached once per server)
     - run migrations with `lock_timeout` and `statement_timeout` set
     - switch the store's release symlink, then `pm2 reload` (zero downtime: new processes start before old ones stop)
     - **health check:** HTTP 200 on key pages, a Shop API query, the job queue alive, version reported
   - **On failure:** switch back to the previous release and reload. Backward-compatible migrations mean the old code works with the new schema. Then alert.
4. **Rollback command** for an entire release (to the previous version, store by store).
5. **"What's new"** in the merchant Dashboard: merchant-facing release notes, in Bangla and English.
6. **CI check against breaking migrations:** fails if a migration drops or renames a column or table that the previous release still uses. This is the expand/contract rule from the README, enforced automatically.

### Edge cases

- **Infrastructure trouble:**
  - **The agent is offline:** that server's stores stay on the old version and retry when it returns.
  - **Corrupted or unsigned artifact:** refused by checksum or signature.
  - **Disk full:** the pre-check refuses the store before touching it.
- **Migrations:**
  - **A long migration on a big store:** timeouts stop it from locking tables for minutes. Heavy data changes run as background jobs after the release, not inside migrations.
  - **The migration succeeds but the health check fails:** roll back the code; the schema stays expanded, and the next release fixes forward.
- **Traffic during a reload:** PM2 waits for the new process to be ready before stopping the old one, so no request is dropped.
- **Version skew between core and storefront:** impossible by design. Both switch together per store.
- **Two rollouts at once:** a global lock refuses the second.
- **The agent restarts mid-rollout:** it resumes from central's record of each store's state.

### Security

- Artifacts are verified against a pinned public key before anything runs.
- The agent authenticates to central with its own rotating credential, can only run allowlisted actions, and its sudo rights are minimal.
- Builds happen only in CI from a tagged commit, never on a laptop.
- Every release action is in central's audit log.

### Tests

On staging with 5 test stores:

- release v0.1 → v0.2
- a deliberately failing health check on one store (it rolls back automatically and alerts)
- a whole-release rollback
- an agent restart mid-rollout
- a corrupted artifact (refused)
- the breaking-migration check catching a column drop

### Done when

- [ ] Releasing v0.2.0 from central upgrades all staging stores with zero downtime (a request loop during the release sees no errors).
- [ ] A store with a failing health check rolls back automatically and alerts.
- [ ] A bad artifact is refused.

### Not in this phase

Moving stores between servers (50), canary-by-plan targeting (later).

---

## Phase 27 — Backups, restore drills and merchant data export

| | |
|---|---|
| Milestone | M6 |
| Delivers | Backups (P0); merchant data export (P1, built now because it shares the tooling) |
| Depends on | 23, 24, 25 |
| Size | L |
| Needs | Off-site S3-compatible storage at another provider, with object lock (lead-time item) |

**Goal.** No data is ever lost, restores are proven every month, and merchants can take all their data whenever they like.

### Decide at start

- **Targets:** recovery point **≤ 5 minutes** of data loss (from continuous WAL archiving) and recovery time **≤ 1 hour** for a single store.
- **Off-site provider and region**, separate from the store servers' provider.
- **Key custody:** backup encryption keys stored in central's secret store, plus an offline escrow held by two people.

### Build

1. **pgBackRest per server:**
   - weekly full and daily differential backups
   - **continuous WAL archiving**
   - repository on off-site S3-compatible storage with **object lock** (immutable for the retention period, which protects against ransomware), encrypted
   - 30-day retention, with monthly backups kept 6 months if you choose
2. **Per-store nightly `pg_dump`** (custom format), encrypted, off-site: for single-store restores and exports without touching the whole server.
3. **Files backup:** restic (encrypted, deduplicated) of every store's original images and uploads, off-site, daily, 30 days. WebP sizes aren't backed up; they're regenerated.
4. **Restore tooling:**
   - **`restore-store --store <id> --to <timestamp>`** (a single store to any minute):
     1. Restore the server backup to that minute into a temporary PostgreSQL instance.
     2. Dump just that store's database from it.
     3. Restore it into a new database, side by side.
     4. Verify, then switch (with phase 25's two-person approval) or keep it for inspection.
   - **`restore-server`** for disaster recovery onto a new server.
   - **Files restore** for a single store or a single path.
5. **Monthly automated restore drill:** a random store is restored to a temporary location; checks confirm the counts and the latest order and its timestamp; the result goes to central and alerts on failure.
6. **Monitoring:** backup success, WAL archive lag, repository size, and drill results feed phase 28's alerts.
7. **Merchant data export** (Dashboard "Export my data", owner only):
   - **Contents:** a zip with CSV files (products, variants, customers, orders, order lines, payments, shipments), a full JSON export, original images, and a **WooCommerce-compatible product CSV**.
   - **Generation:** built by a background job.
   - **Download:** through a **signed link that expires in 24 hours** and needs re-authentication (password + 2FA from phase 32), at most once per day.
   - **Recorded** in the activity log.

### Edge cases

- **Backup timing:**
  - A backup during a release or migration: per-store dumps take a consistent snapshot; WAL archiving is unaffected.
  - Large stores: dumps run in parallel and are compressed; their time is measured, with an alert when it grows.
- **Silent failures:**
  - WAL archiving stops silently: an alert fires on archive lag over 15 minutes.
  - The off-site provider is down: archive files queue locally (with disk alerts), and an optional secondary target exists.
- **Accidental deletion:** a merchant deletes all their products by mistake. The single-store restore to a minute before, side by side, lets us copy back just what's needed.
- **Exports:**
  - **CSV injection:** cells starting with `=`, `+`, `-`, `@` or a tab are prefixed.
  - **Excel showing Bangla as garbage:** files are UTF-8 **with BOM**.
  - **Very large exports:** streamed and chunked, never built in memory.
- **Lost encryption key:** prevented by the two-custodian escrow and tested by a key recovery drill.

### Security

- Encryption at rest and in transit for every backup.
- Backup credentials are append-only or write-only where the provider allows it. Object lock stops deletion during retention.
- Restores over live data need two-person approval and are recorded.
- Export links are single-use and expiring, owner-only, and recorded.

### Tests

- **Point-in-time restore:** delete data on staging, then restore the single store to the minute before. The data is back and nothing else is touched.
- **Disaster recovery:** restore a whole staging server onto a fresh one, checking RTO.
- **The drill job** runs green.
- **Export:** opens in Excel with Bangla intact; the CSV injection test cell is neutralized; the WooCommerce CSV imports into a test WooCommerce.

### Done when

- [ ] Staging proves a recovery point ≤ 5 minutes and single-store recovery time ≤ 1 hour.
- [ ] The monthly drill job is green and reports to central.
- [ ] A merchant export downloads, opens correctly in Excel and re-imports into WooCommerce.

### Not in this phase

Multi-region disaster recovery (50), customer-level data deletion tools (34).

---

## Phase 28 — Observability, alerting and uptime

| | |
|---|---|
| Milestone | M6 |
| Delivers | Uptime (P0); "we see problems before merchants do" |
| Depends on | 23, 25 |
| Size | M |
| Needs | A small VPS inside Bangladesh for probes (lead-time item) |

**Goal.** Every failure that matters (a store down, checkout errors, a stuck queue, an expiring certificate, a failing backup) alerts the right person within 2 minutes, with enough context to act.

### Decide at start

- **Stack:** self-hosted Prometheus + Grafana + Loki (logs) + an error tracker (GlitchTip or self-hosted Sentry) on a monitoring server, or managed services. Weigh cost against data control.
- **Alert channels:** Telegram or Slack for warnings; SMS or a phone call for critical alerts at night.

### Build

1. **Logs:**
   - JSON from every core, storefront and agent process, each with store ID, request ID and release version
   - personal data redacted at the source
   - shipped to Loki (or chosen tool), retained 30 days
2. **Metrics:**
   - **Server exporters** from phase 23: node, PostgreSQL, Redis, Varnish.
   - **App metrics** per store on a local-only endpoint:
     - HTTP latency histograms by route type, Shop API errors
     - **checkout funnel counts**
     - job queue depth and failures, **outbox lag**
     - external API error rates per provider (gateways, couriers, Meta, SMS)
     - Varnish hit ratio, cache purge failures
3. **Errors:** the error tracker gets release tags, source maps and personal-data scrubbing, for core, storefront, agent and central.
4. **Uptime checks** per store, run from **inside Bangladesh** (the probe VPS) and from outside:
   - home page, a product page, `/health`, a Shop API query
   - a checkout dry run that validates without placing an order
5. **Alert rules**, at minimum:
   - store down (2 failed probes), 5xx rate spike, **checkout error spike**
   - queue backlog or outbox lag over its threshold
   - disk over 80%, memory pressure, Node process restart loops
   - **WAL archive lag**, backup failure, restore drill failure
   - **certificate expiring in under 14 days**
   - gateway, courier, Meta or SMS error spikes per store
   - SMS credits low (from phase 38)
   - central unreachable
   - **Dead man's switch:** the monitoring system's own heartbeat goes to an external service, so a monitoring outage is noticed.
6. **Grouping and silencing:** related alerts are grouped and a server-down alert suppresses its stores' alerts, so one incident means one notification.
7. **Dashboards:**
   - platform overview, per server, per store
   - **checkout health**
   - external providers
   - all times shown in Dhaka time
8. **Public status page** (`status.ecomm.bd`): platform-wide incidents and scheduled maintenance.
9. **Central:** store health shown as a traffic light, with links into the dashboards.
10. **On-call runbook:** `docs/runbooks/on-call.md`, with first steps for each alert.

### Edge cases

- **Alert storms** during a server outage: grouping and suppression keep it to one notification.
- **Personal data in logs or errors:** scrubbing at the source, plus a test that greps sample logs for phone patterns.
- **Bot traffic skewing metrics:** known bots are labelled and excluded from the funnel.
- **The monitoring server itself fails:** caught by the dead man's switch.
- **Probes from Bangladesh fail** because of the probe's own network: alert only when both vantage points agree, or label the alert "BD network".

### Security

- Metrics and logs endpoints are never public. Dashboards sit behind login with 2FA.
- Access to logs is recorded; retention limits are enforced.
- The status page shows no store names or customer data.

### Tests

**Fire drills on staging**, each alerting within 2 minutes with the store and cause:

- kill a store's processes
- fill the disk past 80%
- stop WAL archiving
- break a gateway's mock
- stop the monitoring server

A test also checks that no full phone number appears in logs.

### Done when

- [ ] Every fire drill alerts the on-call channel within 2 minutes with the store and cause.
- [ ] Dashboards show per-store latency, checkout success and queue health in Dhaka time.
- [ ] The status page is live; the dead man's switch works.

### Not in this phase

Merchant-facing reports (41), long-term analytics storage (later).

---

## Phase 29 — Real-server validation: capacity, load, chaos and the BD edge test

| | |
|---|---|
| Milestone | M6 |
| Delivers | The speed success criterion on real hardware; architecture decisions 6 and 7; the rest of the spike checklist |
| Depends on | 17, 23, 24, 26, 28 |
| Size | M |

**Goal.** Prove the numbers on real servers and real Bangladeshi networks, and settle the open infrastructure decisions with data instead of guesses.

### Build

1. **Remaining spike checklist** (architecture.md) on staging: footprint, Shop API speed, phone checkout, BD order flow, partial payment, integrations, upgrade time. Record every result.
2. **Density test:** 50 stores on a 32 GB server with realistic catalogues and an idle-plus-traffic mix. It measures memory, CPU and PostgreSQL connections and decides:
   - **worker inside the core process vs a separate worker** (architecture Decision 7)
   - per-store connection pool size
   - whether PgBouncer is needed now
   - the final stores-per-server number for capacity planning in central
3. **Load test (k6), modelled on Eid traffic:**
   - **Scenarios:** browsing (Varnish hits and misses), search, add to cart, and checkout, at an Eid-like peak:
     - one store at 10× its normal traffic (for example 20 checkouts per second)
     - with admin activity (confirmations, bulk booking) running at the same time
   - **Output:** find and fix bottlenecks, and record the limits.
4. **Chaos tests** (each must degrade gracefully, never lose an order):
   - `redis-cache` stopped: slower, but working
   - `redis-queue` stopped: orders are still placed thanks to the outbox, and jobs resume afterwards
   - PostgreSQL restarted: connections recover
   - Varnish restarted: the warm-up job refills the cache
   - a store's disk full: alert, and other stores unaffected
   - network to a gateway or courier lost: circuit breakers trip and checkout still works
5. **The BD edge test** (architecture Decision 6):
   - **Measurements:** TTFB and LCP for the same test store from **Grameenphone, Robi and Banglalink mobile data** and 2–3 broadband ISPs, at different times of day.
   - **Options compared:**
     - A: origin in a Bangladesh data center on BDIX
     - B: Cloudflare in front
     - C: origin in Singapore
     - plus combinations, where useful
   - **Decide the default** and configure it.
6. **ADRs** with the measured data, and updates to architecture.md (capacity, decisions 6 and 7).

### Edge cases

- **Measurement noise:** repeat each run, report percentiles, and test at peak hours (evenings in Bangladesh).
- **Realistic data:** Bangla content, real image sizes, a few large catalogues mixed in.
- **Mobile network variance:** the same test at different times and locations where possible.

### Security

- Load and chaos tests run only on staging with synthetic data; no real customer data.

### Done when

- [ ] Decisions are recorded with data: per-store memory, stores per server, worker placement, PgBouncer, and the edge option.
- [ ] The Eid-peak load test passes without errors at the documented limits.
- [ ] Every chaos test shows graceful degradation and zero lost orders.
- [ ] The storefront speed criterion (LCP p75 ≤ 1.5 s on mobile) is met from Bangladeshi networks.

### Not in this phase

Scale-out automation across many servers (50).
