import type { Injector, RequestContext } from '@vendure/core';
import type { BdCorePluginOptions } from '../types';

export interface StoreDefaultsContext {
    /** A superadmin context inside the step's own transaction. */
    ctx: RequestContext;
    injector: Injector;
    options: BdCorePluginOptions;
    /** `store:init --force`: re-apply settings a merchant may have changed (operations staff only). */
    force: boolean;
}

/**
 * One piece of a new store's setup. Rules for writing a step:
 * - give it a stable `id`: once a step has run it's recorded and skipped next time, so a merchant's
 *   later changes are never overwritten;
 * - check before creating (a step can be re-run after an interruption, or with `--force`);
 * - to change a default in a later release, add a new step with a new `id` instead of editing one
 *   that stores have already run.
 */
export interface StoreDefaultsStep {
    id: string;
    description: string;
    /** Returns what it created or changed, for the log. An empty list means nothing was needed. */
    run(context: StoreDefaultsContext): Promise<string[]>;
}

const registered: StoreDefaultsStep[] = [];

/**
 * Lets later plugins add their own defaults (shipping methods in phase 07, COD in 08, SMS
 * templates in 10…). Call it at module load; steps run after bd-core's, in registration order.
 */
export function registerStoreDefaults(...steps: StoreDefaultsStep[]): void {
    for (const step of steps) {
        const index = registered.findIndex(existing => existing.id === step.id);
        if (index >= 0) {
            registered[index] = step;
        } else {
            registered.push(step);
        }
    }
}

export function registeredStoreDefaults(): readonly StoreDefaultsStep[] {
    return registered;
}
