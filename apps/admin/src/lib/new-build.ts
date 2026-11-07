/**
 * After a deploy, an admin tab that was already open still runs the old build. Each screen is its
 * own file with a hashed name, and the deploy replaced those files, so opening another screen fails
 * ("Failed to fetch dynamically imported module"). The fix is to load the page again, which gets
 * the new build. These helpers spot that error and reload, at most once a minute, so a real outage
 * (the files really can't be fetched) shows an error instead of reloading forever.
 */

const KEY = 'ecommbd-admin-new-build-reload';
const MIN_GAP_MS = 60_000;

/** True for each browser's "this module file could not be loaded" error. */
export function isMissingBuildFile(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
        message,
    );
}

/**
 * Reloads the page to get the new build, unless it already did so in the last minute.
 * Returns whether it reloaded. Without session storage (private mode) it reloads anyway.
 */
export function reloadForNewBuild(
    storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.sessionStorage,
    reload: () => void = () => window.location.reload(),
    now = Date.now(),
): boolean {
    try {
        const last = Number(storage?.getItem(KEY) ?? 0);
        if (now - last < MIN_GAP_MS) return false;
        storage?.setItem(KEY, String(now));
    } catch {
        // Storage refused: reload once all the same.
    }
    reload();
    return true;
}
