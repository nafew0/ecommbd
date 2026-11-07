# Ecomm BD Migrator (WordPress helper)

A small WordPress plugin. The merchant installs it on their WooCommerce site. It reads the store and sends a copy to their Ecomm BD store. When the move is done, they remove it.

## What it does

- It reads the store and sends it to **one** Ecomm BD store, the one the merchant confirms.
- It sends: categories, tags, products (with variations, image links and SEO titles), customers (with their password hashes, so they keep their passwords), orders (with notes and refunds), coupons, approved reviews and store settings (currency, shipping zones, permalinks, the Facebook Pixel ID, old page addresses and Redirection plugin rules).
- It works with PHP 7.4 or later, WordPress 5.8 or later and WooCommerce 4.0 or later, with classic or HPOS order storage.
- It speaks English and Bangla. It follows the WordPress admin language.

## What it never does

- It never changes the WordPress store. It only reads.
- It never opens a way in. Ecomm BD cannot call the WordPress site. The helper only sends.
- It never sends anything before the merchant confirms the destination address.
- It never sends:
  - passwords of administrators, shop managers or any account that is more than a customer;
  - plugin settings, payment gateway settings or courier API keys;
  - order, customer or product data whose name looks secret (token, key, password, secret, auth, api…), or private plugin data;
  - image files (only their links).

## Install

1. Build the ZIP from the repository root: `python3 apps/wp-migrator/package.py`. It writes `apps/wp-migrator/dist/ecommbd-migrator.zip`.
2. In WordPress: **Plugins → Add New → Upload Plugin**. Choose the ZIP. Click **Install Now**, then **Activate**.
3. WooCommerce must be active. PHP needs the OpenSSL extension (almost every host has it).
4. On a multisite network, activate it on the one site you are moving.
5. A malware scan before the move is a good idea (see the [cutover runbook](../../docs/runbooks/cutover.md)).

## Pair

1. In the Ecomm BD admin, open the migration page and click **Create one-use pairing**. Copy the pairing details. They work once, for one hour.
2. In WordPress, open **WooCommerce → Move to Ecomm BD** (Bangla: **Ecomm BD-তে নিন**).
3. Paste the details. Click **Check pairing details**. Nothing is sent yet.

## Confirm the destination

- The page now shows, in large letters, the address the data will go to.
- Compare it with the address of the store in the Ecomm BD admin.
- If it is the same, tick **Yes, … is my Ecomm BD store** and click **Confirm and start the upload**.
- If it is different, or someone sent the merchant the pairing text: **stop**. Do not confirm. That text would send the whole store, with customers' password hashes, to someone else.
- The helper checks the confirmed address again before every upload. A connection saved by version 0.1.0 waits on this screen until someone confirms it.

## Watch and continue

- The upload starts at once and then continues in the background (WordPress cron).
- WordPress cron only runs when someone opens the site. Keeping the helper page open helps: it reloads every 30 seconds.
- **Continue now** sends as much as fits in about 20 seconds. Use it when the page shows an error, when nothing moved for 10 minutes, or when the site has WordPress cron switched off (the page says so).
- Network errors are retried by themselves 3 times (after 1, 2 and 3 minutes).
- Retrying is always safe. A part that was cut off is sent again exactly as before. Ecomm BD never imports it twice.
- Speed: one run uses up to half of the host's `max_execution_time` (at most 20 seconds) and stops at 60% of `memory_limit`. Parts start at 25 records and double after fast parts, up to 100.
- Only one upload runs at a time. A second click while one runs says "An upload is running right now".

### Error codes

The page explains each error in the admin language and shows a code for support.

| Code | What it means | What to do |
|---|---|---|
| `NETWORK_OR_TLS` | The site could not reach Ecomm BD securely. | Ask the host, or the security plugin (Wordfence and others), to allow outgoing requests to the Ecomm BD address. |
| `UPLOAD_REFUSED` | Ecomm BD refused the data. | The pairing expired or was revoked. Create new pairing details. |
| `CHECKPOINT_MISMATCH` | Ecomm BD expected a different part. | Remove the saved connection and pair again. |
| `DESTINATION_NOT_CONFIRMED` | Nobody confirmed the address yet. | Confirm it on the page. |
| `PERMISSION_CHANGED` | The person who started can no longer manage WooCommerce. | Pair again as a shop manager or administrator. |
| `INVALID_SECRET` | The saved connection cannot be read (the site's security keys changed). | Remove it and pair again. |
| `RECORD_TOO_LARGE` | One record is over 1.9 MB. | Contact Ecomm BD development. |
| `EXPORT_FAILED` | Something else stopped the upload. The code is followed by where it failed. | Click **Continue now**. If it repeats, send the code to development. |

## Export to a file instead

Use this when the site cannot reach Ecomm BD (a host or security plugin blocks outgoing requests, or the old site is very slow). No pairing is needed.

1. In WordPress, open **WooCommerce → Move to Ecomm BD** and click **Create export file**. It reads the store in the background, like the upload; keep the page open, or click **Continue export** if it stops.
2. When the page says **Export complete**, click **Download export file**. The file is `ecommbd-export-<site>-<date>.jsonl.gz`, usually a few MB.
3. In the Ecomm BD admin, open the migration page, choose the file under **Or import an export file** and click **Import file**. Its source is then selected: dry run, then import, as after an upload.
4. Click **Delete export file** in WordPress afterwards. Deactivating or deleting the plugin also deletes it.

The file holds exactly what the upload sends, customers' password hashes included, so keep it private. It is saved in `wp-content/uploads/ecommbd-migrator/` under a random name, with web access denied on Apache.

For the final catch-up sync just before the domain switch, create a new export file and import it again (or pair and upload).

## When it is finished

1. The page says **Upload complete**. Go back to the Ecomm BD admin to check (dry run) and import.
2. For the final catch-up just before the domain switch, create new pairing details and pair again (see the [cutover runbook](../../docs/runbooks/cutover.md)).
3. After the cutover:
   - click **Remove saved connection**;
   - deactivate and delete the plugin (deleting removes everything it saved, on every site of a network);
   - revoke the helper upload token in the Ecomm BD admin.

## For developers

### Files

| File | What it holds |
|---|---|
| `ecommbd-migrator.php` | Plugin header; loads the classes |
| `includes/class-ecommbd-migrator.php` | Constants, hooks, saved state, clean-up |
| `includes/class-ecommbd-migrator-admin.php` | The admin page and its actions |
| `includes/class-ecommbd-migrator-uploader.php` | Pairing, the upload loop, signing, retries |
| `includes/class-ecommbd-migrator-file.php` | Export to a file, resuming, gzip, the download |
| `includes/class-ecommbd-migrator-exporter.php` | Read-only exporters, and what is never exported |
| `includes/class-ecommbd-migrator-budget.php` | Time and memory budget of one run |
| `includes/class-ecommbd-migrator-lock.php` | The atomic lock |
| `includes/class-ecommbd-migrator-crypto.php` | Encryption of the token and the pending part |
| `includes/class-ecommbd-migrator-i18n.php` | English and Bangla |
| `languages/ecommbd-migrator-bn_BD.l10n.php` | The Bangla text |
| `uninstall.php` | Removes everything on delete |

The code explains the reason for each rule in comments.

### Protocol

Unchanged; the receiving side is `apps/core/src/plugins/woo-import/helper.service.ts`. The export file (0.3.0) is JSON Lines, gzip-compressed when PHP has zlib: a header line `{ format: "ecommbd-woo-export", version: 1, plugin, sourceUrl, createdAt }`, then one line per chunk, exactly the upload's `{ sequence, kind, payload }`, ending with `finish`. The core's `importFile` runs every line through the same checks as an upload. Records are WooCommerce REST shapes and the core ignores unknown fields. What changed in the records:

- Page rows in `settings.redirects` have a new `slug` (the page's `post_name`) next to `id`, `path` and `target`.
- `settings.shippingZones` is a list of `{ zone_id, zone_name, zone_order, zone_locations[{code, type}], shipping_methods[{method_id, instance_id, title, enabled, costs}] }`. The fields the core reads (`zone_id`, `zone_name`, `zone_locations`) keep their names.
- `settings.permalinks` holds only the four bases the core reads.
- `meta_data` on orders (and their items and refunds), customers, products and variations no longer has secret-looking or private (`_`) keys. Coupons keep every key, with secret values emptied, because the core sends any coupon with meta to review.

### Text and Bangla

All text uses WordPress's own functions (`__()`, `esc_html__()`…) with the text domain `ecommbd-migrator`. The Bangla is in `languages/ecommbd-migrator-bn_BD.l10n.php`, WordPress's PHP translation format.

- WordPress 6.5 and later read that file by themselves.
- WordPress 5.8 to 6.4 cannot. For them a small `gettext` filter reads the same file when the admin language starts with `bn`.

Why this way: it works out of the box on every supported version, there is no compiled `.mo` file to build or keep in sync, and a real translation (for example from Loco Translate) still wins. `tests/strings.php` fails if a text has no Bangla, or if the placeholders differ. Use the words in [docs/glossary.md](../../docs/glossary.md).

### Tests

Run them on your computer. They need Docker, and internet the first time:

```sh
apps/wp-migrator/tests/run.sh
```

The script builds the ZIP and installs it into throw-away WordPress sites:

- **oldest:** PHP 7.4, WordPress 5.8.3, WooCommerce 4.9.5;
- **latest:** PHP 8.5, WordPress 7.1.3, WooCommerce 11.2.1, once with classic order storage and once with HPOS.

Versions are pinned in `tests/compose.yml`. On each site it runs:

- `fixture.php`: makes a small synthetic store, exports it, and checks that no admin hash, secret meta or courier key leaves; that ordinary meta, transaction IDs, refunds and shipping costs stay; and that page rows have their `slug`;
- `security.php`: capability and nonce checks, the bilingual refusal, the destination confirmation (no request before it), encryption, TLS checks forced on, signatures, a resend after a timeout or lost answer, the lock, and clean-up;
- `upload.php`: time and memory budgets, one run sending many parts, parts growing to 100, a part too big being split, the next run being scheduled straight away, and **Continue now** running the same loop;
- `metadata.php`: Yoast, RankMath and PixelYourSite layouts, and the page in Bangla and English;
- `file.php`: the export file's buttons, format and counts, gzip, resuming after a half-written line, no admin hash, the download button, and deletion.

It also runs `php -l` on every PHP file on PHP 7.4 and on PHP 8.5, and fails if WordPress logged any PHP notice from the helper. It prints `All WordPress helper tests passed` and exits 0, or stops at the first failure. It is not part of CI, on purpose: the project keeps tooling simple.

The test data is synthetic. The export the fixture writes stays inside the container; never copy it into the repository.
