# Stores on a CloudPanel server (`ecommbd-stores`)

Support adds a store from CloudPanel's web interface alone: a Node.js site with an App Port from **4301 to 4399**. Within a minute the server sets it up: its database, settings, services and a login file. An admin with root access installs this once per server and runs updates.

It's a small, early version of roadmap phase 24 (create a store with one command), triggered by CloudPanel instead of a command. The code is in [`ops/cloudpanel/`](../../ops/cloudpanel/).

> **host2.ecomm.bd** (103.28.121.67, Ubuntu 24.04, 8 cores, 8 GB, CloudPanel 2 with 9 WooCommerce sites): set up on 2026-10-23 and tested with **store1.ecomm.bd** (`setup`, a store created by the timer, `scan`, `status`, `retry`, `deploy`, `rollback`). Deleting a store hasn't been tried yet. store1 shows the Baijid Veshoj Vander demo store (copied from a developer's local `ecommbd_demo` on 2026-10-23, with a "Photo credits" page for the Wikimedia category photos); its empty database from before is in `/var/backups/ecommbd/ecommstore1/`. It deploys `main` from GitHub with a read-only deploy key titled "host2 ecommbd".

## How it works

| What | Where |
|---|---|
| A store | A CloudPanel **Node.js site** whose App Port is 4301–4399. Other sites (PHP, WordPress) are never touched |
| Finding new stores | `ecommbd-stores sync`, every minute (`ecommbd-stores-sync.timer`), reads the vhosts CloudPanel writes in `/etc/nginx/sites-enabled/` |
| Ports | Storefront on the App Port; core on the App Port − 1000 (store1: 4321 and 3321). The storefront passes `/admin`, `/shop-api`, `/dashboard` and the core's other paths to the core, so CloudPanel's vhost needs no change |
| Code | One shared build for all stores, `/opt/ecommbd/current` → `/opt/ecommbd/releases/<date>-<commit>`, owned by the `ecommbd` user. Node is its own copy in `/opt/ecommbd/node` |
| Services, per store | `ecommbd-core@<site user>`, `ecommbd-worker@<site user>`, `ecommbd-storefront@<site user>`, running as the site user, restarted if they crash and after a reboot |
| Services, per server | `ecommbd-redis@queue` (port 63790, never evicts) and `ecommbd-redis@cache` (63791), separate from any Redis the other sites use. PostgreSQL 17 on 127.0.0.1:5432 |
| A store's settings | `/etc/ecommbd/stores/<site user>/` (`core.env`, `storefront.env`, `store.conf`), readable by root only |
| A store's files | `/home/<site user>/ecommbd/`: `assets/` (uploads), `images/` (WebP sizes), `ADMIN-LOGIN.txt` |
| Database backups | `/var/backups/ecommbd/<site user>/`, taken before every update (last 10 kept) |
| Server settings | `/etc/ecommbd/ecommbd.conf` |

A new store takes about 20 seconds once found, and uses about 460 MB of memory (core ~250 MB, worker ~160 MB, storefront ~50 MB).

## Adding a store (support, CloudPanel only)

1. **DNS:** an A record for the store's domain pointing at the server (host2: `103.28.121.67`). A wildcard record `*.ecomm.bd` makes this step unnecessary for `ecomm.bd` subdomains.
2. **Sites → + Add Site → Create a Node.js Site:**
   - **Domain Name:** the store's domain, for example `store2.ecomm.bd`
   - **Node.js Version:** Node 24 LTS
   - **App Port:** the next unused number from **4301 to 4399**. Keep the list of used ports in the team's notes (host2: store1.ecomm.bd uses 4321); a site's port is under **Settings → Node.js Settings**. Two stores can't share a port: a new site given a taken port shows the other store and isn't set up. Change its App Port to a free one and it's set up within a minute
   - **Site User:** any name, for example `ecommstore2`; keep the generated password in the password manager
   - **Create**
3. **SSL/TLS → Actions → New Let's Encrypt Certificate → Create and Install.**
4. Wait a minute, then open the site's **File Manager → `ecommbd` → `ADMIN-LOGIN.txt`**. It has the store's addresses and the support team's password. Sign in at `https://<domain>/admin`, give the merchant their own staff account, keep the password in the password manager and delete the file.

If `ADMIN-LOGIN.txt` hasn't appeared after 5 minutes, ask an admin to run `sudo ecommbd-stores status`.

**Don't** edit a store's vhost: CloudPanel's own is exactly what's needed. Changing a store's App Port later works, but restarts the store.

**Deleting a store:** **Delete Site** in CloudPanel. Within a minute its services stop. CloudPanel deletes the site's home folder, so **uploads are gone**; the **database is kept** (and the settings), until an admin removes them. Take what you need first.

## One-time server setup (admin, root)

Run as root (`sudo -i`). Nothing here changes the server's other sites.

**1. PostgreSQL 17**, if the server doesn't have it (CloudPanel doesn't manage PostgreSQL):

```bash
apt update
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-17
```

**2. Redis:** `which redis-server`. WooCommerce servers usually have it already; if not, `apt install -y redis-server`. Don't reinstall it when it's there: that could restart the Redis the sites use. Setup adds two instances of its own.

**3. The build user and the code.** The `ecommbd` user builds and owns the shared code; a read-only deploy key lets it pull from GitHub:

```bash
useradd --system --create-home --home-dir /opt/ecommbd --shell /bin/bash ecommbd
sudo -u ecommbd ssh-keygen -t ed25519 -f /opt/ecommbd/.ssh/id_ed25519 -N '' -C "ecommbd@$(hostname)"
cat /opt/ecommbd/.ssh/id_ed25519.pub
```

Add the printed key on GitHub: **nafew0/ecommbd → Settings → Deploy keys → Add deploy key**, titled with the server's name, **Allow write access** off. Then:

```bash
cd /
sudo -u ecommbd ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # "successfully authenticated"
sudo -u ecommbd git clone git@github.com:nafew0/ecommbd.git /opt/ecommbd/repo
```

**4. Setup:**

```bash
/opt/ecommbd/repo/ops/cloudpanel/ecommbd-stores setup
```

It installs Node, raises PostgreSQL's `max_connections` to 200 (restarting it only while it has no stores), builds `main`, installs the services and `ecommbd-stores` itself, starts the two Redis instances and the timer. About 5 minutes; the build briefly needs about 3.5 GB of free memory. Running it again is safe (it also updates every store).

**5. Check:** `sudo ecommbd-stores status` and `systemctl list-timers 'ecommbd*'`.

### Settings

`/etc/ecommbd/ecommbd.conf` (written by setup; defaults in the script):

| Setting | Default | Meaning |
|---|---|---|
| `REF` | `main` | What `deploy` builds when given nothing |
| `APP_ENV` | `production` | For new stores (`staging` behaves the same) |
| `NODE_VERSION` | `v24.22.1` | Change it, then run `setup` again |
| `PORT_FIRST`, `PORT_LAST` | `4301`, `4399` | App Ports that make a site a store |
| `MIN_FREE_MB` | `1500` | A new store waits (fails, see `retry`) when less memory than this is available |
| `KEEP_RELEASES`, `KEEP_BACKUPS` | `3`, `10` | Old builds and database dumps kept |

## Updates (admin)

```bash
sudo ecommbd-stores deploy            # REF, normally main
sudo ecommbd-stores deploy v0.4.0     # or a branch, tag or commit
```

It builds the new version next to the running one (about 4 minutes, at low priority), switches to it, then for each store: a database dump, a restart (the core runs new migrations), and a health check. Each store is down for about 15 seconds. A failed build changes nothing.

**Going back:** `sudo ecommbd-stores rollback` switches to the previous build and restarts every store. Database changes aren't undone; that's fine because migrations stay backward-compatible (`CLAUDE.md`). To restore a store's data from a dump (store stopped first):

```bash
systemctl stop ecommbd-core@<user> ecommbd-worker@<user> ecommbd-storefront@<user>
sudo -u postgres pg_restore --clean --if-exists -d ecommbd_<user> < /var/backups/ecommbd/<user>/<file>.dump
systemctl start ecommbd-core@<user> ecommbd-worker@<user> ecommbd-storefront@<user>
```

## Commands

All as root (`sudo`):

| Command | What it does |
|---|---|
| `ecommbd-stores status` | Every store: domain, ports, state (`active`, `failed`, `removed`), health, and the reason when something failed |
| `ecommbd-stores scan` | What the next sync would do, without doing it |
| `ecommbd-stores retry <site user>` | Set up a failed store again, keeping its database and secrets |
| `ecommbd-stores deploy [ref]` | Update every store (above) |
| `ecommbd-stores rollback` | The previous build, every store restarted |
| `ecommbd-stores sync` | What the timer runs every minute |
| `ecommbd-stores setup` | One-time setup; safe to run again |

## Troubleshooting

| Symptom | Look at |
|---|---|
| A new store doesn't appear | `ecommbd-stores scan` (is the App Port in range?), then `journalctl -u ecommbd-stores-sync -n 50` |
| `status` says `failed` | The reason under it (memory, a port in use, a database left by a deleted store). Fix it, then `ecommbd-stores retry <site user>`. A store that failed is also tried again by itself when its App Port or domain changes in CloudPanel |
| 502 Bad Gateway | `ecommbd-stores status`, then `journalctl -u ecommbd-core@<site user> -n 100` |
| An update says `NOT answering` | `journalctl -u ecommbd-core@<site user> -n 100`; `ecommbd-stores rollback` if it's the new code |
| A store needs an extra setting (email: `SMTP_*`) | Add it to `/etc/ecommbd/stores/<site user>/core.env`, then `systemctl restart ecommbd-core@<site user> ecommbd-worker@<site user>` |

## Limits, and what comes later

- **Capacity:** about 460 MB per store, plus about 3.5 GB while `deploy` builds. On host2 (8 GB, shared with WooCommerce) that's a handful of stores. PostgreSQL's 200 connections allow about 9.
- **Shared Redis passwords:** every store on a server uses the same two Redis passwords, with its own key prefix. Per-store Redis users come with phase 24.
- **No Varnish yet**, and images go through the storefront and the core instead of Nginx serving them from disk. Fine for a few stores; Nginx routes per store come with phase 24.
- **Backups:** database dumps only before updates. Nightly dumps, off-server copies and backups of `/home/<site user>/ecommbd/` (uploads) are still to do (phase 27).
- **One domain per store**, the site's own. Custom domains for merchants come with phase 24.
- **No email** until a store's `core.env` gets `SMTP_*` settings.
