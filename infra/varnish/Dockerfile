# Varnish and its xkey module (tag purges) from the same Debian release, so they always match.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends varnish varnish-modules ca-certificates && rm -rf /var/lib/apt/lists/*
COPY default.vcl /etc/varnish/default.vcl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# 80: shoppers. 6082: the purge listener (publish it on the host's loopback only).
EXPOSE 80 6082
ENTRYPOINT ["/entrypoint.sh"]
