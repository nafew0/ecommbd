import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Request IDs: every API request gets one (or keeps a valid one sent by Nginx or the caller),
 * it's returned in the `x-request-id` response header, and every log line written while
 * handling the request includes it.
 */

const storage = new AsyncLocalStorage<{ requestId: string }>();

/** Only simple IDs are trusted from outside, so a header can't inject text into logs. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,64}$/;

export function getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
}

/** Runs `work` with a request ID set, for background jobs and tests. */
export function runWithRequestId<T>(requestId: string, work: () => T): T {
    return storage.run({ requestId }, work);
}

export function requestIdMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
): void {
    const header = request.headers['x-request-id'];
    const incoming = Array.isArray(header) ? header[0] : header;
    const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    response.setHeader('x-request-id', requestId);
    storage.run({ requestId }, () => next());
}
