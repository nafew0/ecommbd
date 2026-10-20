import { promises as dns, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

/**
 * Server-side request forgery (SSRF) protection for any URL that comes from data:
 * WooCommerce image URLs, webhook targets, feed sources and so on.
 *
 * Only plain public unicast addresses are allowed: no loopback, private, link-local (cloud
 * metadata), carrier-grade NAT, multicast or reserved ranges. Hostnames are checked again at
 * connect time (`createGuardedLookup`), which defeats DNS rebinding.
 */

export class SsrfBlockedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SsrfBlockedError';
    }
}

/** True only for public unicast IPv4/IPv6 addresses. */
export function isPublicAddress(address: string): boolean {
    if (!ipaddr.isValid(address)) {
        return false;
    }
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
        parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    if (parsed.kind() === 'ipv4' && (parsed as ipaddr.IPv4).match(ipaddr.IPv4.parse('0.0.0.0'), 8)) {
        // "This network" (0.0.0.0/8) can reach the local host on some systems.
        return false;
    }
    return parsed.range() === 'unicast';
}

export interface UrlPolicy {
    /** Default 80, 443, 8080 and 8443. */
    allowedPorts?: readonly number[];
}

const DEFAULT_PORTS = [80, 443, 8080, 8443] as const;

/** Parses and checks a URL before any request: http(s) only, no credentials, allowed port, no private IP literal. */
export function assertSafeUrl(input: string | URL, policy: UrlPolicy = {}): URL {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new SsrfBlockedError('Invalid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new SsrfBlockedError(`Protocol ${url.protocol} is not allowed`);
    }
    if (url.username || url.password) {
        throw new SsrfBlockedError('URLs with credentials are not allowed');
    }
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (!(policy.allowedPorts ?? DEFAULT_PORTS).includes(port)) {
        throw new SsrfBlockedError(`Port ${port} is not allowed`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new SsrfBlockedError('localhost is not allowed');
    }
    if (isIP(host) && !isPublicAddress(host)) {
        throw new SsrfBlockedError(`Address ${host} is not public`);
    }
    return url;
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = hostname => dns.lookup(hostname, { all: true, verbatim: true });

type LookupCallback = (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
) => void;

/**
 * A `lookup` function for `net.connect`/undici that resolves the hostname and refuses the
 * connection if **any** resolved address isn't public.
 */
export function createGuardedLookup(resolver: Resolver = systemResolver) {
    return (
        hostname: string,
        options: { family?: number | string; all?: boolean },
        callback: LookupCallback,
    ): void => {
        resolver(hostname)
            .then(addresses => {
                if (addresses.length === 0) {
                    throw new SsrfBlockedError(`${hostname} did not resolve`);
                }
                if (addresses.some(entry => !isPublicAddress(entry.address))) {
                    throw new SsrfBlockedError(`${hostname} resolves to a non-public address`);
                }
                const family =
                    options.family === 4 || options.family === 'IPv4'
                        ? 4
                        : options.family === 6 || options.family === 'IPv6'
                          ? 6
                          : undefined;
                const usable =
                    family === 4 || family === 6
                        ? addresses.filter(entry => entry.family === family)
                        : addresses;
                const first = usable[0];
                if (!first) {
                    throw new SsrfBlockedError(`${hostname} has no IPv${String(family)} address`);
                }
                if (options.all) {
                    callback(null, usable);
                } else {
                    callback(null, first.address, first.family);
                }
            })
            .catch((error: NodeJS.ErrnoException) => callback(error, ''));
    };
}
