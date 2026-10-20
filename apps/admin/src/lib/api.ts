/**
 * A small client for Vendure's Admin API on the same origin. The session is an HTTP-only cookie set
 * by the server: this code never sees or stores a token.
 *
 * - Errors come back in the admin's language (`?languageCode=bn`).
 * - When the session has expired, `onSessionExpired` asks the person to sign in again, then the
 *   request is retried once, so a form being saved completes without losing what was typed.
 */

export type Language = 'bn' | 'en';

export class ApiError extends Error {
    constructor(
        message: string,
        /** GraphQL error code, e.g. FORBIDDEN, or NETWORK when the server can't be reached. */
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

let language: Language = 'bn';
let sessionExpiredHandler: (() => Promise<boolean>) | undefined;

export function setApiLanguage(next: Language) {
    language = next;
}

/**
 * Called when a request is refused for lack of a session. Resolves `true` once the person has
 * signed in again (the request is then retried), `false` if they gave up.
 */
export function onSessionExpired(handler: (() => Promise<boolean>) | undefined) {
    sessionExpiredHandler = handler;
}

async function send<T>(body: BodyInit, headers: Record<string, string>): Promise<GraphQLResponse<T>> {
    let response: Response;
    try {
        response = await fetch(`/admin-api?languageCode=${language}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body,
        });
    } catch {
        throw new ApiError('Network error', 'NETWORK');
    }
    const json = (await response.json().catch(() => undefined)) as GraphQLResponse<T> | undefined;
    if (!json) {
        throw new ApiError(`HTTP ${response.status}`, response.status >= 500 ? 'SERVER' : 'HTTP');
    }
    return json;
}

async function request<T>(
    makeBody: () => BodyInit,
    headers: Record<string, string>,
    retried = false,
): Promise<T> {
    const json = await send<T>(makeBody(), headers);
    const error = json.errors?.[0];
    if (!error) {
        return json.data as T;
    }
    const code = error.extensions?.code;
    if (code === 'FORBIDDEN' && !retried && sessionExpiredHandler && !(await isSignedIn())) {
        if (await sessionExpiredHandler()) {
            return request<T>(makeBody, headers, true);
        }
    }
    throw new ApiError(error.message, code);
}

/** Runs a GraphQL query or mutation against the Admin API. */
export function adminApi<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return request<T>(() => JSON.stringify({ query, variables }), { 'content-type': 'application/json' });
}

/**
 * A GraphQL multipart upload (one file in `variables.input[0].file`). The preflight header is what
 * the server's CSRF protection requires for multipart requests.
 */
export function adminUpload<T>(query: string, file: File): Promise<T> {
    return request<T>(
        () => {
            const form = new FormData();
            form.append('operations', JSON.stringify({ query, variables: { input: [{ file: null }] } }));
            form.append('map', JSON.stringify({ 0: ['variables.input.0.file'] }));
            form.append('0', file);
            return form;
        },
        { 'apollo-require-preflight': 'true' },
    );
}

/** True when the browser still has a valid admin session. */
export async function isSignedIn(): Promise<boolean> {
    try {
        const json = await send<{ me: { id: string } | null }>(JSON.stringify({ query: '{ me { id } }' }), {
            'content-type': 'application/json',
        });
        return Boolean(json.data?.me);
    } catch {
        return true;
    }
}
