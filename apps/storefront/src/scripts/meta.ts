/**
 * Meta tracking (roadmap phase 20), on every page when the store has a Pixel. Each event gets its
 * own ID and goes twice: to our core (`/bd-events`, which sends it on with the Conversions API, so
 * ad blockers don't lose it) and, when the store wants it, to Meta's own Pixel script with the same
 * ID, so Meta keeps one. Meta's script loads only once the page is idle or touched, never before.
 */

export interface MetaEvent {
    name: string;
    data?: Record<string, unknown>;
    /** A fixed ID (Purchase on the thank-you page); otherwise a new one. */
    eventId?: string;
    /** Only to Meta's script (Purchase: the server sends its own copy from the order). */
    browserOnly?: boolean;
}

type Fbq = ((...args: unknown[]) => void) & {
    queue?: unknown[][];
    loaded?: boolean;
    version?: string;
    callMethod?: (...args: unknown[]) => void;
    push?: unknown;
};

declare global {
    interface Window {
        fbq?: Fbq;
        _fbq?: Fbq;
        ecommMeta?: { track(event: MetaEvent): void };
    }
}

const DAYS_90 = 90 * 86400;

function cookie(name: string): string | null {
    const match = document.cookie.split('; ').find(part => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function setCookie(name: string, value: string) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${value}; Path=/; Max-Age=${DAYS_90}; SameSite=Lax${secure}`;
}

/** `_fbc` from an ad click's `fbclid`; `_fbp` made once per browser (Meta's own formats). */
function metaCookies(): { fbp: string; fbc: string | null } {
    const now = Date.now();
    const fbclid = new URL(location.href).searchParams.get('fbclid');
    if (fbclid && /^[\w-]{1,500}$/.test(fbclid)) setCookie('_fbc', `fb.1.${now}.${fbclid}`);
    let fbp = cookie('_fbp');
    if (!fbp || !/^fb\.[0-2]\.\d{10,16}\.\d{1,20}$/.test(fbp)) {
        fbp = `fb.1.${now}.${Math.floor(Math.random() * 1e10)}`;
        setCookie('_fbp', fbp);
    }
    return { fbp, fbc: cookie('_fbc') };
}

function newEventId(): string {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Meta's standard loader, without loading yet: calls wait in its queue. */
function pixelStub(): Fbq {
    if (window.fbq) return window.fbq;
    const fbq: Fbq = (...args: unknown[]) => {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue!.push(args);
    };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.push = fbq;
    window.fbq = fbq;
    window._fbq = fbq;
    return fbq;
}

function loadPixelScript() {
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
}

/** Once: when the browser is idle or the shopper first touches the page, whichever is first. */
function afterInteractive(run: () => void) {
    let done = false;
    const once = () => {
        if (done) return;
        done = true;
        run();
    };
    for (const type of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
        addEventListener(type, once, { once: true, passive: true });
    }
    if ('requestIdleCallback' in window) requestIdleCallback(once, { timeout: 4000 });
    else setTimeout(once, 3000);
}

export function initMeta() {
    const body = document.body;
    const pixels = (body.dataset.metaPixels ?? '').split(',').filter(Boolean);
    if (!pixels.length) return;
    const { fbp, fbc } = metaCookies();
    const browser = body.dataset.metaBrowser === '1';
    const fbq = browser ? pixelStub() : null;
    if (fbq) {
        for (const pixel of pixels) fbq('init', pixel);
        afterInteractive(loadPixelScript);
    }
    const track = (event: MetaEvent) => {
        const eventId = event.eventId ?? newEventId();
        if (!event.browserOnly) {
            const payload = JSON.stringify({
                event: event.name,
                eventId,
                url: location.href.split('#')[0],
                fbp,
                fbc: fbc ?? undefined,
                data: event.data,
            });
            const sent = navigator.sendBeacon?.(
                '/bd-events',
                new Blob([payload], { type: 'application/json' }),
            );
            if (!sent)
                void fetch('/bd-events', {
                    method: 'POST',
                    body: payload,
                    headers: { 'content-type': 'application/json' },
                    keepalive: true,
                }).catch(() => undefined);
        }
        fbq?.('track', event.name, event.data ?? {}, { eventID: eventId });
    };
    window.ecommMeta = { track };
    track({ name: 'PageView' });
    try {
        const events = JSON.parse(body.dataset.metaEvents ?? '[]') as MetaEvent[];
        for (const event of events) track(event);
    } catch {
        /* a page without events */
    }
}
