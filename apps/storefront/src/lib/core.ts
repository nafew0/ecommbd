import { print } from '@0no-co/graphql.web';
import { initGraphQLTada, type ResultOf, type TadaDocumentNode, type VariablesOf } from 'gql.tada';
import { env } from '../env';
import type { introspection } from '../gql/graphql-env.d.ts';
import type { Lang } from './i18n';

/** Shop API documents, typed from the schema in `src/gql` (`npm run gql:schema` refreshes it). */
export const graphql = initGraphQLTada<{
    introspection: introspection;
    scalars: { DateTime: string; Money: number; JSON: unknown; ID: string };
}>();

export type { ResultOf, VariablesOf };

/** The core can't be reached (down, restarting, too slow): pages answer 503. */
export class CoreUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CoreUnavailableError';
    }
}

/** The core answered with a GraphQL error: a bug on our side, pages answer 500. */
export class CoreQueryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CoreQueryError';
    }
}

/**
 * Runs a Shop API query against the local core. Node's fetch keeps connections alive; every call
 * has a timeout. No URL here comes from a request, so there is nothing to forge (no SSRF).
 */
export async function shopQuery<Result, Variables extends Record<string, unknown>>(
    document: TadaDocumentNode<Result, Variables>,
    variables: Variables,
    lang: Lang,
): Promise<Result> {
    const { CORE_URL, CORE_TIMEOUT_MS } = env();
    let response: Response;
    try {
        response = await fetch(`${CORE_URL}/shop-api?languageCode=${lang}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ query: print(document), variables }),
            signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
        });
    } catch (error) {
        throw new CoreUnavailableError(`The core did not answer: ${(error as Error).name}`);
    }
    if (response.status >= 500) {
        throw new CoreUnavailableError(`The core answered HTTP ${response.status}`);
    }
    const json = (await response.json().catch(() => null)) as {
        data?: Result;
        errors?: Array<{ message: string }>;
    } | null;
    if (!json || json.errors?.length || !json.data) {
        throw new CoreQueryError(json?.errors?.[0]?.message ?? `HTTP ${response.status}`);
    }
    return json.data;
}
