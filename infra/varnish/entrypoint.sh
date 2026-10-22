#!/bin/sh
set -eu
backend_host=${STOREFRONT_HOST:-host.docker.internal}
backend_port=${STOREFRONT_PORT:-4321}
purge_secret=${CACHE_PURGE_SECRET:?CACHE_PURGE_SECRET must be 64 lowercase hex characters}
case "$backend_host" in *[!a-zA-Z0-9.-]*|'') exit 1;; esac
case "$backend_port" in *[!0-9]*|'') exit 1;; esac
case "$purge_secret" in *[!a-f0-9]*|'') exit 1;; esac
[ "${#purge_secret}" -eq 64 ] || exit 1
printf 'backend default { .host = "%s"; .port = "%s"; .probe = { .url = "/health"; .timeout = 1s; .interval = 2s; .window = 3; .threshold = 2; } }\n' "$backend_host" "$backend_port" > /etc/varnish/backend.vcl
printf 'sub authorize_purge { if (req.http.X-Purge-Token != "%s") { return (synth(403)); } }\n' "$purge_secret" > /etc/varnish/secret.vcl
printf 'sub cache_instance { set resp.http.X-Cache-Instance = "%s"; }\n' "$(cat /proc/sys/kernel/random/uuid)" >> /etc/varnish/secret.vcl
# Only the host-loopback published control port reaches this relay. Varnish sees localhost;
# the separate named listener, ACL and secret all remain mandatory.
socat TCP-LISTEN:6082,reuseaddr,fork TCP:127.0.0.1:8081 &
exec varnishd -F -a public=:80 -a purge=127.0.0.1:8081 -T 127.0.0.1:6083 -f /etc/varnish/default.vcl -s malloc,${VARNISH_MEMORY:-128m}
