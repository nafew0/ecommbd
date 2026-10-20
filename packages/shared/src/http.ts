import { Agent, fetch } from 'undici';
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker';
import { isSensitiveHeader, REDACTED } from './redact';
import { assertSafeUrl, createGuardedLookup, SsrfBlockedError, type Resolver, type UrlPolicy } from './ssrf';

/**
 * The one outbound HTTP client for every integration (gateways, couriers, Meta, SMS, imports).
 * Timeouts on everything, retries only when safe, a circuit breaker per host, a response size
 * cap, SSRF protection for URLs that come from data, and logging hooks that never see secrets.
 */

export type HttpErrorKind =
    'timeout' | 'network' | 'blocked' | 'too_large' | 'too_many_redirects' | 'circuit_open';

export class HttpError extends Error {
    constructor(
        public readonly kind: HttpErrorKind,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = 'HttpError';
    }
}

export interface HttpEvent {
    type: 'response' | 'retry' | 'error';
    method: string;
    /** URL with sensitive query values replaced by [REDACTED]. */
    url: string;
    attempt: number;
    durationMs: number;
    status?: number;
    errorKind?: HttpErrorKind;
    requestId?: string;
}

export interface HttpClientOptions {
    /** Connection timeout. Default 5 s. */
    connectTimeoutMs?: number;
    /** Total time for one attempt, including the body. Default 15 s. */
    timeoutMs?: number;
    /** Retries after the first attempt, for idempotent requests only. Default 2. */
    maxRetries?: number;
    /** Base for exponential backoff with full jitter. Default 200 ms. */
    retryBaseDelayMs?: number;
    /** Cap for one backoff delay, including Retry-After. Default 5 s. */
    maxRetryDelayMs?: number;
    /** Default 10 MB. */
    maxResponseBytes?: number;
    /** Default 3. Every hop is checked again by the SSRF guard. */
    maxRedirects?: number;
    /**
     * Default true: block private, loopback and metadata addresses, at URL check and at connect time.
     * Turn off only for calls to fixed, trusted hosts configured by us (and in tests).
     */
    ssrfProtection?: boolean;
    urlPolicy?: UrlPolicy;
    /** For tests: replaces DNS resolution in the SSRF guard. */
    resolver?: Resolver;
    /** `false` disables the breaker. */
    circuitBreaker?: CircuitBreakerOptions | false;
    onEvent?: (event: HttpEvent) => void;
    userAgent?: string;
    /** For tests. */
    sleep?: (ms: number) => Promise<void>;
    /** For tests. Returns a number in [0, 1). */
    random?: () => number;
}

export interface HttpRequest {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    /** Allow retries for a non-idempotent method (e.g. POST with an idempotency key). */
    idempotent?: boolean;
    /** Overrides the client's per-attempt timeout. */
    timeoutMs?: number;
    /** Sent as `x-request-id` and included in events. */
    requestId?: string;
}

export interface HttpResponse {
    status: number;
    headers: Headers;
    /** Final URL after redirects. */
    url: string;
    body: Buffer;
    text(): string;
    json<T = unknown>(): T;
}

export interface HttpClient {
    request(url: string | URL, request?: HttpRequest): Promise<HttpResponse>;
    close(): Promise<void>;
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_DROPPED_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/** Replaces sensitive query parameter values: `?token=abc` → `?token=[REDACTED]`. */
export function redactUrl(url: string | URL): string {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
        if (isSensitiveHeader(key)) {
            parsed.searchParams.set(key, REDACTED);
        }
    }
    return parsed.toString();
}

/** Parses Retry-After (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
    if (!value) {
        return undefined;
    }
    if (/^\d+$/.test(value.trim())) {
        return Number(value.trim()) * 1000;
    }
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function findCause<T extends Error>(
    error: unknown,
    type: abstract new (...args: never[]) => T,
): T | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 5; depth += 1) {
        if (current instanceof type) {
            return current;
        }
        if (!(current instanceof Error)) {
            return undefined;
        }
        current = current.cause;
    }
    return undefined;
}

/** Maps anything thrown during a request to an `HttpError` with a kind callers can act on. */
export function toHttpError(error: unknown): HttpError {
    if (error instanceof HttpError) {
        return error;
    }
    const blocked = findCause(error, SsrfBlockedError);
    if (blocked) {
        return new HttpError('blocked', blocked.message, { cause: error });
    }
    const name = error instanceof Error ? error.name : '';
    const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
    if (name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
        return new HttpError('timeout', 'The request timed out', { cause: error });
    }
    return new HttpError('network', 'The request failed', { cause: error });
}

async function readBody(stream: AsyncIterable<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream ?? []) {
        total += chunk.byteLength;
        if (total > maxBytes) {
            throw new HttpError('too_large', `The response is larger than ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
    const {
        connectTimeoutMs = 5_000,
        timeoutMs = 15_000,
        maxRetries = 2,
        retryBaseDelayMs = 200,
        maxRetryDelayMs = 5_000,
        maxResponseBytes = 10 * 1024 * 1024,
        maxRedirects = 3,
        ssrfProtection = true,
        urlPolicy,
        resolver,
        onEvent,
        userAgent = 'EcommBD',
        sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
        random = Math.random,
    } = options;
    const breaker = options.circuitBreaker === false ? undefined : new CircuitBreaker(options.circuitBreaker);
    const agent = new Agent({
        connect: ssrfProtection
            ? { timeout: connectTimeoutMs, lookup: createGuardedLookup(resolver) }
            : { timeout: connectTimeoutMs },
    });

    const backoff = (attempt: number, retryAfterMs?: number): number => {
        if (retryAfterMs !== undefined) {
            return Math.min(retryAfterMs, maxRetryDelayMs);
        }
        return Math.floor(random() * Math.min(maxRetryDelayMs, retryBaseDelayMs * 2 ** attempt));
    };

    async function send(url: URL, request: HttpRequest, method: string): Promise<HttpResponse> {
        let current = url;
        let currentMethod = method;
        let body = request.body;
        const headers: Record<string, string> = { 'user-agent': userAgent };
        for (const [key, value] of Object.entries(request.headers ?? {})) {
            headers[key.toLowerCase()] = value;
        }
        if (request.requestId) {
            headers['x-request-id'] = request.requestId;
        }
        for (let hop = 0; ; hop += 1) {
            if (ssrfProtection) {
                assertSafeUrl(current, urlPolicy);
            }
            const response = await fetch(current, {
                method: currentMethod,
                headers,
                body,
                redirect: 'manual',
                dispatcher: agent,
                signal: AbortSignal.timeout(request.timeoutMs ?? timeoutMs),
            });
            const location = response.headers.get('location');
            if (REDIRECT_STATUS.has(response.status) && location) {
                await response.body?.cancel();
                if (hop >= maxRedirects) {
                    throw new HttpError('too_many_redirects', `More than ${maxRedirects} redirects`);
                }
                const next = new URL(location, current);
                if (
                    response.status === 303 ||
                    ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
                ) {
                    currentMethod = 'GET';
                    body = undefined;
                    delete headers['content-type'];
                }
                if (next.origin !== current.origin) {
                    for (const name of CROSS_ORIGIN_DROPPED_HEADERS) {
                        delete headers[name];
                    }
                }
                current = next;
                continue;
            }
            const declared = Number(response.headers.get('content-length') ?? '0');
            if (declared > maxResponseBytes) {
                await response.body?.cancel();
                throw new HttpError('too_large', `The response is larger than ${maxResponseBytes} bytes`);
            }
            const bytes = await readBody(response.body, maxResponseBytes);
            const finalUrl = current.toString();
            return {
                status: response.status,
                headers: response.headers as unknown as Headers,
                url: finalUrl,
                body: bytes,
                text: () => bytes.toString('utf8'),
                json: <T>() => JSON.parse(bytes.toString('utf8')) as T,
            };
        }
    }

    async function request(input: string | URL, request: HttpRequest = {}): Promise<HttpResponse> {
        const url = new URL(input);
        const method = (request.method ?? 'GET').toUpperCase();
        const idempotent = request.idempotent ?? IDEMPOTENT_METHODS.has(method);
        const key = url.host;
        const emit = (event: Omit<HttpEvent, 'method' | 'url' | 'requestId'>): void =>
            onEvent?.({ ...event, method, url: redactUrl(url), requestId: request.requestId });

        for (let attempt = 0; ; attempt += 1) {
            if (breaker && !breaker.tryAcquire(key)) {
                throw new HttpError('circuit_open', `Calls to ${key} are paused after repeated failures`);
            }
            const started = Date.now();
            try {
                const response = await send(url, request, method);
                const durationMs = Date.now() - started;
                if (RETRYABLE_STATUS.has(response.status) || response.status >= 500) {
                    breaker?.failure(key);
                } else {
                    breaker?.success(key);
                }
                if (RETRYABLE_STATUS.has(response.status) && idempotent && attempt < maxRetries) {
                    emit({ type: 'retry', attempt, durationMs, status: response.status });
                    await sleep(backoff(attempt, parseRetryAfter(response.headers.get('retry-after'))));
                    continue;
                }
                emit({ type: 'response', attempt, durationMs, status: response.status });
                return response;
            } catch (caught) {
                const error = toHttpError(caught);
                const durationMs = Date.now() - started;
                const retryable = error.kind === 'timeout' || error.kind === 'network';
                if (retryable) {
                    breaker?.failure(key);
                }
                if (retryable && idempotent && attempt < maxRetries) {
                    emit({ type: 'retry', attempt, durationMs, errorKind: error.kind });
                    await sleep(backoff(attempt));
                    continue;
                }
                emit({ type: 'error', attempt, durationMs, errorKind: error.kind });
                throw error;
            }
        }
    }

    return {
        request,
        close: () => agent.close(),
    };
}
