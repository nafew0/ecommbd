FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends varnish varnish-modules socat ca-certificates && rm -rf /var/lib/apt/lists/*
COPY default.vcl /etc/varnish/default.vcl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80 6082
ENTRYPOINT ["/entrypoint.sh"]
