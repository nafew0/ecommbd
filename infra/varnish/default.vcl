vcl 4.1;
import std;
import xkey;
include "backend.vcl";
include "secret.vcl";
acl purge_local { "localhost"; }
acl trusted_proxy { "127.0.0.1"; "::1"; }

sub vcl_recv {
    if (req.method == "PURGE") {
        if (local.socket != "purge" || client.ip !~ purge_local) { return (synth(403)); }
        call authorize_purge;
        if (req.http.X-Purge-Tags !~ "^[a-zA-Z0-9:_ -]{1,6000}$") { return (synth(400)); }
        if (req.http.X-Purge-Mode == "hard") { set req.http.X-Purged = xkey.purge(req.http.X-Purge-Tags); }
        else { set req.http.X-Purged = xkey.softpurge(req.http.X-Purge-Tags); }
        return (synth(200));
    }
    if (local.socket == "purge") { return (synth(403)); }
    unset req.http.X-Purge-Token;
    unset req.http.X-Purge-Tags;
    unset req.http.X-Backend-URL;
    unset req.http.X-Had-Tracking;
    unset req.http.X-Forwarded-Host;
    unset req.http.Forwarded;
    unset req.http.X-Original-URL;
    unset req.http.X-Rewrite-URL;
    unset req.http.X-Forwarded-Proto;
    if (client.ip !~ trusted_proxy) { set req.http.X-Real-IP = client.ip; }
    else { set req.http.X-Real-IP = std.ip(req.http.X-Real-IP, client.ip); }
    set req.http.X-Forwarded-For = req.http.X-Real-IP;
    if (req.http.host !~ "^[a-zA-Z0-9.-]+(:[0-9]+)?$") { return (synth(400)); }
    set req.http.host = std.tolower(req.http.host);
    if (req.method != "GET" && req.method != "HEAD") { return (pass); }
    if (req.http.Authorization || req.url ~ "(?i)%2f|%5c|%00" ||
        req.url ~ "(?i)^/(en/|bn/)?(admin|dashboard|admin-api|shop-api|woo-migrate|cache-metrics|cart|checkout|account|track|t|health)(/|[?.]|$)" ||
        req.url ~ "(?i)^/(en/|bn/)?s/[^/?]+/(order|thank-you)(/|[?.]|$)" ||
        req.url ~ "(?i)[?&](preview|token|auth|session|code|password|email|phone)(=|&|$)" ||
        req.http.Cookie ~ "(?i)(^|;[ ]*)([^=;]*(session|admin|auth|csrf)[^=;]*)=") { return (pass); }
    unset req.http.Cookie;
    set req.http.X-Backend-URL = req.url;
    if (req.url ~ "(?i)[?&](utm_[^=&]*|fbclid|gclid|ttclid|msclkid|dclid|_ga|_gl)=") { set req.http.X-Had-Tracking = "1"; }
    # Tracking is recorded by the client script; the server cannot vary a public page by it.
    set req.url = regsuball(req.url, "(?i)([?&])(utm_[^=&]*|fbclid|gclid|ttclid|msclkid|dclid|_ga|_gl)=[^&]*", "\1");
    set req.url = regsuball(req.url, "&&+", "&");
    set req.url = regsub(req.url, "[?&]+$", "");
    set req.url = regsub(req.url, "\?&", "?");
    set req.url = std.querysort(req.url);
    return (hash);
}
sub vcl_hash {
    hash_data(req.http.host);
    hash_data(req.url);
    return (lookup);
}
sub vcl_hit {
    # A per-visitor redirect must retain that visitor's tracking, never another visitor's.
    if (req.http.X-Had-Tracking && obj.status == 301) { return (pass); }
}
sub vcl_backend_fetch {
    if (bereq.http.X-Backend-URL) { set bereq.url = bereq.http.X-Backend-URL; }
    unset bereq.http.X-Backend-URL;
}
sub vcl_backend_response {
    if (beresp.status == 301 && bereq.http.X-Had-Tracking) { set beresp.http.Cache-Control = "no-store"; }
    # Local checks exercise the real text-transfer cost, just as Nginx compression will in production.
    if (!beresp.http.Content-Encoding && beresp.http.Content-Type ~ "text/|application/(javascript|json|xml)") {
        set beresp.do_gzip = true;
    }
    if (bereq.is_bgfetch && beresp.status >= 500) { return (abandon); }
    if (beresp.http.Cache-Control ~ "(?i)no-store|private" || beresp.http.Vary ~ "(?i)cookie|authorization|\*" ||
        beresp.status >= 500 || !beresp.http.X-Cache-Store || (beresp.status == 301 && bereq.http.X-Had-Tracking)) {
        set beresp.uncacheable = true;
        set beresp.ttl = 0s;
        return (deliver);
    }
    if (beresp.http.Content-Type ~ "text/html|application/xml|text/xml|text/css|text/plain") {
        if (beresp.status == 404) { set beresp.ttl = 60s; }
        else if (beresp.status == 200 || beresp.status == 301 || beresp.status == 410) { set beresp.ttl = 7d; }
        else { set beresp.uncacheable = true; set beresp.ttl = 0s; return (deliver); }
        unset beresp.http.Set-Cookie;
        set beresp.grace = 24h;
        set beresp.keep = 1h;
    } else { set beresp.uncacheable = true; set beresp.ttl = 0s; }
}
sub vcl_deliver {
    call cache_instance;
    if (obj.uncacheable) { set resp.http.X-Cache = "PASS"; }
    else if (obj.hits > 0) { set resp.http.X-Cache = "HIT"; }
    else { set resp.http.X-Cache = "MISS"; }
    unset resp.http.xkey;
    unset resp.http.X-Cache-Store;
    unset resp.http.X-Purge-Token;
}
sub vcl_backend_error {
    if (bereq.is_bgfetch) { return (abandon); }
    set beresp.ttl = 0s;
    set beresp.uncacheable = true;
    set beresp.http.Cache-Control = "no-store";
    return (deliver);
}
sub vcl_synth {
    if (req.method == "PURGE" && resp.status == 200) { set resp.http.X-Purged = req.http.X-Purged; }
    set resp.http.Cache-Control = "no-store";
}
