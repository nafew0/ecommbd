#!/bin/sh
# Starts Varnish for the storefront (roadmap phase 17). Writes the generated parts of the VCL
# (backend.vcl, purge.vcl) from the environment, checking each value first, then runs varnishd.
#
#   STOREFRONT_HOST, STOREFRONT_PORT  the storefront (default host.docker.internal:4321)
#   CACHE_PURGE_SECRET                required: 64 lowercase hex characters, shared with the core
#   CACHE_PURGE_ALLOW                 optional: addresses allowed on the purge listener, space- or
#                                     comma-separated IPv4 addresses or ranges (default below)
#   VARNISH_MEMORY, VARNISH_VOLATILE_MEMORY  cache sizes (default 128m and 16m)
set -eu

fail() {
    echo "varnish: $*" >&2
    exit 1
}

backend_host=${STOREFRONT_HOST:-host.docker.internal}
backend_port=${STOREFRONT_PORT:-4321}
secret=${CACHE_PURGE_SECRET:-}

case "$backend_host" in '' | *[!a-zA-Z0-9.-]*) fail "STOREFRONT_HOST must be a host name" ;; esac
case "$backend_port" in '' | *[!0-9]*) fail "STOREFRONT_PORT must be a port number" ;; esac
case "$secret" in
    '') fail "CACHE_PURGE_SECRET is not set. Set the same value here and in the core: openssl rand -hex 32" ;;
    *[!a-f0-9]*) fail "CACHE_PURGE_SECRET must be 64 lowercase hex characters (openssl rand -hex 32)" ;;
esac
[ "${#secret}" -eq 64 ] || fail "CACHE_PURGE_SECRET must be 64 lowercase hex characters (openssl rand -hex 32)"
# Any character that isn't 0 means a real secret; all zeros is the old placeholder.
case "$secret" in *[!0]*) ;; *) fail "CACHE_PURGE_SECRET is all zeros: set a real one (openssl rand -hex 32)" ;; esac

# Who may reach the purge listener, besides this container itself. Under Docker, the host's
# connections to a published port arrive from the container's default gateway (checked on Docker
# Desktop for Mac), while other containers on the network come from their own addresses and are
# refused. Set CACHE_PURGE_ALLOW where a setup differs. The gateway is read from the routing table
# (hex, least significant byte first).
allow=$(printf '%s' "${CACHE_PURGE_ALLOW:-}" | tr ',' ' ')
if [ -z "$allow" ]; then
    gw=$(awk '$2 == "00000000" { print $3; exit }' /proc/net/route)
    [ -n "$gw" ] || fail "no default gateway found: set CACHE_PURGE_ALLOW"
    allow=$(printf '%d.%d.%d.%d' "0x$(echo "$gw" | cut -c7-8)" "0x$(echo "$gw" | cut -c5-6)" \
        "0x$(echo "$gw" | cut -c3-4)" "0x$(echo "$gw" | cut -c1-2)")
fi
acl='"127.0.0.1"; "::1";'
for entry in $allow; do
    case "$entry" in *[!0-9./]*) fail "CACHE_PURGE_ALLOW: not an IPv4 address or range: $entry" ;; esac
    address=${entry%/*}
    if [ "$address" = "$entry" ]; then
        acl="$acl \"$address\";"
    else
        acl="$acl \"$address\"/${entry#*/};"
    fi
done

# The storefront, and its probe: /health/live answers whenever the storefront runs, even with the
# core down, so the storefront can still serve its own "unavailable" page. Sick after 2 failures
# in the last 3 checks (one every 2 seconds).
printf 'backend default { .host = "%s"; .port = "%s"; .probe = { .url = "/health/live"; .timeout = 1s; .interval = 2s; .window = 3; .threshold = 2; } }\n' \
    "$backend_host" "$backend_port" >/etc/varnish/backend.vcl

{
    printf 'acl purge_allowed { %s }\n' "$acl"
    printf 'sub authorize_purge { if (req.http.X-Purge-Token != "%s") { return (synth(403)); } }\n' "$secret"
    # A new random ID at every start: the core warms the cache when it sees a new one.
    printf 'sub cache_instance { set resp.http.X-Cache-Instance = "%s"; }\n' "$(cat /proc/sys/kernel/random/uuid)"
} >/etc/varnish/purge.vcl

# public: shoppers (port 80, published on the host's 6081 locally). purge: the core only (port
# 6082). -T: the admin console, inside the container only. Two memory stores, see default.vcl.
exec varnishd -F \
    -a public=:80 \
    -a purge=:6082 \
    -T 127.0.0.1:6083 \
    -f /etc/varnish/default.vcl \
    -s main=malloc,"${VARNISH_MEMORY:-128m}" \
    -s volatile=malloc,"${VARNISH_VOLATILE_MEMORY:-16m}"
