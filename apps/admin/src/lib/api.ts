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

/** Called with the share of an upload sent so far, from 0 to 1. */
export type UploadProgress = (sent: number) => void;

/** A POST with fetch, or with XMLHttpRequest when upload progress is wanted (fetch can't report it). */
function post(
    url: string,
    body: BodyInit,
    headers: Record<string, string>,
    onProgress?: UploadProgress,
): Promise<{ status: number; text: string }> {
    if (!onProgress) {
        return fetch(url, { method: 'POST', credentials: 'same-origin', headers, body }).then(
            async response => ({
                status: response.status,
                text: await response.text(),
            }),
        );
    }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.withCredentials = true;
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
        xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
        xhr.onerror = () => reject(new Error('network'));
        xhr.send(body as XMLHttpRequestBodyInit);
    });
}

async function send<T>(
    body: BodyInit,
    headers: Record<string, string>,
    onProgress?: UploadProgress,
): Promise<GraphQLResponse<T>> {
    let response: { status: number; text: string };
    try {
        response = await post(`/admin-api?languageCode=${language}`, body, headers, onProgress);
    } catch {
        throw new ApiError('Network error', 'NETWORK');
    }
    let json: GraphQLResponse<T> | undefined;
    try {
        json = JSON.parse(response.text) as GraphQLResponse<T>;
    } catch {
        json = undefined;
    }
    if (!json) {
        throw new ApiError(`HTTP ${response.status}`, response.status >= 500 ? 'SERVER' : 'HTTP');
    }
    return json;
}

async function request<T>(
    makeBody: () => BodyInit,
    headers: Record<string, string>,
    retried = false,
    onProgress?: UploadProgress,
): Promise<T> {
    const json = await send<T>(makeBody(), headers, onProgress);
    const error = json.errors?.[0];
    if (!error) {
        return json.data as T;
    }
    const code = error.extensions?.code;
    if (code === 'FORBIDDEN' && !retried && sessionExpiredHandler && !(await isSignedIn())) {
        if (await sessionExpiredHandler()) {
            return request<T>(makeBody, headers, true, onProgress);
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
 * the server's CSRF protection requires for multipart requests. `onProgress` reports how much of
 * the file has been sent.
 */
export function adminUpload<T>(query: string, file: File, onProgress?: UploadProgress): Promise<T> {
    return request<T>(
        () => {
            const form = new FormData();
            form.append('operations', JSON.stringify({ query, variables: { input: [{ file: null }] } }));
            form.append('map', JSON.stringify({ 0: ['variables.input.0.file'] }));
            form.append('0', file);
            return form;
        },
        { 'apollo-require-preflight': 'true' },
        false,
        onProgress,
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
