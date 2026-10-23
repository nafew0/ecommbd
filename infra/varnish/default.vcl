vcl 4.1;
#
# The storefront cache (roadmap phase 17), the same file locally (docker compose, profile
# "speed") and in production (phase 23). Runbook: docs/runbooks/storefront-cache.md.
#
# Anonymous public pages are kept for 7 days and refreshed by purges from the core (soft purges:
# the old copy is served while the new one renders). Personal routes, sessions and previews always
# go to the storefront. Varnish never decides on its own what may be shared: the storefront marks
# what may be kept (`X-Cache-Store`) and tags it (`xkey`).

import std;
import xkey;

# Written by entrypoint.sh at start:
# - backend.vcl: the storefront and its health probe;
# - purge.vcl: `purge_allowed` (who may reach the purge listener), `authorize_purge` (the shared
#   secret) and `cache_instance` (a random ID for this start, so the core can tell a restart).
include "backend.vcl";
include "purge.vcl";

# Nginx in front (phase 23) runs on the same machine; only it may say who the shopper is.
acl trusted_proxy { "127.0.0.1"; "::1"; }

sub vcl_recv {
    if (local.socket == "purge") {
        call purge_listener;
    }
    # The public listener never purges, whatever the request says.
    if (req.method == "PURGE") {
        return (synth(403));
    }

    # Headers only the core or our own Nginx may set: a shopper can't change what we render or
    # purge, or where a page claims to live.
    unset req.http.X-Purge-Token;
    unset req.http.X-Purge-Tags;
    unset req.http.X-Purge-Mode;
    unset req.http.X-Tracking;
    unset req.http.X-Volatile;
    unset req.http.X-Forwarded-Host;
    unset req.http.Forwarded;
    unset req.http.X-Original-URL;
    unset req.http.X-Rewrite-URL;
    unset req.http.X-Forwarded-Proto;

    # The shopper's address: from Nginx on this machine, otherwise the connection's own.
    if (client.ip ~ trusted_proxy) {
        set req.http.X-Real-IP = std.ip(req.http.X-Real-IP, client.ip);
    } else {
        set req.http.X-Real-IP = client.ip;
    }
    set req.http.X-Forwarded-For = req.http.X-Real-IP;

    # The Host is part of the cache key (stores share a Varnish), so it must be a plain host name.
    # Production Nginx forwards only the store's own hosts (phase 23).
    if (req.http.host !~ "^[a-zA-Z0-9.-]+(:[0-9]+)?$") {
        return (synth(400));
    }
    set req.http.host = std.tolower(req.http.host);

    if (req.method != "GET" && req.method != "HEAD") {
        return (pass);
    }
    call pass_private;

    # A public page: no cookie changes it (the storefront ignores the rest), and it's shared.
    unset req.http.Cookie;
    call normalize_query;
    return (hash);
}

# The purge listener (its own port, reached only by the core). Every request needs an allowed
# address and the shared secret.
sub purge_listener {
    if (client.ip !~ purge_allowed) {
        return (synth(403));
    }
    call authorize_purge;
    if (req.method == "PURGE") {
        # Prefixed tags (`store1:product:42 store1:listing`), as the core sends them.
        if (req.http.X-Purge-Tags !~ "^[a-zA-Z0-9:_ -]{1,6000}$") {
            return (synth(400));
        }
        if (req.http.X-Purge-Mode == "hard") {
            # Removes the copies outright (maintenance, suspension): nothing old is served after.
            set req.http.X-Purged = xkey.purge(req.http.X-Purge-Tags);
        } else {
            # Marks them stale: shoppers keep getting them (grace) while new ones render.
            set req.http.X-Purged = xkey.softpurge(req.http.X-Purge-Tags);
        }
        return (synth(200));
    }
    # GET or HEAD: a status check. The answer carries this start's ID (see vcl_synth).
    if (req.method == "GET" || req.method == "HEAD") {
        return (synth(200));
    }
    return (synth(405));
}

# Requests whose answer is personal or must not be shared go to the storefront, uncached. The
# storefront has the same rules (privateRequest in apps/storefront/src/lib/cache-policy.ts).
sub pass_private {
    # Signed-in staff and API clients.
    if (req.http.Authorization) {
        return (pass);
    }
    # Encoded slashes, backslashes and NUL could disguise a personal path.
    if (req.url ~ "(?i)%2f|%5c|%00") {
        return (pass);
    }
    # Personal routes, by path prefix, never by file extension: `/account/x.css` is still private.
    if (req.url ~ "(?i)^/(en/|bn/)?(admin|dashboard|admin-api|shop-api|woo-migrate|cache-metrics|cart|checkout|account|track|t|health)(/|[?.]|$)") {
        return (pass);
    }
    # A sales page's order form and its thank-you page.
    if (req.url ~ "(?i)^/(en/|bn/)?s/[^/?]+/(order|thank-you)(/|[?.]|$)") {
        return (pass);
    }
    # Search results: one page per search, never stored (the storefront marks them no-store).
    if (req.url ~ "^/(en/|bn/)?search/?(\?|$)") {
        return (pass);
    }
    # Previews and anything that puts a token or personal data in the address.
    if (req.url ~ "(?i)[?&](preview|token|auth|session|code|password|email|phone)(=|&|$)") {
        return (pass);
    }
    # Old WordPress links (`/?p=123`, `/?product=slug`, `/?attachment_id=9`): the storefront looks
    # each one up and answers with a private redirect.
    if (req.url ~ "[?&](p|product|attachment_id)=") {
        return (pass);
    }
    # A shopper's or staff member's session.
    if (req.http.Cookie ~ "(?i)(^|;[ ]*)([^=;]*(session|admin|auth|csrf)[^=;]*)=") {
        return (pass);
    }
}

# The cache key's query string: only the parameters the page reads, sorted, so any other
# parameter (`?x=<random>`) can't create new cache entries and push real pages out. The storefront
# then gets exactly the address the entry is stored under, so two different pages can never share
# one entry. What each route reads (grep `searchParams` in apps/storefront/src):
#   categories: filter.<key>, page, sort (lib/filters.ts; `q` is for search only)
#   search suggestions: q
#   /theme.css: v (the theme's version)
#   every other cacheable page: nothing (previews, tokens and old links were passed above).
sub normalize_query {
    # Tracking parameters (`utm_*`, click IDs) never reach the storefront: the browser's own
    # address keeps them for the attribution script. Kept here only to add back to a redirect.
    if (req.url ~ "[?&](utm_[^=&]*|fbclid|gclid|ttclid|msclkid|dclid|_ga|_gl)=") {
        set req.http.X-Tracking = regsuball(
            regsub(req.url, "^[^?]*", ""),
            "([?&])(?!(utm_[^=&]*|fbclid|gclid|ttclid|msclkid|dclid|_ga|_gl)=)[^&]*",
            "\1"
        );
        set req.http.X-Tracking = regsuball(req.http.X-Tracking, "&&+", "&");
        set req.http.X-Tracking = regsub(req.http.X-Tracking, "^[?&]+", "");
        set req.http.X-Tracking = regsub(req.http.X-Tracking, "&+$", "");
    }

    # `([?&])(?!(names)=)[^&]*` matches each parameter that is NOT on the route's list; it's
    # replaced by its separator alone, and the separators are tidied below.
    if (req.url ~ "^/(en/|bn/)?product-category/") {
        set req.url = regsuball(req.url, "([?&])(?!(filter\.[^=&]+|page|sort)=)[^&]*", "\1");
    } elsif (req.url ~ "^/(en/|bn/)?search/suggest/?\?") {
        set req.url = regsuball(req.url, "([?&])(?!q=)[^&]*", "\1");
    } elsif (req.url ~ "^/theme\.css\?") {
        set req.url = regsuball(req.url, "([?&])(?!v=)[^&]*", "\1");
    } else {
        set req.url = regsub(req.url, "\?.*$", "");
    }
    set req.url = regsuball(req.url, "&&+", "&");
    set req.url = regsub(req.url, "\?&", "?");
    set req.url = regsub(req.url, "[?&]+$", "");
    set req.url = std.querysort(req.url);

    # Keys anyone can vary without limit (filter values, suggestion words) go to the small store
    # (see vcl_backend_response).
    if (req.url ~ "[?&](filter\.[^=&]+|q)=") {
        set req.http.X-Volatile = "1";
    }
}

sub vcl_hash {
    hash_data(req.http.host);
    hash_data(req.url);
    return (lookup);
}

# The tracking parameters stay with Varnish; the storefront gets the clean address only.
sub vcl_backend_fetch {
    unset bereq.http.X-Tracking;
}

sub vcl_backend_response {
    # Text is compressed here, as Nginx will in production: Lighthouse showed uncompressed CSS
    # costing the LCP budget.
    if (!beresp.http.Content-Encoding && beresp.http.Content-Type ~ "text/|application/(javascript|json|xml)") {
        set beresp.do_gzip = true;
    }
    # A passed request (personal routes, sessions): delivered as it is, never stored.
    if (bereq.uncacheable) {
        return (deliver);
    }

    # During a background refresh, an error or the storefront's "busy" page (429) must not replace
    # the good copy shoppers are getting: drop the refresh and keep the stale copy.
    if (bereq.is_bgfetch && (beresp.status >= 500 || beresp.status == 429)) {
        return (abandon);
    }

    # Kept only when the storefront allows it, and only text it rendered for everyone. Redirects
    # are never kept: Astro's carry no Content-Type, and old-link redirects are `private` (each is
    # counted, and the merchant's edits apply at once). They're cheap to make.
    if (beresp.http.Cache-Control ~ "(?i)no-store|private" ||
        beresp.http.Vary ~ "(?i)cookie|authorization|\*" ||
        !beresp.http.X-Cache-Store ||
        beresp.http.Content-Type !~ "^(text/html|text/css|text/plain|text/xml|application/xml)" ||
        (beresp.status != 200 && beresp.status != 404 && beresp.status != 410)) {
        # Remember "don't store this" for 10 seconds (hit-for-miss), so requests for the same
        # address go straight to the storefront instead of queueing for an object that never comes.
        set beresp.uncacheable = true;
        set beresp.ttl = 10s;
        return (deliver);
    }

    # How long: from the storefront's Cache-Control (Varnish reads s-maxage first). 7 days for
    # pages, which purges keep fresh; 60 seconds for a 404; otherwise the response's own max-age
    # (search suggestions 60 s, sitemaps an hour, the versioned theme stylesheet a year).
    unset beresp.http.Set-Cookie;
    # If the storefront is down, serve the last copy for up to a day...
    set beresp.grace = 24h;
    # ...and keep it an hour past that, for conditional requests.
    set beresp.keep = 1h;

    # Two stores of memory. `volatile` holds what anyone can create without limit: 404s (any
    # address), filtered category pages and suggestions (any words), and responses that didn't
    # opt into purge-driven caching (no s-maxage). A flood of those pushes out only each other,
    # never the real pages in `main`.
    if (beresp.status == 404 || bereq.http.X-Volatile || beresp.http.Cache-Control !~ "(?i)s-maxage") {
        set beresp.storage = storage.volatile;
    } else {
        set beresp.storage = storage.main;
    }
}

sub vcl_deliver {
    # A redirect to one of our pages keeps the shopper's tracking parameters, which the storefront
    # never saw (each shopper's own: redirects are never cached).
    if (resp.status >= 301 && resp.status <= 308 && req.http.X-Tracking && resp.http.Location ~ "^/[^/]") {
        if (resp.http.Location ~ "\?") {
            set resp.http.Location = resp.http.Location + "&" + req.http.X-Tracking;
        } else {
            set resp.http.Location = resp.http.Location + "?" + req.http.X-Tracking;
        }
    }
    if (obj.uncacheable) {
        set resp.http.X-Cache = "PASS";
    } elsif (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
    # Internal: the tags and the storefront's permission to store.
    unset resp.http.xkey;
    unset resp.http.X-Cache-Store;
}

# The storefront didn't answer (down, or its probe failed) and there's no copy to serve.
sub vcl_backend_error {
    # A background refresh: keep serving the copy we have.
    if (bereq.is_bgfetch) {
        return (abandon);
    }
    set beresp.ttl = 0s;
    set beresp.uncacheable = true;
    set beresp.http.Content-Type = "text/html; charset=utf-8";
    set beresp.http.Cache-Control = "no-store";
    set beresp.http.Retry-After = "60";
    set beresp.http.X-Robots-Tag = "noindex";
    # A small bilingual page, in the storefront's own words (apps/storefront/src/lib/system-pages.ts).
    synthetic({"<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>কিছুক্ষণের জন্য বন্ধ · Temporarily unavailable</title>
<style>body{margin:0;background:#fff;color:#111;font:16px/1.6 system-ui,sans-serif}main{max-width:32rem;margin:12vh auto;padding:0 16px}h1,h2{font-size:1.4rem;line-height:1.3;margin:0 0 .5rem}h2{margin-top:2rem}</style>
</head>
<body>
<main>
<h1>কিছুক্ষণের জন্য বন্ধ</h1>
<p>দোকানটি কিছুক্ষণের জন্য বন্ধ আছে। এক মিনিট পরে আবার চেষ্টা করুন।</p>
<h2 lang="en">Temporarily unavailable</h2>
<p lang="en">The shop is temporarily unavailable. Please try again in a minute.</p>
</main>
</body>
</html>
"});
    return (deliver);
}

sub vcl_synth {
    set resp.http.Cache-Control = "no-store";
    # Only the purge listener says which start this is, and only to the core (a request that
    # passed the address and secret checks); the public side never does.
    if (local.socket == "purge" && resp.status == 200) {
        call cache_instance;
        if (req.method == "PURGE") {
            # How many cached objects the purge matched.
            set resp.http.X-Purged = req.http.X-Purged;
        }
    }
}
