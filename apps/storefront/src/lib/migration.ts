import { env } from '../env';
import { CoreUnavailableError } from './core';

export async function legacyUrl(
    path: string,
    recordMiss = false,
): Promise<{ status: number; target: string | null } | null> {
    const settings = env();
    let response: Response;
    try {
        response = await fetch(`${settings.CORE_URL}/shop-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: 'query($path:String!,$recordMiss:Boolean){wooResolvePath(path:$path,recordMiss:$recordMiss)}',
                variables: { path, recordMiss },
            }),
            signal: AbortSignal.timeout(settings.CORE_TIMEOUT_MS),
        });
    } catch {
        throw new CoreUnavailableError('Migration URL lookup unavailable');
    }
    if (!response.ok) throw new CoreUnavailableError('Migration URL lookup unavailable');
    const data = await response.json();
    if (data.errors) throw new CoreUnavailableError('Migration URL lookup unavailable');
    return data.data.wooResolvePath;
}
